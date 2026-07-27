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
 *
 * Legs that cannot be TRADED are kept and marked, not dropped: an unquotable strike still
 * belongs to the smile that defines the ATM reference. Only candidate enumeration requires
 * tradeability.
 */

import { bsmGreeks } from "@morai/quant";
import { calendarDaysTo, yearsToSettlement } from "./time.ts";
import type { CalendarChainQuote, Carry, CarrySource, Cohort, CohortLeg, Root } from "./types.ts";

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

export type BuildCohortsOptions = {
  /** Injected observation instant. */
  readonly now: Date;
  /** Which wing to build. Puts, for this trader. */
  readonly contractType: "C" | "P";
  /** Solved per-expiry carry, or null when this expiry has none. */
  readonly carryOf: (expiration: string, root: Root) => Carry | null;
  /** Used only when `carryOf` returns null — and the cohort says so via `carrySource`. */
  readonly defaultCarry: Carry;
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
    .map((q) => ({ q, root: q.root ?? ("SPXW" as Root), iv: parseIv(q.bsmIv) }))
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

  const cohorts: Cohort[] = [];
  for (const group of groups.values()) {
    const dte = calendarDaysTo(opts.now, group.expiration);
    // `dte <= 0` and not `< 0`: dte is frozen at the observation day, so a row observed
    // yesterday whose expiration WAS yesterday arrives with dte 0 and would otherwise render
    // today as a tradeable 0DTE cohort. A contract expiring today is also not a calendar leg.
    if (dte === null || dte <= 0) continue;

    const t = yearsToSettlement(opts.now, group.expiration, group.root);
    if (t <= 0) continue;

    const solved = opts.carryOf(group.expiration, group.root);
    const carry: Carry = solved ?? opts.defaultCarry;
    const carrySource: CarrySource = solved === null ? "default" : "implied";

    const legs: CohortLeg[] = [];
    for (const entry of group.byStrike.values()) {
      const leg = priceLeg(entry.q, entry.iv, spot, t, carry, opts.contractType);
      if (leg !== null) legs.push(leg);
    }
    if (legs.length === 0) continue;
    legs.sort((a, b) => a.strike - b.strike);

    const atmStrike = nearestStrike(legs, spot);
    const atm50Strike = nearestFiftyDelta(legs);

    cohorts.push({
      root: group.root,
      expiration: group.expiration,
      dte,
      t,
      carry,
      carrySource,
      atmStrike,
      // No neighbour substitution, ever. A strike silently measured against 7450 because 7400
      // never solved is not slightly off — it is on a different scale from every row it gets
      // ranked against, and the ranking is what tells the reader they are comparable.
      atmIv: ivAt(legs, atmStrike),
      atm50Strike,
      atm50Iv: ivAt(legs, atm50Strike),
      legs,
    });
  }

  // Deterministic output order. (dte, root) is unique because (root, expiration) is the key
  // and expiration determines dte.
  cohorts.sort((a, b) => a.dte - b.dte || a.root.localeCompare(b.root));
  return cohorts;
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
function nearestStrike(legs: ReadonlyArray<CohortLeg>, spot: number): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const leg of legs) {
    const dist = Math.abs(leg.strike - spot);
    if (dist < bestDist) {
      best = leg.strike;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Strike whose |delta| is closest to 0.50 — the doctrine's ATM, and NOT the same question as
 * "nearest spot" once skew and carry are in play. This is the reference the term-structure
 * score reads, because forward vol taken off a traded strike's own IVs measures skew instead:
 * on the live chain the top candidates by per-strike forward factor all sat 250–300 points
 * from spot, at roughly double the near-the-money reading.
 */
function nearestFiftyDelta(legs: ReadonlyArray<CohortLeg>): number | null {
  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const leg of legs) {
    const gap = Math.abs(Math.abs(leg.delta) - TARGET_ABS_DELTA);
    if (gap < bestGap) {
      best = leg.strike;
      bestGap = gap;
    }
  }
  return best;
}

function ivAt(legs: ReadonlyArray<CohortLeg>, strike: number | null): number | null {
  if (strike === null) return null;
  return legs.find((l) => l.strike === strike)?.iv ?? null;
}
