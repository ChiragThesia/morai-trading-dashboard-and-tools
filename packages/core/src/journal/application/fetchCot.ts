/**
 * fetchCot.ts — makeFetchCot orchestration use-case (COT-01).
 *
 * Orchestrates: fetch CotReport → stamp publishedAt from injected clock → persist.
 *
 * Port contract:
 *   fetchCotReport:     ForFetchingCotReport   (CFTC Socrata HTTP adapter / in-memory twin)
 *   persistCotObservation: ForPersistingCotObservation  (Postgres repo / in-memory twin)
 *   now:                () => Date              (injected clock — stamps publishedAt, D-07)
 *   contractCode?:      string                  (defaults to "13874A" E-mini S&P 500 TFF futures-only)
 *
 * Behaviour on err: fetch failure → propagate err, skip persist (no fabricated fallback).
 * Idempotency: the repo's ON CONFLICT (contract_code, as_of) DO NOTHING absorbs re-runs
 * for the same as_of week; the use-case does not need its own dedup logic (D-09).
 *
 * D-07: publishedAt = injected clock (Friday fetch time), NOT from the adapter.
 * D-08: as_of = report's own date field (Tuesday report date), NOT computed by subtracting days.
 *
 * ForRunningFetchCot is the driver port type consumed by 13-05's pg-boss job handler.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingCotReport,
  ForPersistingCotObservation,
  FetchError,
  StorageError,
} from "./ports.ts";

// ─── Port type ────────────────────────────────────────────────────────────────

/**
 * ForRunningFetchCot — the driver port returned by makeFetchCot.
 * 13-05's pg-boss job handler injects this as its `fetchCot` dependency.
 */
export type ForRunningFetchCot = () => Promise<Result<void, FetchError | StorageError>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeFetchCot — inject deps, return the driver function (ForRunningFetchCot).
 *
 * The returned driver:
 *   1. Fetches the CotReport for `contractCode` via `fetchCotReport`.
 *   2. On fetch err → returns err (persist is skipped).
 *   3. On fetch ok → builds CotObservationRow = report + { publishedAt: now() }.
 *   4. Calls `persistCotObservation(row)` — idempotent at the repo layer (D-09).
 *   5. Returns ok(void) on success or propagates the StorageError on persist failure.
 */
export function makeFetchCot(deps: {
  readonly fetchCotReport: ForFetchingCotReport;
  readonly persistCotObservation: ForPersistingCotObservation;
  readonly now: () => Date;
  readonly contractCode?: string;
}): ForRunningFetchCot {
  const code = deps.contractCode ?? "13874A";

  return async (): Promise<Result<void, FetchError | StorageError>> => {
    // Step 1: fetch — no fabricated fallback; a missing week returns err (landmine 4)
    const fetchResult = await deps.fetchCotReport(code);
    if (!fetchResult.ok) {
      return err(fetchResult.error);
    }

    // Step 2: stamp publishedAt from the injected clock (D-07, Friday fetch time).
    // as_of is read directly from the report (D-08, Tuesday report date).
    const row = {
      ...fetchResult.value,
      publishedAt: deps.now(),
    };

    // Step 3: persist — idempotent via ON CONFLICT (contract_code, as_of) DO NOTHING
    const persistResult = await deps.persistCotObservation(row);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    return ok(undefined);
  };
}
