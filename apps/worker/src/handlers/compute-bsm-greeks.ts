import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

// Import via @morai/core (return type of makeComputeBsmGreeksUseCase)
type ComputeBsmGreeksUseCase = () => Promise<{ ok: boolean; error?: { message: string } }>;

type ComputeBsmGreeksHandlerDeps = {
  /** The wired computeBsmGreeks use-case (composition root provides this). */
  readonly computeBsmGreeksUseCase: ComputeBsmGreeksUseCase;
  /** pg-boss instance — used only to enqueue snapshot-calendars on success (D-03). */
  readonly boss: BossForChainHandler;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeComputeBsmGreeksHandler — thin adapter wrapping the computeBsmGreeks use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday gate → call use-case → map Result → boss.send.
 *
 * CAL-05 (Blocker 3): holiday + RTH gate applied BEFORE use-case call.
 *   A holiday compute run must NEVER chain-trigger a snapshot. The gate here prevents that.
 *   Previously no gate; adding it closes the SPEC §6 hole.
 *
 * D-03: On success, enqueue snapshot-calendars with singletonKey to prevent duplicate enqueues.
 *   Fire-and-forget (void): boss.send failure does NOT fail the compute job.
 *
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputeBsmGreeksHandler(
  deps: ComputeBsmGreeksHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // CAL-05 / Blocker 3: RTH + NYSE holiday gate.
    // Must sit BEFORE the use-case call so a holiday run cannot chain-trigger a snapshot.
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("compute-bsm-greeks: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.computeBsmGreeksUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      const message = result.error?.message ?? "computeBsmGreeks use-case failed";
      throw new Error(message);
    }

    // D-03: enqueue snapshot-calendars on success; singletonKey prevents duplicate enqueues
    // void: pg-boss send is fire-and-forget here; failure does not fail the compute job
    void deps.boss.send("snapshot-calendars", {}, {
      singletonKey: "triggered-by-compute",
    }).catch((e: unknown) => {
      console.warn("compute-bsm-greeks: failed to enqueue snapshot-calendars", e);
    });
  };
}
