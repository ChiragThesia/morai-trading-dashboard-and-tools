/**
 * chain-math — the Analyzer chain table's per-row arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION STUB (Unit 11 ← Unit 06). Unit 06 owns this path. The file does
 * not exist in this worktree, so it is implemented here against the signatures
 * the plan froze (`hSkew`, `edge`, `vSkewVsAtm`, net greeks, `calendarDebit`).
 * On merge, take Unit 06's file wholesale — `useChainModel` only ever calls
 * `buildCalendarRow`, so that is the one signature that must survive.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every function here is DATA, never judgement. Nothing scores, ranks, or
 * weights a calendar. A value that cannot be computed comes back `null` so the
 * table can render an em dash — it is never softened to 0.
 *
 * Sign conventions match `packages/quant` (theta per calendar day, vega per vol
 * point, delta/gamma per share) and `packages/core/src/picker/domain/scoring.ts`
 * (edge = front IV − forward IV).
 *
 * No any/as/!.
 */
import { bsmGreeks } from "@morai/quant";
import type { ChainRow } from "./chain-contract.ts";

/** Same carry assumptions the payoff engine uses (useAnalyzerModel). */
export const DEFAULT_RATE = 0.045;
export const DEFAULT_DIV = 0.013;

export interface Greeks {
  readonly delta: number;
  readonly gamma: number;
  readonly theta: number;
  readonly vega: number;
}

/** Quote midpoint. */
export function mid(bid: number, ask: number): number {
  return (bid + ask) / 2;
}

/** Horizontal (calendar) skew: back IV − front IV at one strike. */
export function hSkew(frontIv: number | null, backIv: number | null): number | null {
  if (frontIv === null || backIv === null) return null;
  return backIv - frontIv;
}

/**
 * Vertical skew: this strike's IV − the ATM IV of the same expiry AND wing.
 *
 * CALLER OBLIGATION. Both arguments are bare floats — by the time they arrive,
 * `contractType` is gone and this function cannot tell a call's IV from a put's.
 * Calls and puts trace different skew curves, so mixing them returns a clean,
 * plausible, permanently wrong number. Unlike every other value in this module
 * it has no way to null itself in protest. The assembly site
 * (`useChainModel`) is what enforces the wing.
 */
export function vSkewVsAtm(iv: number | null, atmIv: number | null): number | null {
  if (iv === null || atmIv === null) return null;
  return iv - atmIv;
}

/**
 * Forward IV implied between the two expiries — the forward-variance identity
 * (the same one `packages/core/src/picker/domain/fwd-iv.ts` uses). Null rather
 * than NaN when the structure is inverted hard enough to drive the radicand
 * negative, and null when the two legs share a DTE (no forward period exists).
 *
 * ponytail: DTE is used directly as the time unit, exactly as the core version
 * does — the day-count cancels inside the ratio.
 */
export function forwardIv(
  frontDte: number,
  frontIv: number | null,
  backDte: number,
  backIv: number | null,
): number | null {
  if (frontIv === null || backIv === null) return null;
  if (backDte <= frontDte) return null;
  const radicand = (backDte * backIv * backIv - frontDte * frontIv * frontIv) / (backDte - frontDte);
  if (radicand < 0) return null;
  return Math.sqrt(radicand);
}

/**
 * Edge: front IV − forward IV. Positive means the front month is rich against
 * the forward the market itself is quoting — the thing a calendar is long.
 */
export function edge(
  frontDte: number,
  frontIv: number | null,
  backDte: number,
  backIv: number | null,
): number | null {
  const fwd = forwardIv(frontDte, frontIv, backDte, backIv);
  if (fwd === null || frontIv === null) return null;
  return frontIv - fwd;
}

/** Debit paid for one calendar: back mid − front mid. */
export function calendarDebit(frontMid: number, backMid: number): number {
  return backMid - frontMid;
}

/**
 * BSM greeks for one chain leg. Null when the row carries no IV or has already
 * expired — the table shows an em dash rather than a fabricated zero.
 *
 * `strike` arrives ×1000 per the frozen row contract and is un-scaled here so no
 * caller has to remember.
 *
 * ponytail: T = dte/365. `computeT` is settlement-aware but needs a wall clock
 * and a root; the row hands us an integer DTE and nothing else. Upgrade path:
 * take `observedAt` + the expiry root once the endpoint carries them.
 */
export function legGreeks(row: ChainRow): Greeks | null {
  if (row.bsmIv === null || row.bsmIv <= 0) return null;
  if (row.dte <= 0) return null;
  if (row.underlyingPrice <= 0) return null;
  return bsmGreeks(
    row.underlyingPrice,
    row.strike / 1000,
    row.dte / 365,
    row.bsmIv,
    DEFAULT_RATE,
    DEFAULT_DIV,
    row.contractType,
  );
}

/** Net greeks of the calendar: long the back leg, short the front. */
export function netGreeks(front: Greeks | null, back: Greeks | null): Greeks | null {
  if (front === null || back === null) return null;
  return {
    delta: back.delta - front.delta,
    gamma: back.gamma - front.gamma,
    theta: back.theta - front.theta,
    vega: back.vega - front.vega,
  };
}

/** One leg as the table renders it. */
export interface CalendarLeg {
  readonly expiration: string;
  readonly dte: number;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly iv: number | null;
  readonly vSkew: number | null;
  readonly openInterest: number;
  readonly greeks: Greeks | null;
  readonly source: "schwab" | "cboe";
  readonly observedAt: string;
}

/** One joined front+back row of the chain table. */
export interface ChainCalendarRow {
  /** Display strike (already ÷1000). */
  readonly strike: number;
  readonly contractType: "C" | "P";
  readonly front: CalendarLeg;
  readonly back: CalendarLeg;
  readonly hSkew: number | null;
  readonly frontVSkew: number | null;
  readonly backVSkew: number | null;
  readonly edge: number | null;
  readonly debit: number;
  readonly net: Greeks | null;
}

function toLeg(row: ChainRow, atmIv: number | null): CalendarLeg {
  return {
    expiration: row.expiration,
    dte: row.dte,
    bid: row.bid,
    ask: row.ask,
    mid: mid(row.bid, row.ask),
    iv: row.bsmIv,
    vSkew: vSkewVsAtm(row.bsmIv, atmIv),
    openInterest: row.openInterest,
    greeks: legGreeks(row),
    source: row.source,
    observedAt: row.observedAt,
  };
}

/**
 * Join a strike's front and back contracts into one table row.
 *
 * `atmFrontIv` / `atmBackIv` are that expiry's at-the-money IV, supplied by the
 * caller because they are a property of the whole expiry, not of this strike.
 */
export function buildCalendarRow(
  frontRow: ChainRow,
  backRow: ChainRow,
  atmFrontIv: number | null,
  atmBackIv: number | null,
): ChainCalendarRow {
  const front = toLeg(frontRow, atmFrontIv);
  const back = toLeg(backRow, atmBackIv);
  return {
    strike: frontRow.strike / 1000,
    contractType: frontRow.contractType,
    front,
    back,
    hSkew: hSkew(front.iv, back.iv),
    frontVSkew: front.vSkew,
    backVSkew: back.vSkew,
    edge: edge(front.dte, front.iv, back.dte, back.iv),
    debit: calendarDebit(front.mid, back.mid),
    net: netGreeks(front.greeks, back.greeks),
  };
}
