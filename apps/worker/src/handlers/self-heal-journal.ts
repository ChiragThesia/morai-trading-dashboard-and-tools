/**
 * self-heal-journal handler — recurring repair job for OPEN calendars (HIST-03).
 *
 * Sparse hourly cron (no RTH gate — repairs PAST slots via leg_observations, not
 * time-of-day sensitive). Thin adapter wrapping selfHealJournal (bounded-lookback,
 * OPEN-only, fill-only heal via the plan-05 rebuild engine) — the OPS-01 live freshness
 * gate is untouched (D-05).
 *
 * Gate:
 *   - NO RTH gate — sparse cron, runs anytime
 *   - Payload: { lookbackDays?: number } — Zod-parsed at handler boundary (JOB-01)
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRunningSelfHealJournal } from "@morai/core";
import { SELF_HEAL_LOOKBACK_DAYS } from "@morai/core";

const DAY_MS = 24 * 60 * 60 * 1000;

export const selfHealJournalPayload = z.object({ lookbackDays: z.number().optional() });

export type SelfHealJournalHandlerDeps = {
  readonly selfHealJournalUseCase: ForRunningSelfHealJournal;
  readonly now: () => Date;
};

export function makeSelfHealJournalHandler(
  deps: SelfHealJournalHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — sparse cron, repairs past slots anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = selfHealJournalPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`self-heal-journal: invalid payload: ${payloadResult.error.message}`);
    }

    // exactOptionalPropertyTypes: never pass an explicit `lookbackDays: undefined` — omit
    // the key entirely so the use-case's own default (SELF_HEAL_LOOKBACK_DAYS) applies.
    const { lookbackDays } = payloadResult.data;
    const result = await deps.selfHealJournalUseCase(
      lookbackDays !== undefined ? { lookbackDays } : {},
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    // Observability: one line per run. Without it prod cannot distinguish "ran, healed 0"
    // from "ran, honest-gap N" (the pre-anchor-window blind spot) from "ran, errored N".
    // The window here mirrors the use-case's own [now - lookback, now] (self-contained; the
    // aggregate RebuildCoverage does not carry the window).
    const to = deps.now();
    const from = new Date(to.getTime() - (lookbackDays ?? SELF_HEAL_LOOKBACK_DAYS) * DAY_MS);
    const { slotsConsidered, rowsHealed, honestGapSlots, errorCount } = result.value;
    console.warn(
      `self-heal-journal: slots=${slotsConsidered} healed=${rowsHealed} honestGaps=${honestGapSlots} errors=${errorCount} window=[${from.toISOString()}..${to.toISOString()}]`,
    );
  };
}
