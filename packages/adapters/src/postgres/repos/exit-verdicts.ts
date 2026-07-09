import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingExitVerdict,
  ForReadingLatestVerdictsPerCalendar,
  ExitVerdictRow,
  StorageError,
} from "@morai/core";
import { exitVerdict } from "@morai/contracts";
import { asc, desc } from "drizzle-orm";
import { exitVerdicts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresExitVerdictsRepo — Postgres implementation of ForPersistingExitVerdict and
 * ForReadingLatestVerdictsPerCalendar (Phase 26, Plan 03).
 *
 * insertExitVerdict: INSERT ... ON CONFLICT (observed_at, calendar_id) DO NOTHING —
 * append-only history at per-calendar grain (mirrors picker_snapshot's D-06 convention,
 * calendar_snapshots' composite PK). A same-cohort retry/race (T-26-07) is a safe no-op:
 * first-write-wins, never an upsert. The verdict blob is validated via exitVerdict.parse
 * BEFORE insert — a contract-violating blob (e.g. empty ruleId, EXIT-04) throws and is
 * mapped to a StorageError, never silently stored (T-26-08).
 *
 * readLatestVerdictsPerCalendar: DISTINCT ON (calendar_id) ORDER BY calendar_id,
 * observed_at DESC — the newest verdict per calendar, feeding the 26-04 use-case's
 * hysteresis self-read. Each stored blob is re-validated via exitVerdict.safeParse AFTER read
 * (parse-don't-cast at the read seam); a legacy/corrupted row is SKIPPED with a console.warn
 * (WR-01) rather than failing the whole batch — one bad row must not take down verdict
 * computation and the API for every calendar.
 */
export type PostgresExitVerdictsRepo = {
  readonly insertExitVerdict: ForPersistingExitVerdict;
  readonly readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar;
};

export function makePostgresExitVerdictsRepo(db: Db): PostgresExitVerdictsRepo {
  const insertExitVerdict: ForPersistingExitVerdict = async (
    row: ExitVerdictRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      const validated = exitVerdict.parse(row.verdict);
      await db
        .insert(exitVerdicts)
        .values({
          observedAt: row.observedAt,
          calendarId: row.calendarId,
          verdict: validated,
        })
        .onConflictDoNothing(); // first-write-wins (WR-01, T-26-07) — composite PK is the only constraint
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar = async (): Promise<
    Result<ReadonlyArray<ExitVerdictRow>, StorageError>
  > => {
    try {
      const rows = await db
        .selectDistinctOn([exitVerdicts.calendarId], {
          observedAt: exitVerdicts.observedAt,
          calendarId: exitVerdicts.calendarId,
          verdict: exitVerdicts.verdict,
        })
        .from(exitVerdicts)
        // DISTINCT ON requires the distinct column to lead the ORDER BY; observed_at DESC
        // within each calendar makes the newest verdict win.
        .orderBy(asc(exitVerdicts.calendarId), desc(exitVerdicts.observedAt));

      // WR-01: parse per-row and SKIP a corrupted blob (with a console.warn) rather than
      // failing the whole batch — one bad row for one calendar must not take down verdict
      // computation and the API for every calendar (mirrors readJournal's unknown-source skip).
      const mapped: ExitVerdictRow[] = [];
      for (const row of rows) {
        const parsed = exitVerdict.safeParse(row.verdict);
        if (!parsed.success) {
          console.warn(
            `exit-verdicts: skipping corrupted verdict row for calendar ${row.calendarId}: ${parsed.error.message}`,
          );
          continue;
        }
        mapped.push({ observedAt: row.observedAt, calendarId: row.calendarId, verdict: parsed.data });
      }
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertExitVerdict, readLatestVerdictsPerCalendar };
}
