import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingBacktestRun, BacktestRunRow, StorageError } from "@morai/core";
import { backtestReportSchema } from "../backtest-report-schema.ts";

/**
 * makeMemoryBacktestRunsRepo — in-memory twin of the Postgres backtest-runs adapter
 * (Phase 27, Plan 01).
 *
 * insertBacktestRun: append-only array push, mirroring the Postgres adapter's INSERT-only
 * behavior (BT-05) — no update/delete method exists. The report blob is validated via
 * backtestReportSchema.parse BEFORE storing — matches the Postgres write-boundary
 * validation exactly.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryBacktestRunsRepo = {
  readonly insertBacktestRun: ForPersistingBacktestRun;
  /** countRuns — test helper: count rows in backtest_runs. */
  readonly countRuns: () => Promise<number>;
};

export function makeMemoryBacktestRunsRepo(): MemoryBacktestRunsRepo {
  const rows: BacktestRunRow[] = [];

  const insertBacktestRun: ForPersistingBacktestRun = async (
    row: BacktestRunRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      backtestReportSchema.parse(row.report);
      rows.push(row); // append-only — never replaces an existing row
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const countRuns = async (): Promise<number> => rows.length;

  return { insertBacktestRun, countRuns };
}
