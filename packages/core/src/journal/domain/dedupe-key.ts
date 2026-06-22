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
