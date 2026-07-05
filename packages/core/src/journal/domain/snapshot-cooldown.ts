/**
 * isWithinCooldown — pure cross-process cooldown check (SNAP-01, D-06, Pitfall 2).
 *
 * The scheduled snapshot cadence runs in apps/worker; the event-triggered detector
 * runs in apps/server — two separate OS processes. An in-memory "last fired at"
 * variable in the detector cannot see a snapshot the worker's cron chain just wrote.
 * The caller resolves `lastSnapshotAt` from Postgres (SELECT MAX(time) FROM
 * calendar_snapshots, via ForReadingLatestSnapshotTime) so the cooldown check below
 * is correct regardless of which process last wrote a row.
 *
 * Pure: Date passed in explicitly, never Date.now(). No imports from outside
 * @morai/shared (architecture-boundaries.md §2).
 */

/** D-06: at most one supplemental snapshot between 30-min scheduled runs. */
export const SNAPSHOT_COOLDOWN_MS = 15 * 60_000;

/**
 * Returns true when `now` is within `cooldownMs` of `lastSnapshotAt` — i.e. a new
 * snapshot should be suppressed. No prior snapshot (null) is never within cooldown.
 * The exact boundary (now - last === cooldownMs) is NOT within cooldown.
 */
export function isWithinCooldown(
  now: Date,
  lastSnapshotAt: Date | null,
  cooldownMs: number,
): boolean {
  if (lastSnapshotAt === null) return false;
  return now.getTime() - lastSnapshotAt.getTime() < cooldownMs;
}
