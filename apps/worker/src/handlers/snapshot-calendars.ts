import type { Job } from "pg-boss";
import { z } from "zod";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSnapshotCalendars } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

// SNAP-01 (20-06): optional job-payload trigger — parse, don't cast (typescript.md).
// Absent field or a failed parse both default to "scheduled" (D-12 default-at-the-edge).
const jobPayloadSchema = z.object({
  trigger: z.enum(["scheduled", "event-move"]).optional(),
});

type SnapshotCalendarsHandlerDeps = {
  /** The wired snapshotCalendars use-case (composition root provides this). */
  readonly snapshotCalendarsUseCase: ForRunningSnapshotCalendars;
  /** pg-boss instance — used only to enqueue compute-analytics on success (06-04 chain). */
  readonly boss: BossForChainHandler;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeSnapshotCalendarsHandler — thin adapter wrapping the snapshotCalendars use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday self-check → call use-case → map Result → boss.send.
 *
 * CAL-05: RTH + NYSE holiday self-check. Outside RTH or on holidays → no-op + warn.
 * 06-04 (D-03 chain extension): on success, fire-and-forget enqueue of compute-analytics with a
 *   singletonKey (prevents duplicate enqueues) — exactly the compute-bsm-greeks→snapshot pattern.
 *   snapshot-calendars is no longer terminal; compute-analytics is the new last step.
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

    // SNAP-01 (20-06): parse the optional trigger field; absent/invalid -> "scheduled".
    const payloadResult = jobPayloadSchema.safeParse(job.data);
    const trigger = payloadResult.success && payloadResult.data.trigger !== undefined
      ? payloadResult.data.trigger
      : "scheduled";

    const result = await deps.snapshotCalendarsUseCase({ trigger });
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }

    // D-03 (06-04): enqueue compute-analytics on success; singletonKey prevents duplicate enqueues.
    // void: fire-and-forget — a send failure does not fail the snapshot job.
    void deps.boss.send("compute-analytics", {}, {
      singletonKey: "triggered-by-snapshot",
    }).catch((e: unknown) => {
      console.warn("snapshot-calendars: failed to enqueue compute-analytics", e);
    });
  };
}
