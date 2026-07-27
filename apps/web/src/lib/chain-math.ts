/**
 * chain-math.ts — the Analyzer chain table's per-strike column math.
 *
 * One row of that table is one strike, priced at a user-picked front and back expiry. Every
 * column below is a pure function of those two legs. Nothing here fetches, caches, or reads a
 * clock — the row's own `dte` is the only notion of time.
 *
 * REUSE, NEVER RE-DERIVE. The three formulas that matter already exist and are the oracle the
 * tests assert against:
 *   - `computeFwdIv` (@morai/core) — the forward-variance identity + its inverted-structure guard
 *   - `bsmGreeks`    (@morai/quant) — the ONE greeks kernel the server also uses (D-01)
 *   - `haircutFill`  (@morai/core) — the ORATS 0.66-of-width 2-leg fill model
 *
 * NULL HONESTY is the hard rule, mirroring the picker domain: a degraded input nulls its OWN
 * column and nothing else. `bsmIv` is `number | null` because IV inversion can fail to solve, and
 * a strike whose IV never solved has no skew, no edge, and no greeks. It does NOT have a zero
 * one. No column here ever returns NaN, a fabricated 0, or a silently-clean number.
 */
import { computeFwdIv, haircutFill } from "@morai/core";
import { bsmGreeks, type BsmGreeks } from "@morai/quant";

// ─── Conventions ──────────────────────────────────────────────────────────────

/** Strikes arrive as integers scaled ×1000 — 7_400_000 is index level 7400. */
export const STRIKE_SCALE = 1000;

/** BSM year basis, matching computeT and bsmGreeks' theta (D-04). */
export const DAYS_PER_YEAR = 365.25;

// ─── Input shapes ─────────────────────────────────────────────────────────────

/**
 * The fields of a chain row this module actually prices. Structural on purpose: the full row
 * contract lives in `@morai/contracts` (chain.ts) and satisfies this without a conversion step,
 * so there is no second copy of the row type to drift.
 */
export type ChainLeg = {
  /** Strike ×1000. */
  readonly strike: number;
  /** Whole days to expiry. */
  readonly dte: number;
  /** Decimal IV (0.1249 = 12.49%), or null when the inversion never solved. */
  readonly bsmIv: number | null;
  readonly contractType: "C" | "P";
  /** Spot at observation, in index points. */
  readonly underlyingPrice: number;
};

/** Two-sided market for one leg. */
export type ChainQuote = {
  readonly bid: number;
  readonly ask: number;
};

/** Per-expiry carry, as resolved by `resolveCarry`. */
export type Carry = {
  readonly rate: number;
  readonly divYield: number;
};

// ─── Columns ──────────────────────────────────────────────────────────────────

/**
 * Horizontal skew — the term-structure differential AT this strike: frontIv − backIv.
 * Positive means the front expiry is the rich one, which is the calendar seller's setup.
 */
export function hSkew(ivFront: number | null, ivBack: number | null): number | null {
  return diff(ivFront, ivBack);
}

/**
 * Vertical skew — this strike's IV against the ATM strike of the SAME expiry AND THE SAME WING.
 *
 * Both constraints bind. Across expiries this measures term structure, not skew. Across wings it
 * measures nothing at all: calls and puts trace different curves, so a put's IV against the
 * call ATM is a subtraction of two unrelated numbers that still returns a clean-looking float.
 *
 * This function cannot defend itself — it receives two floats with no memory of where they came
 * from. Source the second argument from `atmIv`, which takes the expiry and the wing as arguments
 * and so cannot be pointed at the wrong curve.
 */
export function vSkewVsAtm(ivAtStrike: number | null, ivAtm: number | null): number | null {
  return diff(ivAtStrike, ivAtm);
}

/**
 * EDGE — frontIv − fwdIv, the front leg's richness over the forward vol its own back leg implies.
 *
 * Null, never zero and never NaN, when `computeFwdIv` guards `"inverted"`: an inverted term
 * structure prices no forward vol, so there is no edge to quote. Also null when the back leg is
 * not strictly later than the front (the identity divides by tb − tf).
 */
export function edge(
  tf: number,
  ivFront: number | null,
  tb: number,
  ivBack: number | null,
): number | null {
  if (!isNum(ivFront) || !isNum(ivBack) || !isNum(tf) || !isNum(tb) || tb <= tf) return null;
  const fwd = computeFwdIv(tf, ivFront, tb, ivBack);
  return fwd.guard === "inverted" ? null : ivFront - fwd.fwdIv;
}

/**
 * The chain's ATM strike — the one nearest spot, returned in the same ×1000 units it came in, so
 * the caller can match it straight back against `row.strike`. Ties go to the lower strike, which
 * keeps the pick deterministic on an evenly-spaced chain. Null on an empty chain or a spot of 0
 * (a gap row), because there is no honest "nearest" to name.
 *
 * Safe to feed a both-wings chain: this returns a strike, not a row, so the duplicate strike per
 * wing changes nothing. Picking the ATM *IV* at that strike is where the wing starts to matter.
 */
export function atmStrike(
  rows: ReadonlyArray<{ readonly strike: number }>,
  spot: number,
): number | null {
  if (!isNum(spot) || spot <= 0) return null;
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!isNum(row.strike)) continue;
    const dist = Math.abs(row.strike / STRIKE_SCALE - spot);
    // Strict `<` keeps the FIRST-seen of an equal-distance pair; the `< best` tiebreak below
    // makes that choice order-independent — the lower strike wins either way.
    if (dist < bestDist || (dist === bestDist && best !== null && row.strike < best)) {
      best = row.strike;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * The ATM reference IV for one cohort — the `ivAtm` argument `vSkewVsAtm` needs.
 *
 * Exists to make the wing/expiry/root constraint UNVIOLATABLE rather than merely documented. The
 * chain interleaves both wings AND both OCC roots, so "nearest strike to spot" is only a
 * well-formed question once you have fixed an expiry, a `contractType` AND a `root`; all three
 * are parameters here, so there is no way to call this and accidentally read the call curve's ATM
 * for a put row, or SPXW's for an SPX one. Doing the filter at the call site instead is the one
 * mistake `vSkewVsAtm` cannot catch — by the time it receives two floats, where they came from is
 * gone, and it would return a plausible, clean, wrong number.
 *
 * Root binds for the same reason the wing does, and it bit in production: SPX (AM-settled
 * monthlies) and SPXW (PM-settled weeklies) quote the SAME strike on the SAME date with different
 * books, and at strike 6675000 one root's IV had solved while its twin's had not. A root-blind
 * cohort holds both rows, so `find` returns whichever the vendor union emitted first — which is
 * how an SPXW back leg once got measured against an SPX front (back IV 68.89% vs front 24.69%).
 * Root also scopes `atmStrike`: the two roots list ragged strike ladders, so the twin's strikes
 * must not be candidates for THIS root's ATM reference.
 *
 * Null when the cohort is empty, spot is unusable, or the ATM strike's own IV never solved. That
 * last one is deliberate and load-bearing: a neighbouring strike's IV is NOT a substitute
 * reference. Vertical skew is rendered as a SORTABLE COLUMN, so a row silently measured against
 * 7450 because 7400 never solved is not merely a slightly-off number — it is on a different
 * scale from every row it gets ranked against, and the ranking is the artifact that tells the
 * reader they ARE comparable. A visible gap costs one row; a re-based row corrupts its
 * neighbours' order, invisibly, because the neighbours still look fine.
 */
export function atmIv(
  rows: ReadonlyArray<{
    readonly strike: number;
    readonly expiration: string;
    readonly contractType: "C" | "P";
    readonly root: "SPX" | "SPXW";
    readonly bsmIv: number | null;
  }>,
  spot: number,
  expiration: string,
  contractType: "C" | "P",
  root: "SPX" | "SPXW",
): number | null {
  const cohort = rows.filter(
    (r) => r.expiration === expiration && r.contractType === contractType && r.root === root,
  );
  const k = atmStrike(cohort, spot);
  if (k === null) return null;
  // ponytail: first match wins. (expiration, contractType, root, strike) IS unique on the wire —
  // the chain read dedups per OCC contract — so this find has exactly one candidate. If a future
  // union re-introduces duplicates, dedup upstream, not here.
  const row = cohort.find((r) => r.strike === k);
  return row === undefined || !isNum(row.bsmIv) ? null : row.bsmIv;
}

/**
 * One leg's greeks through the shared BSM kernel — the same numbers the server computes (D-01).
 *
 * Null when the leg cannot be priced at all: IV never solved, IV is zero (gamma and vega divide
 * by sigma), or the leg is at/past expiry (they also divide by √T). Those are undefined, not zero.
 */
export function legGreeks(leg: ChainLeg, carry: Carry): BsmGreeks | null {
  const K = leg.strike / STRIKE_SCALE;
  const S = leg.underlyingPrice;
  const sigma = leg.bsmIv;
  if (sigma === null || !isNum(sigma) || sigma <= 0) return null;
  if (!isNum(S) || S <= 0 || !isNum(K) || K <= 0) return null;
  if (!isNum(leg.dte) || leg.dte <= 0) return null;
  if (!isNum(carry.rate) || !isNum(carry.divYield)) return null;

  return bsmGreeks(S, K, leg.dte / DAYS_PER_YEAR, sigma, carry.rate, carry.divYield, leg.contractType);
}

/**
 * Net calendar greeks — LONG the back leg, SHORT the front, so net = back − front.
 *
 * That sign convention is the whole point: a calendar is net-long vega (the back leg's vega is
 * the larger) and net-short gamma (the front leg's gamma is the larger). Getting it backwards
 * flips every risk number on the table. Null when either leg failed to price — a one-legged
 * calendar has no net.
 */
export function netCalendarGreeks(
  front: BsmGreeks | null,
  back: BsmGreeks | null,
): BsmGreeks | null {
  if (front === null || back === null) return null;
  return {
    delta: back.delta - front.delta,
    gamma: back.gamma - front.gamma,
    theta: back.theta - front.theta,
    vega: back.vega - front.vega,
  };
}

/**
 * The calendar's entry debit at the ORATS fill haircut: BUY the back leg, SELL the front.
 *
 * Ranking on mid overstates edge, so this crosses 66% of each leg's width off the natural side
 * via the shared `haircutFill` — the same model the picker and the exits context price against.
 * Null when either leg has no offer (ask ≤ 0 — you cannot buy what is not offered) or a crossed
 * market, both of which mean there is no fill to quote.
 */
export function calendarDebit(
  frontQuote: ChainQuote,
  backQuote: ChainQuote,
): number | null {
  if (!isQuotable(frontQuote) || !isQuotable(backQuote)) return null;
  return haircutFill(backQuote, "buy") - haircutFill(frontQuote, "sell");
}

// ─── Internals ────────────────────────────────────────────────────────────────

function isNum(v: number | null): v is number {
  return v !== null && Number.isFinite(v);
}

function diff(a: number | null, b: number | null): number | null {
  return isNum(a) && isNum(b) ? a - b : null;
}

function isQuotable(q: ChainQuote): boolean {
  return isNum(q.bid) && isNum(q.ask) && q.ask > 0 && q.bid >= 0 && q.ask >= q.bid;
}
