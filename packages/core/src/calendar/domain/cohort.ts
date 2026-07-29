/**
 * cohort.ts — group the flat chain into priced `(root, expiration)` cohorts.
 *
 * Hexagon law (architecture-boundaries §2): pure. `now` is injected; no clock, no I/O.
 *
 * This is stage 1 of the engine and it is where three production scars are enforced by
 * construction rather than by comment:
 *
 *   1. ROOT IS PART OF THE KEY. SPX (AM-settled third-Friday monthlies) and SPXW (PM-settled
 *      weeklies) quote the SAME strike on the SAME date with different books. A root-blind
 *      cohort once measured a back IV of 68.89% against a front of 24.69% at strike 6675.
 *      Root is in the group key, so a root-blind cohort is not constructible here.
 *   2. `bsmIv` HAS THREE STATES: `null` (never processed — the IV drain is bounded at 800
 *      rows a pass, so older rows can stay null indefinitely), the literal string `'NaN'`
 *      (the inversion permanently failed), and a number. Only the third is data.
 *   3. ONE SPOT FOR THE SNAPSHOT. The chain is a two-vendor union, so `rows[0]` is whichever
 *      vendor landed first. Today the ATM reference measures against a screen-wide first row
 *      while each leg prices against its own row's spot — two spots on one screen.
 *   4. ONE CARRY FOR THE SNAPSHOT, and it is the carry the IV was INVERTED at. This module used
 *      to take a per-expiry `carryOf` with a flat fallback, which priced the two legs of one
 *      calendar on different (r, q). Measured before/after against the live chain 2026-07-28,
 *      read-only, same chain read for both sides:
 *
 *        latest carry array (2 solved expiries)   3,313 of 5,917 candidates (56%) mixed-carry;
 *                                                 1 of the top 10 pairs changed strike
 *        43-expiry array, same chain              1,150 of 6,850 (17%) mixed; 8 of the top 10
 *                                                 changed strike, the largest 7400 → 7375
 *
 *      BOTH runs also reordered the top 10 PAIRS, which the strike framing does not predict:
 *      carry reaches the pair score too, because `atm50Iv` is interpolated to |delta| = 0.50 and
 *      delta is what carry moves. A mixed-carry pair was mismeasuring its forward factor as well
 *      as its strike.
 *
 *      The per-expiry carry was not the more faithful of the two, which is why the fix is one
 *      carry rather than better carry. `implied_carry` is solved by `computeImpliedCarry`
 *      (FRED-interpolated r, put-call-parity q); `bsm_iv` is inverted by `computeBsmGreeks` at
 *      (r = the DGS3MO observation for the row's date, q = BSM_DIVIDEND_YIELD, a constant).
 *      Two different computations. The flat carry matches the inversion's q EXACTLY (both
 *      configs default 0.013 — apps/server/src/config.ts:39, apps/worker/src/config.ts:27)
 *      where the solved q on 2026-07-28 read 0.0002 and 0.0013, an order of magnitude off.
 *      Repricing at a carry the inversion did not use breaks this repo's `invert → reprice
 *      shares (r, q)` law, so the solved array is the branch that had to go.
 *
 * Legs that cannot be TRADED are kept and marked, not dropped: an unquotable strike still
 * belongs to the smile that defines the ATM reference. Only candidate enumeration requires
 * tradeability.
 */

import { bsmGreeks } from "@morai/quant";
import { calendarDaysTo, yearsToSettlement } from "./time.ts";
import type {
  CalendarChainQuote,
  Carry,
  Cohort,
  CohortLeg,
  Root,
  UnpricedStrike,
} from "./types.ts";

/** Strikes arrive ×1000. Converted here, once; no domain code downstream sees the ×1000 form. */
const STRIKE_SCALE = 1000;

/**
 * Widest bid-ask, as a fraction of mid, that still counts as a tradeable quote.
 *
 * Deliberately loose. Measured on SPX puts at 15–90 DTE the spread is p50 0.6% of mid and
 * p90 1.0%, so this bound catches genuine garbage and discriminates nothing among real
 * quotes. It is a gate, never a score term — the doctrine's 12%/22%/58% figures are retail
 * single-name weeklies and mean nothing here.
 */
const MAX_SPREAD_FRACTION = 0.15;

/** The doctrine's ATM: the strike trading closest to 50 delta, per expiry. */
const TARGET_ABS_DELTA = 0.5;

/** Absent root means PM-settled; only SPX third-Friday contracts settle AM. */
const DEFAULT_ROOT: Root = "SPXW";

/**
 * Widest delta-space bracket the 50-delta interpolation will trust.
 *
 * Two points far apart in delta describe a smile too sparse to trust a straight line between
 * them: linear-in-delta interpolation across such a gap can land far from the true 50-delta vol
 * and still return a real-looking number. Same policy and same threshold as the 25Δ risk
 * reversal (`analytics/domain/risk-reversal.ts`), which is the established precedent in this
 * repo for interpolating a smile and refusing when it cannot be done honestly.
 */
const MAX_BRACKET_WIDTH = 0.3;

export type BuildCohortsOptions = {
  /** Injected observation instant. */
  readonly now: Date;
  /** Which wing to build. Puts, for this trader. */
  readonly contractType: "C" | "P";
  /**
   * ONE carry for every cohort in the snapshot, and it must be the carry the stored `bsm_iv`
   * was INVERTED at. See the header — this is not a default with a better alternative.
   */
  readonly carry: Carry;
};

/**
 * snapshotSpot — ONE spot for the whole snapshot, as the lower median of every usable quote.
 *
 * Spot is a single global quantity; the per-row variation is vendor noise, not information.
 * The median rather than the mean because one stale row from the other vendor should move
 * nothing, and the LOWER median rather than the midpoint of two so the result is a price that
 * was actually observed rather than one that was invented.
 *
 * Null when no row carries a positive finite spot — a gap cycle has no honest "nearest".
 */
export function snapshotSpot(quotes: ReadonlyArray<CalendarChainQuote>): number | null {
  const usable: number[] = [];
  for (const q of quotes) {
    if (Number.isFinite(q.underlyingPrice) && q.underlyingPrice > 0) usable.push(q.underlyingPrice);
  }
  if (usable.length === 0) return null;
  usable.sort((a, b) => a - b);
  return usable[Math.floor((usable.length - 1) / 2)] ?? null;
}

export function buildCohorts(
  quotes: ReadonlyArray<CalendarChainQuote>,
  opts: BuildCohortsOptions,
): ReadonlyArray<Cohort> {
  const spot = snapshotSpot(quotes);
  if (spot === null) return [];

  // Sort the input into a total order FIRST, so everything below is order-invariant. Without
  // this, a duplicate strike inside one cohort would resolve by arrival order — and the chain
  // is a vendor union, so arrival order is not a property of the data.
  const sorted = quotes
    .filter((q) => q.contractType === opts.contractType)
    .map((q) => ({ q, root: q.root ?? DEFAULT_ROOT, iv: parseIv(q.bsmIv) }))
    .filter((r): r is { q: CalendarChainQuote; root: Root; iv: number } => r.iv !== null)
    .sort(
      (a, b) =>
        a.root.localeCompare(b.root) ||
        a.q.expiration.localeCompare(b.q.expiration) ||
        a.q.strike - b.q.strike ||
        a.q.time.getTime() - b.q.time.getTime() ||
        a.iv - b.iv,
    );

  // Group by (root, expiration); within a group, dedup by strike with the last of the sorted
  // order winning — the newest observation, then the higher IV. Deterministic either way, and
  // a duplicate should not exist: the chain read already dedups per OCC contract.
  const groups = new Map<
    string,
    { root: Root; expiration: string; byStrike: Map<number, { q: CalendarChainQuote; iv: number }> }
  >();
  for (const row of sorted) {
    const key = `${row.root}|${row.q.expiration}`;
    const existing = groups.get(key);
    const group =
      existing ?? { root: row.root, expiration: row.q.expiration, byStrike: new Map() };
    if (existing === undefined) groups.set(key, group);
    group.byStrike.set(row.q.strike, { q: row.q, iv: row.iv });
  }

  // A SECOND PASS over the same quotes, on `countLegsWithoutIv`'s precedent and for the same
  // reason: the priced path above is left byte-identical rather than widened. Its sort/dedup
  // order — newest row, then higher IV — is what makes the ranker's leg choice a property of the
  // data, and threading a nullable IV back through that comparator would let a newer null row
  // beat an older solved one. The pass is over ~9,300 rows and costs nothing measurable.
  const quotedByGroup = groupQuotedStrikes(quotes, opts.contractType);

  const cohorts: Cohort[] = [];
  // ITERATE THE QUOTED GROUPS, NOT THE PRICED ONES. `groups` above is keyed off rows that already
  // carry a usable IV, so an expiry the bounded IV drain has not reached yet forms no group at
  // all — and a cohort that never exists cannot be rescued by `unpricedStrikes` below. Measured
  // on the live chain read 2026-07-29, two put groups were in exactly that state: SPXW 2026-07-27
  // (199 strikes quoted, 0 solved) and SPXW 2026-11-29 (1 quoted, 0 solved). Nothing is lost by
  // dropping the other direction: a group present in `groups` but absent here holds only
  // non-positive or non-finite strikes, which `priceLeg` refuses for the same reason
  // `groupQuotedStrikes` skips them, so it could never have produced a leg OR a gap.
  for (const [key, quoted] of quotedByGroup) {
    const dte = calendarDaysTo(opts.now, quoted.expiration);
    // `< 0` and not `<= 0`. This dte is measured against the INJECTED `now`, not against the
    // observation day, so an expiry that has already been and gone arrives negative however stale
    // the snapshot is — a row observed yesterday whose expiration WAS yesterday reads −1 and is
    // refused here. That leaves dte 0 meaning one thing only: expires today, still trading. The
    // guard used to conflate the two and cost the chain table every 0DTE row it had — 192 quoted
    // SPXW puts on 2026-07-29 alone. "Has it settled?" is `yearsToSettlement`'s question, and it
    // is asked next; it is root-aware, which calendar arithmetic cannot be.
    if (dte === null || dte < 0) continue;

    const t = yearsToSettlement(opts.now, quoted.expiration, quoted.root);
    if (t <= 0) continue;

    const legs: CohortLeg[] = [];
    for (const entry of groups.get(key)?.byStrike.values() ?? []) {
      const leg = priceLeg(entry.q, entry.iv, spot, t, opts.carry, opts.contractType);
      if (leg !== null) legs.push(leg);
    }
    legs.sort((a, b) => a.strike - b.strike);

    const atm50 = interpolateFiftyDeltaIv(legs);

    // QUOTED MINUS PRICED. A strike is a gap exactly when it did not become a leg — which also
    // handles the schwab+cboe union, where one vendor's row solves and the other's does not:
    // subtracting by strike means the ladder can never show the same strike twice. There is no
    // empty-cohort guard because there cannot be an empty cohort: a key exists here only because
    // some strike was quoted, so `legs ∪ unpricedStrikes` is never empty.
    const priced = new Set(legs.map((l) => l.strike));
    const unpricedStrikes = quoted.strikes.filter((s) => !priced.has(s.strike));

    // Resolved over every strike the cohort QUOTES, not only the ones that priced. Scanning
    // `legs` instead — which has already lost every strike without a usable IV — is how a strike
    // 48 points from the money came to be labelled ATM: the substitution was never in `atmIv`,
    // it was in choosing the strike. Must be computed after `unpricedStrikes` for that reason.
    const atmStrike = nearestStrike(
      [...legs.map((l) => l.strike), ...unpricedStrikes.map((s) => s.strike)],
      spot,
    );

    cohorts.push({
      root: quoted.root,
      expiration: quoted.expiration,
      dte,
      t,
      carry: opts.carry,
      atmStrike,
      // No neighbour substitution, ever. A strike silently measured against 7450 because 7400
      // never solved is not slightly off — it is on a different scale from every row it gets
      // ranked against, and the ranking is what tells the reader they are comparable.
      atmIv: ivAt(legs, atmStrike),
      atm50Iv: atm50?.iv ?? null,
      atm50BracketWidth: atm50?.bracketWidth ?? null,
      legs,
      unpricedStrikes,
    });
  }

  // Deterministic output order. (dte, root) is unique because (root, expiration) is the key
  // and expiration determines dte.
  cohorts.sort((a, b) => a.dte - b.dte || a.root.localeCompare(b.root));
  return cohorts;
}

/**
 * countLegsWithoutIv — how many rows of the requested wing `buildCohorts` threw away for want of
 * a usable IV. In LEGS, which is why the drop reason is named `"no-iv-legs"`.
 *
 * This is a second pass over the same quotes rather than a count returned alongside the cohorts,
 * and the reason is bluntly that the alternative is worse: `buildCohorts` returns an array that
 * ~25 call sites index directly, and widening it to `{ cohorts, noIvLegs }` rewrites all of them
 * to report one integer. The pass is over ~9,300 rows and costs nothing measurable. What it must
 * not become is a SECOND definition of "unusable" — so it calls the same `parseIv` the filter
 * calls, and scopes to the same `contractType`. Both details are load-bearing. Measured on the
 * chain read this engine actually consumes, 2026-07-28: 5,768 put rows, of which 700 are null
 * and 708 are 'NaN' — 1,408 legs, 24.4% of the wing, previously reported as zero. Scoping
 * matters because the wings do not fail alike: the same window's calls carried 0 'NaN' against
 * the puts' 708, so counting both wings would roughly double the number into meaninglessness.
 *
 * Counted BEFORE cohorts are built and independently of the DTE gates, so this is every leg the
 * chain could not price — not only the ones inside the ranked window. It answers "how much of
 * the book was unreadable", which is the question a thin ranking raises.
 */
export function countLegsWithoutIv(
  quotes: ReadonlyArray<CalendarChainQuote>,
  contractType: "C" | "P",
): number {
  let count = 0;
  for (const q of quotes) {
    if (q.contractType === contractType && parseIv(q.bsmIv) === null) count += 1;
  }
  return count;
}

/**
 * parseIv — the three-state read, collapsed to "a number or nothing".
 *
 * `parseFloat` turns both the `'NaN'` sentinel and any unparseable string into NaN, which the
 * finiteness check rejects. A zero or negative IV is rejected because gamma and vega divide by
 * sigma, so those legs cannot be priced at all.
 */
function parseIv(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * quotedAtm — the ATM reference measured over every strike the cohort QUOTES, priced or not,
 * AT AN ARBITRARY SPOT.
 *
 * This once existed because `Cohort.atmStrike` was resolved over `legs` and so returned a
 * neighbour when the true nearest strike had not solved. That is fixed — `atmStrike` now scans
 * the same quoted union — so at the cohort's OWN spot this returns exactly
 * `{ strike: cohort.atmStrike, iv: cohort.atmIv }`.
 *
 * What it still buys is the `spot` parameter. A cohort's ATM is frozen at the instant the
 * snapshot was built; a chain table watching a live spot needs to re-ask the question as the
 * index moves, and cannot do that from a stored field. That, and the null-cohort guard, are the
 * only reasons to prefer it over reading the two fields directly.
 *
 * Null strike on an absent cohort or an unusable spot; null IV when the nearest quoted strike is
 * one that never solved. Never a neighbour's IV, and never a fabricated 0.
 */
export function quotedAtm(
  cohort: Cohort | null,
  spot: number,
): { readonly strike: number | null; readonly iv: number | null } {
  if (cohort === null || !Number.isFinite(spot) || spot <= 0) return { strike: null, iv: null };

  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const strike of [
    ...cohort.legs.map((l) => l.strike),
    ...cohort.unpricedStrikes.map((s) => s.strike),
  ]) {
    const dist = Math.abs(strike - spot);
    // Strict `<` keeps the first-seen of an equal-distance pair; the `< best` tiebreak makes that
    // choice order-independent — the lower strike wins either way.
    if (dist < bestDist || (dist === bestDist && best !== null && strike < best)) {
      best = strike;
      bestDist = dist;
    }
  }

  return { strike: best, iv: ivAt(cohort.legs, best) };
}

/** One `(root, expiration)` group as the WING QUOTES it — before anything was priced. */
type QuotedGroup = {
  readonly root: Root;
  readonly expiration: string;
  /** Ascending by strike. Every strike quoted, whether or not its IV solved. */
  readonly strikes: ReadonlyArray<UnpricedStrike>;
};

/**
 * groupQuotedStrikes — EVERY strike the wing quotes, keyed `(root, expiration)`.
 *
 * Carries `root` and `expiration` alongside the strikes because this map, not the priced one, is
 * what `buildCohorts` iterates: a group whose every row is still unsolved exists only here.
 *
 * Deliberately not "the strikes whose IV failed to parse". The caller subtracts the strikes that
 * became legs, so a gap is defined as `quoted − priced` — which is what "could not price" means,
 * and it is the ONLY definition that makes the gap set and the leg set provably partition the
 * ladder. Filtering on the IV instead would agree with it in every case the chain produces today
 * and quietly disagree the first time `priceLeg` refuses a row whose IV DID parse (non-finite
 * greeks), leaving that strike in neither array. `quotedAtm` scans the union to find the ATM
 * strike, so a strike missing from both does not merely vanish from one row — it re-bases the
 * whole cohort's vertical skew against the wrong reference.
 *
 * Within a group a duplicate strike dedups to the newest observation, matching the priced path.
 */
function groupQuotedStrikes(
  quotes: ReadonlyArray<CalendarChainQuote>,
  contractType: "C" | "P",
): Map<string, QuotedGroup> {
  const byGroup = new Map<
    string,
    { root: Root; expiration: string; byStrike: Map<number, UnpricedStrike> }
  >();

  const rows = quotes
    .filter((q) => q.contractType === contractType)
    .sort(
      (a, b) =>
        (a.root ?? DEFAULT_ROOT).localeCompare(b.root ?? DEFAULT_ROOT) ||
        a.expiration.localeCompare(b.expiration) ||
        a.strike - b.strike ||
        a.time.getTime() - b.time.getTime(),
    );

  for (const q of rows) {
    const strike = q.strike / STRIKE_SCALE;
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const root = q.root ?? DEFAULT_ROOT;
    const key = `${root}|${q.expiration}`;
    const existing = byGroup.get(key);
    const group = existing ?? { root, expiration: q.expiration, byStrike: new Map() };
    if (existing === undefined) byGroup.set(key, group);
    group.byStrike.set(strike, {
      strike,
      bid: Number.isFinite(q.bid) ? q.bid : 0,
      ask: Number.isFinite(q.ask) ? q.ask : 0,
      openInterest: Number.isFinite(q.openInterest) ? q.openInterest : 0,
    });
  }

  const out = new Map<string, QuotedGroup>();
  for (const [key, group] of byGroup) {
    out.set(key, {
      root: group.root,
      expiration: group.expiration,
      strikes: [...group.byStrike.values()].sort((a, b) => a.strike - b.strike),
    });
  }
  return out;
}

function priceLeg(
  q: CalendarChainQuote,
  iv: number,
  spot: number,
  t: number,
  carry: Carry,
  contractType: "C" | "P",
): CohortLeg | null {
  const strike = q.strike / STRIKE_SCALE;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const greeks = bsmGreeks(spot, strike, t, iv, carry.rate, carry.divYield, contractType);
  if (
    !Number.isFinite(greeks.delta) ||
    !Number.isFinite(greeks.gamma) ||
    !Number.isFinite(greeks.theta) ||
    !Number.isFinite(greeks.vega)
  ) {
    return null;
  }

  const bid = Number.isFinite(q.bid) ? q.bid : 0;
  const ask = Number.isFinite(q.ask) ? q.ask : 0;
  const mid = (bid + ask) / 2;
  const intrinsic = contractType === "P" ? Math.max(strike - spot, 0) : Math.max(spot - strike, 0);

  return {
    strike,
    iv,
    bid,
    ask,
    mid,
    openInterest: Number.isFinite(q.openInterest) ? q.openInterest : 0,
    // Floored at zero: a mid below intrinsic is a quote artifact, not negative time value.
    // This is the denominator of the theta score term, so a negative one would flip its sign.
    extrinsic: Math.max(mid - intrinsic, 0),
    delta: greeks.delta,
    gamma: greeks.gamma,
    theta: greeks.theta,
    vega: greeks.vega,
    tradeable: bid > 0 && ask >= bid && mid > 0 && (ask - bid) / mid <= MAX_SPREAD_FRACTION,
  };
}

/** Strike nearest spot; ties to the LOWER strike, which keeps the pick order-independent. */
function nearestStrike(strikes: ReadonlyArray<number>, spot: number): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const strike of strikes) {
    const dist = Math.abs(strike - spot);
    // Strict `<` keeps the first-seen of an equal-distance pair; the `< best` tiebreak makes that
    // choice order-independent — the lower strike wins either way, whatever order the union
    // happens to concatenate priced and unpriced strikes in.
    if (dist < bestDist || (dist === bestDist && best !== null && strike < best)) {
      best = strike;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * The doctrine's ATM reference: IV INTERPOLATED to exactly |delta| = 0.50.
 *
 * Interpolated, never picked, and the difference is not cosmetic. Picking the nearest strike
 * lets the front and back cohorts' references sit at DIFFERENT deltas, and skew turns that into
 * a systematic bias in the forward factor computed from them. Measured on the live chain:
 *
 *   SPX 17/53d   front |Δ| 0.43 against back |Δ| 0.50   FF 21.35%  →  10.91% interpolated
 *   SPXW 35/65d  front |Δ| 0.497 against back |Δ| 0.4997  FF 0.09%  →   0.54% interpolated
 *
 * Half of that 21% was the mismatch. Where both references genuinely sit at 50 delta the two
 * methods agree to within half a point — so interpolation costs nothing where the ladder is
 * dense and removes an artifact where it is not.
 *
 * Linear in delta between the tightest bracketing pair, and NEVER extrapolated: a cohort whose
 * legs are all on one side of 50 delta has no ATM reference, which drops its pairs with a named
 * reason. Same technique and same refusal policy as `interpolateRiskReversal`.
 *
 * Returns the interpolated IV and the delta-space width it was interpolated across, so a reader
 * can see how much of the number is measurement and how much is interpolation.
 */
function interpolateFiftyDeltaIv(
  legs: ReadonlyArray<CohortLeg>,
): { readonly iv: number; readonly bracketWidth: number } | null {
  let lower: CohortLeg | null = null;
  let upper: CohortLeg | null = null;

  for (const leg of legs) {
    const absDelta = Math.abs(leg.delta);
    // A magnitude at or beyond 1 is not a real option delta; it signals a mis-signed or
    // numerically unstable solve and must not anchor a bracket.
    if (!Number.isFinite(absDelta) || absDelta >= 1) continue;
    if (absDelta <= TARGET_ABS_DELTA && (lower === null || absDelta > Math.abs(lower.delta))) {
      lower = leg;
    }
    if (absDelta >= TARGET_ABS_DELTA && (upper === null || absDelta < Math.abs(upper.delta))) {
      upper = leg;
    }
  }
  if (lower === null || upper === null) return null;

  const span = Math.abs(upper.delta) - Math.abs(lower.delta);
  if (span === 0) return { iv: lower.iv, bracketWidth: 0 };
  if (span > MAX_BRACKET_WIDTH) return null;

  const fraction = (TARGET_ABS_DELTA - Math.abs(lower.delta)) / span;
  const iv = lower.iv + fraction * (upper.iv - lower.iv);
  return Number.isFinite(iv) && iv > 0 ? { iv, bracketWidth: span } : null;
}

function ivAt(legs: ReadonlyArray<CohortLeg>, strike: number | null): number | null {
  if (strike === null) return null;
  return legs.find((l) => l.strike === strike)?.iv ?? null;
}
