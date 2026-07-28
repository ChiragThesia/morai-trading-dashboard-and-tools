import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { CalendarRankingRow, ForPersistingCalendarRanking, StorageError } from "@morai/core";

/**
 * makeMemoryCalendarRankingRepo — in-memory twin of the Postgres calendar-ranking adapter.
 *
 * Mirrors `onConflictDoNothing` on the composite key
 * `(asOf, root, contractType, frontExpiration, backExpiration, strike)`: first-write-wins,
 * never an upsert. That includes duplicates WITHIN one batch — the key is checked against the
 * rows already accepted from the same call, which is how Postgres's DO NOTHING behaves and is
 * the behaviour DO UPDATE could not give (it raises "command cannot affect row a second time",
 * the 0224db1 outage).
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryCalendarRankingRepo = {
  readonly insertCalendarRanking: ForPersistingCalendarRanking;
  /** countRows — test helper: count rows in calendar_ranking. */
  readonly countRows: () => Promise<number>;
};

/** The conflict key, spelled the same way the Postgres PRIMARY KEY spells it. */
function conflictKey(row: CalendarRankingRow): string {
  return [
    row.asOf.getTime(),
    row.root,
    row.contractType,
    row.frontExpiration,
    row.backExpiration,
    row.strike,
  ].join("|");
}

export function makeMemoryCalendarRankingRepo(): MemoryCalendarRankingRepo {
  const rows: CalendarRankingRow[] = [];
  const keys = new Set<string>();

  const insertCalendarRanking: ForPersistingCalendarRanking = async (
    incoming: ReadonlyArray<CalendarRankingRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of incoming) {
      const key = conflictKey(row);
      if (keys.has(key)) continue; // DO NOTHING — first-write-wins, across batches and within one
      keys.add(key);
      rows.push(row);
    }
    return ok(undefined);
  };

  return { insertCalendarRanking, countRows: async (): Promise<number> => rows.length };
}
