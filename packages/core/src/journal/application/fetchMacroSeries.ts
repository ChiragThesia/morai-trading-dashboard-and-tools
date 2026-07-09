/**
 * fetchMacroSeries.ts — makeFetchMacroSeries orchestration use-case (MAC-01).
 *
 * Orchestrates: fetch 9 FRED series + VVIX independently (Promise.allSettled) → persist every
 * success → fail-loud finish naming any series that failed to fetch OR persist (D-07).
 *
 * Port contract:
 *   fetchFredSeries:         ForFetchingFredSeries          (parameterized FRED HTTP adapter, no fallback)
 *   fetchVvixQuote:          ForFetchingVvixQuote           (CBOE VVIX HTTP adapter)
 *   persistMacroObservation: ForPersistingMacroObservation  (Postgres repo / in-memory twin)
 *   fredSeriesIds?:          ReadonlyArray<string>          (defaults to the 9 FRED ids)
 *
 * Behaviour (D-07 best-effort + fail-loud finish):
 *   - Fetches run via Promise.allSettled — one series' rejection never short-circuits the batch.
 *   - Every fulfilled+ok fetch is persisted, independently of any other series' outcome.
 *   - After ALL persists are attempted: if any series failed to fetch OR persist, return
 *     err naming every failed series id (comma-joined); otherwise return ok(undefined).
 *   - This lets pg-boss mark the job failed and /api/status show lastErr while every
 *     success is already durably persisted — the next run self-heals gaps (D-05).
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingFredSeries,
  ForFetchingVvixQuote,
  ForPersistingMacroObservation,
  MacroObservationRow,
  FetchError,
} from "./ports.ts";

// ─── Domain constant ────────────────────────────────────────────────────────

/**
 * DEFAULT_FRED_SERIES_IDS — the nine FRED series fetched by default (MAC-01, MACRO-01,
 * BAMLH0A0HYM2 added Phase 24 MACRO-02/03 — see docs/architecture/regime-board.md).
 * A domain constant defined here — core cannot import @morai/contracts.
 */
export const DEFAULT_FRED_SERIES_IDS: ReadonlyArray<string> = [
  "DFF",
  "DGS1MO",
  "DGS3MO",
  "SOFR",
  "T10Y2Y",
  "T10Y3M",
  "VIXCLS",
  "VXVCLS",
  "BAMLH0A0HYM2",
];

// ─── Port type ────────────────────────────────────────────────────────────────

/** ForRunningFetchMacroSeries — the driver port returned by makeFetchMacroSeries. */
export type ForRunningFetchMacroSeries = () => Promise<Result<void, FetchError>>;

// ─── Task outcome shape ─────────────────────────────────────────────────────

type TaskOutcome = {
  readonly id: string;
  readonly result: Result<MacroObservationRow, FetchError>;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeFetchMacroSeries — inject deps, return the driver function (ForRunningFetchMacroSeries).
 *
 * The returned driver:
 *   1. Builds one fetch task per FRED series id (default: the 8 ids) plus one VVIX task.
 *   2. Runs all tasks via Promise.allSettled (per-series independence, D-07).
 *   3. Persists every fetch success independently of any other series' outcome.
 *   4. Collects every series that failed to fetch OR failed to persist.
 *   5. Returns ok(undefined) if none failed, else err naming every failed series.
 */
export function makeFetchMacroSeries(deps: {
  readonly fetchFredSeries: ForFetchingFredSeries;
  readonly fetchVvixQuote: ForFetchingVvixQuote;
  readonly persistMacroObservation: ForPersistingMacroObservation;
  readonly fredSeriesIds?: ReadonlyArray<string>;
}): ForRunningFetchMacroSeries {
  const fredSeriesIds = deps.fredSeriesIds ?? DEFAULT_FRED_SERIES_IDS;

  const tasks: ReadonlyArray<{
    readonly id: string;
    readonly fetch: () => Promise<Result<MacroObservationRow, FetchError>>;
  }> = [
    ...fredSeriesIds.map((id) => ({ id, fetch: () => deps.fetchFredSeries(id) })),
    { id: "VVIX", fetch: () => deps.fetchVvixQuote() },
  ];

  return async (): Promise<Result<void, FetchError>> => {
    // Each task absorbs its own rejection into a Result-shaped outcome so one series'
    // throw never short-circuits the batch — combined with Promise.allSettled, this
    // guarantees every series is attempted regardless of the others' outcome (D-07).
    const settled = await Promise.allSettled(
      tasks.map(async (task): Promise<TaskOutcome> => {
        try {
          const result = await task.fetch();
          return { id: task.id, result };
        } catch (thrown) {
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          return { id: task.id, result: err({ kind: "fetch-error" as const, message }) };
        }
      }),
    );

    const failed: Array<string> = [];

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        // Unreachable — every task above absorbs its own rejection. Kept for type safety.
        continue;
      }
      const { id, result } = outcome.value;
      if (!result.ok) {
        failed.push(id);
        continue;
      }
      // Best-effort persist: attempt every success independently of any other series' outcome.
      const persistResult = await deps.persistMacroObservation(result.value);
      if (!persistResult.ok) {
        failed.push(id);
      }
    }

    if (failed.length > 0) {
      return err({
        kind: "fetch-error",
        message: `macro fetch failed for: ${failed.join(", ")}`,
      });
    }
    return ok(undefined);
  };
}
