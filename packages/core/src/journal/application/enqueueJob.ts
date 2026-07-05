/**
 * makeEnqueueJobUseCase — composes dedupe-key domain functions with the ForEnqueueingJob port (JOB-01).
 *
 * Strategy:
 *   - "rebuild-journal" jobs: use rebuildDedupeKey(calendarId) → calendar-scoped key
 *   - "recompute-snapshot-pnl" jobs: use recomputeSnapshotPnlDedupeKey(calendarId) →
 *     calendar-scoped key (JRNL-01 pnl-unit-mismatch fix; mirrors rebuild-journal — a
 *     window-based key would wrongly collapse two DIFFERENT calendars triggered in the
 *     same window into one dedupe key)
 *   - All other jobs (scheduled): use scheduledDedupeKey(name, now, 10) → 10-min window key
 *
 * The use-case owns key selection; the jobQueue port only enqueues with the provided key.
 * This separation keeps pg-boss specifics out of domain logic (architecture-boundaries.md §2).
 *
 * Pure composition: no I/O beyond delegating to jobQueue port.
 */

import type { Result } from "@morai/shared";
import type { ForEnqueueingJob, StorageError } from "./ports.ts";
import {
  scheduledDedupeKey,
  rebuildDedupeKey,
  recomputeSnapshotPnlDedupeKey,
} from "../domain/dedupe-key.ts";

export type EnqueueJobDeps = {
  /** The driven port (pg-boss adapter in prod; in-memory twin in tests) */
  readonly jobQueue: ForEnqueueingJob;
  /** Clock injection — never call Date.now() in core */
  readonly now: () => Date;
};

/**
 * makeEnqueueJobUseCase — factory returning the driver port ForEnqueueingJob.
 *
 * The returned function:
 *   1. Computes the correct dedupe key for the job name
 *   2. Delegates to the injected jobQueue port
 *   3. Returns the jobId (or null if already queued) or StorageError
 */
export function makeEnqueueJobUseCase(
  deps: EnqueueJobDeps,
): (
  name: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<Result<string | null, StorageError>> {
  return async (
    name: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Result<string | null, StorageError>> => {
    const dedupeKey = buildDedupeKey(name, payload, deps.now());
    return deps.jobQueue(name, payload, dedupeKey);
  };
}

/**
 * buildDedupeKey — select the correct dedupe strategy per job name.
 *
 * rebuild-journal / recompute-snapshot-pnl: payload.calendarId is the natural scope (one
 * active job per calendar at a time — a window key would collapse different calendars).
 * All others: 10-min window key prevents duplicates within the same scheduling window.
 */
function buildDedupeKey(
  name: string,
  payload: Readonly<Record<string, unknown>>,
  now: Date,
): string | null {
  if (name === "rebuild-journal" || name === "recompute-snapshot-pnl") {
    // Calendar-scoped: extract calendarId from payload
    const calendarId = payload["calendarId"];
    if (typeof calendarId === "string" && calendarId.length > 0) {
      return name === "rebuild-journal"
        ? rebuildDedupeKey(calendarId)
        : recomputeSnapshotPnlDedupeKey(calendarId);
    }
    // No calendarId → no dedup (on-demand without scope)
    return null;
  }

  // Scheduled jobs: 10-min window key
  return scheduledDedupeKey(name, now, 10);
}
