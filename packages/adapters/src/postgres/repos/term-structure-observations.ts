/**
 * makePostgresTermStructureObservationsRepo — Postgres implementation of the term-structure ports.
 *
 * storeTermStructureObservations: bulk INSERT onConflictDoNothing on the (snapshot_time,
 *   calendar_id) composite PK — re-running for the same grain is a no-op (ANLY-02 idempotency).
 * readTermStructureSeries: SELECT ordered by snapshot_time ASC, optional calendarId filter;
 *   empty array when none (never null/error).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * T-06-07: value/frontIv/backIv cross the numeric boundary via String()/parseFloat() exactly the
 *   way calendar-events.ts does — the term_slope passthrough must round-trip without drift.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingTermStructureObservations,
  ForReadingTermStructureSeries,
  TermStructureObservationRow,
  StorageError,
} from "@morai/core";
import { eq, asc } from "drizzle-orm";
import { termStructureObservations } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresTermStructureObservationsRepo = {
  readonly storeTermStructureObservations: ForWritingTermStructureObservations;
  readonly readTermStructureSeries: ForReadingTermStructureSeries;
};

export function makePostgresTermStructureObservationsRepo(
  db: Db,
): PostgresTermStructureObservationsRepo {
  // ─── storeTermStructureObservations (ForWritingTermStructureObservations) ──────
  // Idempotent bulk INSERT — composite PK (snapshot_time, calendar_id) absorbs duplicates.
  const storeTermStructureObservations: ForWritingTermStructureObservations = async (
    rows: ReadonlyArray<TermStructureObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      await db
        .insert(termStructureObservations)
        .values(
          rows.map((row) => ({
            snapshotTime: row.snapshotTime,
            calendarId: row.calendarId,
            // numeric columns cross as strings (calendar-events.ts precedent)
            value: String(row.value),
            frontIv: String(row.frontIv),
            backIv: String(row.backIv),
          })),
        )
        .onConflictDoNothing(); // ANLY-02: re-run for the same grain = no-op
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readTermStructureSeries (ForReadingTermStructureSeries) ──────────────────
  // Ordered by snapshot_time ASC; optional calendarId filter; empty array when none.
  const readTermStructureSeries: ForReadingTermStructureSeries = async (query: {
    readonly calendarId?: string;
  }): Promise<Result<ReadonlyArray<TermStructureObservationRow>, StorageError>> => {
    try {
      const base = db.select().from(termStructureObservations);
      const filtered =
        query.calendarId === undefined
          ? base
          : base.where(eq(termStructureObservations.calendarId, query.calendarId));
      const rows = await filtered.orderBy(asc(termStructureObservations.snapshotTime));

      const mapped: TermStructureObservationRow[] = rows.map((row) => ({
        snapshotTime: row.snapshotTime,
        calendarId: row.calendarId,
        value: parseFloat(row.value),
        frontIv: parseFloat(row.frontIv),
        backIv: parseFloat(row.backIv),
      }));

      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { storeTermStructureObservations, readTermStructureSeries };
}
