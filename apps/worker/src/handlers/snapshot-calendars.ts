import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSnapshotCalendars } from "@morai/core";

type SnapshotCalendarsHandlerDeps = {
  /** The wired snapshotCalendars use-case (composition root provides this). */
  readonly snapshotCalendarsUseCase: ForRunningSnapshotCalendars;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeSnapshotCalendarsHandler — thin adapter wrapping the snapshotCalendars use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday self-check → call use-case → map Result → throw on err.
 *
 * CAL-05: RTH + NYSE holiday self-check. Outside RTH or on holidays → no-op + warn.
 *   This is the terminal job in the compute chain (no further boss.send — D-03).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeSnapshotCalendarsHandler(
  deps: SnapshotCalendarsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // CAL-05: RTH + NYSE holiday gate — no-op outside market hours or on holidays
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("snapshot-calendars: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.snapshotCalendarsUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }
    // Terminal job — no boss.send (D-03: snapshot is the last step in the chain)
  };
}
