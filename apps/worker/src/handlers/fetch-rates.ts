import type { Job } from "pg-boss";
import { isNyseHoliday } from "@morai/core";

// Import via @morai/core (ForRunningFetchRate is the return type of makeFetchRateUseCase)
type FetchRateUseCase = () => Promise<{ ok: boolean; error?: { message: string } }>;

// 14-05 (MAC-01): mirrors FetchRateUseCase's local shape — ForRunningFetchMacroSeries
// returns Result<void, FetchError> from @morai/core, structurally compatible.
type FetchMacroSeriesUseCase = () => Promise<{ ok: boolean; error?: { message: string } }>;

type FetchRatesHandlerDeps = {
  /** The wired fetchRate use-case (composition root provides this). */
  readonly fetchRateUseCase: FetchRateUseCase;
  /** 14-05 (MAC-01): the wired fetchMacroSeries use-case (composition root provides this). */
  readonly fetchMacroSeriesUseCase: FetchMacroSeriesUseCase;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeFetchRatesHandler — thin adapter wrapping the fetchRate + fetchMacroSeries use-cases
 * as a single pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → holiday check → call fetchRate use-case → call fetchMacroSeries
 * use-case → map Result → throw on err.
 *
 * Blocker 2 / CAL-05: NYSE holiday-only guard added. No RTH gate — FRED rate fetch
 * is a daily job (0 9 * * 1-5, + 30 18 * * 1-5 per D-06); running at 09:00 ET is before
 * RTH open, but the rate data is valid all day and the job should run on any weekday.
 * (RESEARCH A2)
 * D-08: no manual trigger registration.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 * 14-05 (MAC-01/D-02/D-07): fetchMacroSeriesUseCase runs additively after the unchanged
 * fetchRate call; the existing rate path (call + throw-on-err) is byte-for-byte untouched.
 * A macro Result err also throws so pg-boss marks the job failed (D-07 — no silent holes).
 */
export function makeFetchRatesHandler(
  deps: FetchRatesHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // CAL-05 (holiday-only; no RTH gate per RESEARCH A2):
    if (isNyseHoliday(deps.now())) {
      console.warn("fetch-rates: skipping — NYSE holiday");
      return;
    }

    const result = await deps.fetchRateUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      const message = result.error?.message ?? "fetchRate use-case failed";
      throw new Error(message);
    }

    // 14-05 (MAC-01/D-02): additive — runs after the unchanged rate call above.
    const macroResult = await deps.fetchMacroSeriesUseCase();
    if (!macroResult.ok) {
      // D-07: fail loud so pg-boss marks the job failed and /api/status shows lastErr.
      const message =
        macroResult.error?.message ?? "fetchMacroSeries use-case failed";
      throw new Error(message);
    }
  };
}
