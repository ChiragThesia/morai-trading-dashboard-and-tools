import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingBacktestRun, BacktestRunRow, StorageError } from "@morai/core";
import { backtestReportSchema } from "../../backtest-report-schema.ts";
import { backtestRuns } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresBacktestRunsRepo — Postgres implementation of ForPersistingBacktestRun
 * (Phase 27, Plan 01).
 *
 * insertBacktestRun: plain INSERT — no onConflictDoNothing/onConflictDoUpdate, no update or
 * delete method on this repo (BT-05: the harness's only write path). id/createdAt are
 * DB-generated (defaultRandom/defaultNow) so every run gets its own row; two runs never
 * collide. The report blob is validated via backtestReportSchema.parse BEFORE insert — a
 * malformed blob throws and is mapped to a StorageError, never silently stored.
 */
export type PostgresBacktestRunsRepo = {
  readonly insertBacktestRun: ForPersistingBacktestRun;
};

export function makePostgresBacktestRunsRepo(db: Db): PostgresBacktestRunsRepo {
  const insertBacktestRun: ForPersistingBacktestRun = async (
    row: BacktestRunRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      const validatedReport = backtestReportSchema.parse(row.report);
      await db.insert(backtestRuns).values({
        params: row.params,
        report: validatedReport,
      });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertBacktestRun };
}
