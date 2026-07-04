import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  EconomicEvent,
  ForPersistingEconomicEvents,
  ForReadingEconomicEvents,
  StorageError,
} from "@morai/core";
import { economicEvents } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresEconomicEventsRepo — Postgres implementation of ForPersistingEconomicEvents
 * and ForReadingEconomicEvents.
 *
 * persistEconomicEvents: bulk Drizzle parameterized upsert on the composite
 * (event_date, event_name) PK — onConflictDoUpdate (idempotent: a re-fetch of the same
 * FRED/seed rows revises source but never duplicates).
 * readEconomicEvents: returns ALL rows, unfiltered — the compute-picker use-case applies
 * the (today, legExpiry] span filter (D-10), not this repo.
 */
export type PostgresEconomicEventsRepo = {
  readonly persistEconomicEvents: ForPersistingEconomicEvents;
  readonly readEconomicEvents: ForReadingEconomicEvents;
};

export function makePostgresEconomicEventsRepo(db: Db): PostgresEconomicEventsRepo {
  const persistEconomicEvents: ForPersistingEconomicEvents = async (
    rows: ReadonlyArray<EconomicEvent>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      for (const row of rows) {
        await db
          .insert(economicEvents)
          .values({
            eventDate: row.date,
            eventName: row.name,
            source: row.source,
          })
          .onConflictDoUpdate({
            target: [economicEvents.eventDate, economicEvents.eventName],
            set: { source: row.source },
          });
      }
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readEconomicEvents: ForReadingEconomicEvents = async (): Promise<
    Result<ReadonlyArray<EconomicEvent>, StorageError>
  > => {
    try {
      const rows = await db.select().from(economicEvents);

      return ok(
        rows.map((r): EconomicEvent => {
          const name: EconomicEvent["name"] =
            r.eventName === "FOMC" || r.eventName === "CPI" || r.eventName === "NFP"
              ? r.eventName
              : "FOMC";
          const source: EconomicEvent["source"] = r.source === "seed" ? "seed" : "fred";
          return { date: r.eventDate, name, source };
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { persistEconomicEvents, readEconomicEvents };
}
