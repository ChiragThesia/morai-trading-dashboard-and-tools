/**
 * selfHealJournal use-case (HIST-03) — bounded-lookback wrapper over the plan-05 rebuild
 * engine (makeRebuildCalendarHistoryUseCase), scoped to OPEN calendars only.
 *
 * D-05's complement to OPS-01: the live freshness gate keeps refusing to write stale marks
 * as fresh; this use-case separately repairs the past slots that gate skipped, once usable
 * data exists in leg_observations. Fill-only via the rebuild engine's healSnapshot call
 * (never persistSnapshot), so a live row is never clobbered.
 *
 * Pure clock injection (now from deps); no Date.now(). Result-threaded, no try/catch.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForGettingOpenCalendars, StorageError } from "./ports.ts";
import type { ForRunningRebuildCalendarHistory, RebuildCoverage } from "./rebuildCalendarHistory.ts";

/** Default self-heal repair window, in days (HIST-03, D-05). */
export const SELF_HEAL_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SelfHealJournalInput = {
  readonly lookbackDays?: number;
};

export type SelfHealJournalDeps = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly rebuildCalendarHistory: ForRunningRebuildCalendarHistory;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2) */
  readonly now: () => Date;
};

export type ForRunningSelfHealJournal = (
  input?: SelfHealJournalInput,
) => Promise<Result<RebuildCoverage, StorageError>>;

/**
 * makeSelfHealJournalUseCase — factory returning the self-heal driver port.
 *
 * Reads OPEN calendars (getOpenCalendars returns open only — no closed calendar is ever
 * touched) and calls the rebuild engine per calendar with a window bounded to
 * [now - lookbackDays, now]. Aggregates the per-calendar RebuildCoverage into one total; a
 * StorageError from either port short-circuits the loop and propagates.
 */
export function makeSelfHealJournalUseCase(deps: SelfHealJournalDeps): ForRunningSelfHealJournal {
  return async (input) => {
    const lookbackDays = input?.lookbackDays ?? SELF_HEAL_LOOKBACK_DAYS;
    const now = deps.now();
    const window = { from: new Date(now.getTime() - lookbackDays * DAY_MS), to: now };

    const openResult = await deps.getOpenCalendars();
    if (!openResult.ok) return err(openResult.error);

    let slotsConsidered = 0;
    let rowsHealed = 0;
    let honestGapSlots = 0;

    for (const calendar of openResult.value) {
      const rebuildResult = await deps.rebuildCalendarHistory(calendar, window);
      if (!rebuildResult.ok) return err(rebuildResult.error);
      slotsConsidered += rebuildResult.value.slotsConsidered;
      rowsHealed += rebuildResult.value.rowsHealed;
      honestGapSlots += rebuildResult.value.honestGapSlots;
    }

    return ok({ slotsConsidered, rowsHealed, honestGapSlots });
  };
}
