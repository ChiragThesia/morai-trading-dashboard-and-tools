/**
 * detectLargeMove — pure rolling-window % move detector (SNAP-01, D-05, Pattern 2).
 *
 * Compares the newest SPX spot sample against the oldest sample retained in a
 * rolling time window; triggers when the absolute % move is at or above thresholdPct.
 *
 * Pure: no I/O, no Date.now() (caller passes sample timestamps in ms). Cannot fail,
 * so no Result wrapper is needed — always returns a plain object.
 *
 * No imports from outside @morai/shared (architecture-boundaries.md §2).
 */

export type SpotSample = {
  readonly ts: number; // epoch ms
  readonly price: number;
};

/** D-05: ~5min rolling window — catches fast spikes, excludes slow all-day drift. */
export const MOVE_WINDOW_MS = 5 * 60_000;

/** D-05: 1% index-level move — SPX moving 1% intraday is already materially large. */
export const MOVE_THRESHOLD_PCT = 0.01;

/**
 * Prunes samples older than windowMs relative to newSample.ts, appends newSample,
 * and checks whether the absolute % move from the oldest retained sample to
 * newSample meets or exceeds thresholdPct. Empty pruned window (cold start) never
 * triggers.
 */
export function detectLargeMove(
  window: ReadonlyArray<SpotSample>,
  newSample: SpotSample,
  windowMs: number,
  thresholdPct: number,
): { readonly triggered: boolean; readonly nextWindow: ReadonlyArray<SpotSample> } {
  const pruned = window.filter((s) => newSample.ts - s.ts <= windowMs);
  const nextWindow = [...pruned, newSample];
  const oldest = pruned[0]; // oldest remaining sample; undefined on cold start
  if (oldest === undefined) return { triggered: false, nextWindow };
  const pctMove = Math.abs(newSample.price - oldest.price) / oldest.price;
  return { triggered: pctMove >= thresholdPct, nextWindow };
}
