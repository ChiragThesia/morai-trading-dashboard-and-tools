/**
 * journal-history.ts — Pre-Jun-12 history classifier (JOURNAL-01).
 *
 * Chain history (30-min snapshots of price/greeks) is only available from 2026-06-12
 * onward — when the leg_observations data pipeline started. Trades entirely predating
 * this date have no day-by-day view; only entry/exit events are known.
 *
 * The classifier is a pure function — no I/O, no external state. It answers:
 *   "does this trade have access to the lifecycle chart?"
 *
 * classifyTradeHistory returns:
 *   "history"         — lifecycle chart available (snapshots on/after Jun-12 exist)
 *   "entry-exit-only" — only entry/exit data; show the graceful stub (never error)
 *
 * JOURNAL-01: This is the key guard. UI must NEVER show an error or blank screen
 * for a pre-Jun-12 trade — show the entry/exit-only badge + dashed stub instead.
 */

/** ISO 8601 date at which chain-history data starts (inclusive). */
export const CHAIN_HISTORY_START = "2026-06-12";

/** Classification result for a trade's history availability. */
export type TradeHistoryKind = "history" | "entry-exit-only";

/** Minimal trade shape required by the classifier. */
export interface TradeHistoryInput {
  /** ISO datetime when the trade opened. */
  readonly openedAt: string;
  /** ISO datetime when the trade closed, or null for OPEN trades. */
  readonly closedAt: string | null;
  /** Whether any snapshots (from the journal) exist for this trade. */
  readonly hasSnapshots: boolean;
}

/**
 * classifyTradeHistory — classify a trade as "history" or "entry-exit-only".
 *
 * Logic:
 * 1. If `hasSnapshots` is true → chain data exists for this trade → "history".
 * 2. If `hasSnapshots` is false:
 *    - If `closedAt` is null (OPEN) or `closedAt` is on or after the chain start → "history"
 *      would be expected eventually, but no snapshots yet means we fall back to "entry-exit-only".
 *    - If the trade closed entirely before the chain start → "entry-exit-only".
 *
 * The critical invariant: `hasSnapshots` is the authoritative signal. When the server
 * returns snapshots, the trade has chain data regardless of date math.
 */
export function classifyTradeHistory(trade: TradeHistoryInput): TradeHistoryKind {
  // Primary signal: server returned actual snapshots → history is available
  if (trade.hasSnapshots) {
    return "history";
  }

  // No snapshots. Check if the trade's lifecycle could ever produce them.
  // If the trade's open date is on/after the chain start, snapshots will arrive eventually
  // (or the trade is too new to have them yet). Either way, no snapshots now = entry-exit-only.
  const chainStart = new Date(CHAIN_HISTORY_START).getTime();
  const openedAt = new Date(trade.openedAt).getTime();

  // A trade opened before the chain start that has no snapshots → entry-exit-only
  // A trade opened on/after the chain start but with no snapshots → still entry-exit-only
  // (no snapshots available regardless of when the trade opened)
  const closedBefore =
    trade.closedAt !== null &&
    new Date(trade.closedAt).getTime() < chainStart;

  const openedBefore = openedAt < chainStart;

  // If the trade's entire lifecycle predates chain start → entry-exit-only
  // If the trade overlaps chain start (opened before, no close yet, or closed after) but still
  // has no snapshots → also entry-exit-only (snapshots are the authoritative signal)
  if (openedBefore && closedBefore) {
    return "entry-exit-only";
  }

  // Trade opened before chain start but closed after it (or still open) — still no snapshots
  return "entry-exit-only";
}
