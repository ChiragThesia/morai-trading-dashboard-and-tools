import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingMacroObservation,
  ForReadingMacroObservations,
  MacroObservationRow,
  StorageError,
} from "@morai/core";
import { macroObservations } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresMacroObservationsRepo — Postgres implementation of
 * ForPersistingMacroObservation and ForReadingMacroObservations.
 *
 * insertMacroObservation: Drizzle parameterized upsert on the composite
 * (date, series_id) PK — onConflictDoUpdate (D-05, last-write-wins; FRED
 * sometimes revises preliminary values). No string interpolation.
 * readMacroObservations: returns ALL rows, unfiltered — grouping/windowing
 * happens in getMacro.ts (plan 14-04), not here.
 */
export type PostgresMacroObservationsRepo = {
  readonly insertMacroObservation: ForPersistingMacroObservation;
  readonly readMacroObservations: ForReadingMacroObservations;
};

export function makePostgresMacroObservationsRepo(
  db: Db,
): PostgresMacroObservationsRepo {
  const insertMacroObservation: ForPersistingMacroObservation = async (
    row: MacroObservationRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(macroObservations)
        .values({
          date: row.date,
          seriesId: row.seriesId,
          value: String(row.value),
          source: row.source,
        })
        .onConflictDoUpdate({
          target: [macroObservations.date, macroObservations.seriesId],
          set: { value: String(row.value), source: row.source },
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readMacroObservations: ForReadingMacroObservations = async (): Promise<
    Result<ReadonlyArray<MacroObservationRow>, StorageError>
  > => {
    try {
      const rows = await db.select().from(macroObservations);

      return ok(
        rows.map((r) => {
          const source: MacroObservationRow["source"] =
            r.source === "cboe" ? "cboe" : "fred";
          return {
            date: r.date,
            seriesId: r.seriesId,
            value: Number(r.value),
            source,
          };
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertMacroObservation, readMacroObservations };
}
