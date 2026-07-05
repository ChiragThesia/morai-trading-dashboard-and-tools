/**
 * dedupe-key — deterministic deduplication key functions (JOB-01, Plan 05-04).
 *
 * Two strategies:
 *   - scheduledDedupeKey: floors now to a window boundary → "{jobName}:{windowStart.toISOString()}"
 *     Used for cron-scheduled jobs (sync-fills, fetch-schwab-chain, etc.)
 *   - rebuildDedupeKey: calendar-scoped key for on-demand rebuild-journal jobs
 *
 * Pure functions; no I/O. Window flooring mirrors pg-boss singletonKey semantics:
 * a second enqueue with the same key within the window is a no-op (RESEARCH Pitfall 1).
 */

/**
 * scheduledDedupeKey — floors `now` to the nearest `windowMinutes` boundary (UTC)
 * and returns "{jobName}:{windowStart.toISOString()}".
 *
 * Example (windowMinutes=10):
 *   now = 2026-06-21T14:12:34Z → windowStart = 2026-06-21T14:10:00.000Z
 *   key = "sync-fills:2026-06-21T14:10:00.000Z"
 *
 * Two calls with different times within the SAME window produce the same key.
 * Calls in adjacent windows produce different keys.
 */
export function scheduledDedupeKey(
  jobName: string,
  now: Date,
  windowMinutes: number,
): string {
  const windowMs = windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return `${jobName}:${windowStart.toISOString()}`;
}

/**
 * rebuildDedupeKey — calendar-scoped key for on-demand rebuild-journal jobs.
 * Returns "rebuild-journal:{calendarId}".
 *
 * Ensures only one rebuild per calendar can be active in pg-boss at a time.
 */
export function rebuildDedupeKey(calendarId: string): string {
  return `rebuild-journal:${calendarId}`;
}

/**
 * recomputeSnapshotPnlDedupeKey — calendar-scoped key for on-demand recompute-snapshot-pnl
 * jobs (JRNL-01 pnl-unit-mismatch fix). Returns "recompute-snapshot-pnl:{calendarId}".
 *
 * Mirrors rebuildDedupeKey: without a calendar-scoped key, the scheduledDedupeKey window
 * strategy would collapse two DIFFERENT calendars triggered in the same 10-min window into
 * one dedupe key, silently no-oping the second calendar's recompute.
 */
export function recomputeSnapshotPnlDedupeKey(calendarId: string): string {
  return `recompute-snapshot-pnl:${calendarId}`;
}
