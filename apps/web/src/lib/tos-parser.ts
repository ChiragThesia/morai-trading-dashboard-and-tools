/**
 * TOS calendar paste parser — 9 locked rules
 *
 * Parses a free-text TOS order string into a typed ParsedCalendar struct.
 * Pure TS over a plain string — no DOM, no eval, no dangerouslySetInnerHTML.
 *
 * Security (T-09-06 — V5 Input Validation):
 *   - Operates on a plain string only — never writes to DOM.
 *   - Never uses eval.
 *   - Returns null on parse failure (never throws).
 *   - Parsed output renders via React JSX auto-escape at the call site.
 *
 * Rules (UI-SPEC TOS Calendar Paste Parser Contract):
 *   1. Extract BUY/SELL + qty (+N/-N or bare N). qty = Math.abs(N), min 1.
 *   2. Extract PUT or CALL. Default P if absent.
 *   3. Extract strike: last 3–5 digit number before PUT/CALL. Round to integer.
 *   4. Extract debit: number after @. Optional.
 *   5. Extract two dates: DD MMM YY patterns. Sort ascending → front (earlier) / back (later).
 *   6. Compute front/back DTE from today. Reject if front DTE ≤ 0 or back DTE ≤ front DTE.
 *   7. Extract underlying from CALENDAR {SYMBOL}. Default SPX.
 *   8. Imply flat IV: bisect for iv such that BSM(back,iv)−BSM(front,iv)≈debit. Default 15%.
 *   9. Call + Put calendars both supported.
 */

import { impliedFlatIv } from "./iv-bisection.ts";

// ─────────────────────────────────────────────────────────────
// Month name → 0-based month index
// ─────────────────────────────────────────────────────────────
const MONTH_INDEX: Readonly<Record<string, number>> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

/**
 * Parsed calendar spread returned by parseTosOrder on success.
 * All numeric fields are finite; iv is always > 0.
 */
export type ParsedCalendar = {
  /** Underlying symbol (e.g. "SPX"). */
  readonly underlying: string;
  /** Absolute quantity (min 1). */
  readonly qty: number;
  /** Option type: 'C' for call, 'P' for put. */
  readonly type: "C" | "P";
  /** Strike price (integer). */
  readonly strike: number;
  /** Observed debit of the spread (null if not provided). */
  readonly debit: number | null;
  /** Days to front (earlier) expiry from today. Always > 0. */
  readonly frontDte: number;
  /** Days to back (later) expiry from today. Always > frontDte. */
  readonly backDte: number;
  /**
   * Flat implied IV (decimal) such that BSM(back,iv)−BSM(front,iv)≈debit.
   * Defaults to 0.15 (15%) when no debit is provided.
   */
  readonly iv: number;
};

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

/**
 * Parse a TOS calendar order string into a typed ParsedCalendar struct.
 *
 * @param text  - Raw TOS order string (e.g. from clipboard paste).
 * @param today - The reference date for DTE computation (typically new Date()).
 * @param spot  - Current spot price of the underlying (for IV bisection, Rule 8).
 * @param rate  - Risk-free rate decimal (for IV bisection, Rule 8).
 * @returns ParsedCalendar on success, null on parse failure.
 *          Never throws — all failures return null.
 */
export function parseTosOrder(
  text: string,
  today: Date,
  spot: number,
  rate: number,
): ParsedCalendar | null {
  // Normalise to uppercase for case-insensitive matching (reference impl pattern)
  const s = text.trim().toUpperCase();

  // ── Rule 1: BUY/SELL + qty ──────────────────────────────────
  const qtyMatch = s.match(/\b(BUY|SELL)\s*([+-]?\d+)/);
  const rawQty = qtyMatch ? Math.abs(Number(qtyMatch[2])) : 1;
  const qty = Math.max(1, rawQty);

  // ── Rule 2: PUT/CALL (default P) ────────────────────────────
  const typeMatch = s.match(/\b(PUT|CALL)\b/);
  const type: "C" | "P" =
    typeMatch?.[1] === "CALL" ? "C" : "P";

  // ── Rule 3: Strike — last 3–5 digit group before PUT/CALL ───
  const strikeMatch = s.match(/([\d]{3,5}(?:\.\d+)?)\s*(?:PUT|CALL)/);
  if (!strikeMatch) {
    return null; // no strike → parse failure
  }
  const strike = Math.round(Number(strikeMatch[1]));

  // ── Rule 4: Debit — number after @ (optional) ───────────────
  const debitMatch = s.match(/@\s*([\d.]+)/);
  const debit = debitMatch ? Number(debitMatch[1]) : null;

  // ── Rule 5: Two dates — DD MMM YY patterns ──────────────────
  // Pattern: 1–2 digit day, then exactly one of the 12 month abbreviations, then 2-digit year.
  // The month group is anchored to valid month names to prevent false matches like "00 PUT 30".
  const MONTH_ALT = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";
  const datePattern = new RegExp(`(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{2})`, "g");
  const rawDates: number[] = [];
  for (const m of s.matchAll(datePattern)) {
    const dayStr = m[1];
    const monthName = m[2];
    const yearStr = m[3];
    if (dayStr === undefined || monthName === undefined || yearStr === undefined) continue;
    const day = Number(dayStr);
    const year = 2000 + Number(yearStr);
    const monthIdx: number | undefined = MONTH_INDEX[monthName];
    if (monthIdx === undefined) continue;
    const ms = Date.UTC(year, monthIdx, day);
    if (!isNaN(ms)) rawDates.push(ms);
  }

  if (rawDates.length < 2) {
    return null; // fewer than 2 expiries → parse failure
  }

  rawDates.sort((a, b) => a - b);
  // Already guarded rawDates.length >= 2 above; use non-null assertion is forbidden.
  // Use explicit index check + cast to avoid noUncheckedIndexedAccess errors.
  const frontMs: number = rawDates[0] ?? 0;
  const backMs: number = rawDates[1] ?? 0;
  if (frontMs === 0 || backMs === 0) return null;

  // ── Rule 6: DTE validation ───────────────────────────────────
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const frontDte = Math.round((frontMs - todayMs) / 86400000);
  const backDte = Math.round((backMs - todayMs) / 86400000);

  if (frontDte <= 0 || backDte <= frontDte) {
    return null; // DTE validation failed
  }

  // ── Rule 7: Underlying (default SPX) ────────────────────────
  const undMatch = s.match(/CALENDAR\s+([A-Z]+)/);
  const underlying = undMatch?.[1] ?? "SPX";

  // ── Rule 8: Implied flat IV ──────────────────────────────────
  // q = 0.013 (SPX continuous dividend yield, D-01 default)
  const q = 0.013;
  const iv = impliedFlatIv({
    S: spot,
    K: strike,
    frontT: frontDte / 365,
    backT: backDte / 365,
    type,
    r: rate,
    q,
    debit,
  });

  // ── Rule 9: both PUT and CALL are supported (handled by Rule 2 above) ──

  return { underlying, qty, type, strike, debit, frontDte, backDte, iv };
}
