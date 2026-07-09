import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingExitVerdict,
  ForReadingLatestVerdictsPerCalendar,
  ExitVerdictRow,
  StorageError,
} from "@morai/core";
import { exitVerdict } from "@morai/contracts";

/**
 * makeMemoryExitVerdictsRepo — in-memory twin of the Postgres exit-verdicts adapter
 * (Phase 26, Plan 03).
 *
 * insertExitVerdict: keyed by `${observedAt.toISOString()}:${calendarId}` — a duplicate
 * key is a no-op, mirroring the Postgres adapter's onConflictDoNothing (WR-01,
 * first-write-wins, never an upsert). The verdict blob is validated via exitVerdict.parse
 * BEFORE storing — matches the Postgres write-boundary validation exactly (T-26-08).
 *
 * readLatestVerdictsPerCalendar: the max-observedAt row per calendarId. Each stored blob
 * is re-validated via exitVerdict.safeParse on read (parse-don't-cast at the read seam); a
 * row seeded via seedRawVerdict (bypassing insertExitVerdict's own validation) is SKIPPED
 * with a console.warn (WR-01), matching the Postgres adapter's corrupted-row behavior.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryExitVerdictsRepo = {
  readonly insertExitVerdict: ForPersistingExitVerdict;
  readonly readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar;
  /**
   * seedRawVerdict — test-only: write a raw, UNVALIDATED blob directly into the store,
   * bypassing insertExitVerdict's own Zod validation. Simulates a legacy/corrupted stored
   * row so the shared contract can assert the SAME read-side StorageError behavior on
   * both adapters (mirrors the Postgres adapter's raw-SQL-INSERT test bypass).
   */
  readonly seedRawVerdict: (
    observedAt: Date,
    calendarId: string,
    rawBlob: unknown,
  ) => Promise<void>;
};

export function makeMemoryExitVerdictsRepo(): MemoryExitVerdictsRepo {
  const rows = new Map<string, { readonly observedAt: Date; readonly calendarId: string; readonly rawVerdict: unknown }>();

  const insertExitVerdict: ForPersistingExitVerdict = async (
    row: ExitVerdictRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      const validated = exitVerdict.parse(row.verdict);
      const key = `${row.observedAt.toISOString()}:${row.calendarId}`;
      if (rows.has(key)) return ok(undefined); // first-write-wins (WR-01) — no-op, mirrors onConflictDoNothing
      rows.set(key, { observedAt: row.observedAt, calendarId: row.calendarId, rawVerdict: validated });
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
      const latestByCalendar = new Map<string, { readonly observedAt: Date; readonly rawVerdict: unknown }>();
      for (const row of rows.values()) {
        const existing = latestByCalendar.get(row.calendarId);
        if (existing === undefined || row.observedAt.getTime() > existing.observedAt.getTime()) {
          latestByCalendar.set(row.calendarId, { observedAt: row.observedAt, rawVerdict: row.rawVerdict });
        }
      }
      // WR-01: parse per-row and SKIP a corrupted blob (with a console.warn) rather than
      // failing the whole batch — mirrors the Postgres twin exactly (architecture-boundaries §8).
      const mapped: ExitVerdictRow[] = [];
      for (const [calendarId, { observedAt, rawVerdict }] of latestByCalendar.entries()) {
        const parsed = exitVerdict.safeParse(rawVerdict);
        if (!parsed.success) {
          console.warn(
            `exit-verdicts: skipping corrupted verdict row for calendar ${calendarId}: ${parsed.error.message}`,
          );
          continue;
        }
        mapped.push({ observedAt, calendarId, verdict: parsed.data });
      }
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const seedRawVerdict = async (
    observedAt: Date,
    calendarId: string,
    rawBlob: unknown,
  ): Promise<void> => {
    const key = `${observedAt.toISOString()}:${calendarId}`;
    rows.set(key, { observedAt, calendarId, rawVerdict: rawBlob });
  };

  return { insertExitVerdict, readLatestVerdictsPerCalendar, seedRawVerdict };
}
