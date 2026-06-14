/**
 * makePostgresCalendarSnapshotsRepo — Postgres implementation of
 * ForPersistingSnapshot, ForReadingJournal, ForResolvingLegSnapshot.
 *
 * persistSnapshot: INSERT with onConflictDoNothing on composite PK (time, calendar_id).
 *   'NaN' strings in numeric columns insert cleanly (T-03-13 / D-06).
 *
 * readJournal: reads ordered by time ASC; null when calendarId unknown (drives 404).
 *
 * resolveLegSnapshot: two-step join.
 *   Step 1 — contracts table: match (underlying, strike ×1000 int, expiration, contractType)
 *   Step 2 — leg_observations: latest row (ORDER BY time DESC LIMIT 1) for the occSymbol
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * T-02-09: Drizzle parameterized queries; no raw template interpolation.
 */

import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  SnapshotRow,
  LegSnapshot,
  StorageError,
} from "@morai/core";
import { eq, and, desc, asc } from "drizzle-orm";
import { calendarSnapshots, legObservations, contracts, calendars } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresCalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
};

export function makePostgresCalendarSnapshotsRepo(
  db: Db,
): PostgresCalendarSnapshotsRepo {
  // ─── ForPersistingSnapshot ──────────────────────────────────────────────────
  // Idempotent INSERT — composite PK (time, calendar_id) absorbs duplicates.
  // 'NaN' numeric strings are valid for Postgres numeric columns (T-03-13).
  const persistSnapshot: ForPersistingSnapshot = async (
    row: SnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(calendarSnapshots)
        .values({
          time: row.time,
          calendarId: row.calendarId,
          spot: row.spot,
          netMark: row.netMark,
          frontMark: row.frontMark,
          backMark: row.backMark,
          frontIv: row.frontIv,
          backIv: row.backIv,
          frontIvRaw: row.frontIvRaw,
          backIvRaw: row.backIvRaw,
          netDelta: row.netDelta,
          netGamma: row.netGamma,
          netTheta: row.netTheta,
          netVega: row.netVega,
          termSlope: row.termSlope,
          dteFront: row.dteFront,
          dteBack: row.dteBack,
          pnlOpen: row.pnlOpen,
          source: row.source,
        })
        .onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingJournal ──────────────────────────────────────────────────────
  // First checks if the calendar exists; unknown → ok(null) (drives 404 at route layer).
  // Known → returns all rows ordered by time ASC (empty array when no snapshots).
  const readJournal: ForReadingJournal = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<SnapshotRow> | null, StorageError>> => {
    try {
      // Check calendar existence (FK would reject inserts for bad calendarId,
      // but reads against an unknown id should return null, not an empty array).
      const calExists = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(eq(calendars.id, calendarId))
        .limit(1);

      if (calExists.length === 0) return ok(null);

      const rows = await db
        .select()
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.calendarId, calendarId))
        .orderBy(asc(calendarSnapshots.time));

      const mapped: SnapshotRow[] = [];
      for (const row of rows) {
        const sr = mapSnapshotRow(row);
        if (sr === null) {
          // Unexpected source enum value — guard against silent misreport.
          console.warn(`calendar-snapshots: skipping row with unknown source "${row.source}" for calendar ${calendarId}`);
          continue;
        }
        mapped.push(sr);
      }
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForResolvingLegSnapshot ────────────────────────────────────────────────
  // Two-step join per D-04 / RESEARCH Focus Area 4:
  //   Step 1: contracts WHERE (underlying, strike [×1000], expiration, contractType) → occSymbol
  //   Step 2: leg_observations WHERE contract = occSymbol ORDER BY time DESC LIMIT 1
  const resolveLegSnapshot: ForResolvingLegSnapshot = async (query: {
    readonly underlying: string;
    readonly strike: number; // ×1000 int
    readonly optionType: "C" | "P";
    readonly expiry: string; // YYYY-MM-DD
  }): Promise<Result<LegSnapshot | null, StorageError>> => {
    try {
      // Step 1: find the OCC symbol via attribute match
      const contractRows = await db
        .select({ occSymbol: contracts.occSymbol })
        .from(contracts)
        .where(
          and(
            eq(contracts.underlying, query.underlying),
            eq(contracts.strike, query.strike), // both ×1000 int
            eq(contracts.expiration, query.expiry),
            eq(contracts.contractType, query.optionType),
          ),
        )
        .limit(1);

      const contractRow = contractRows[0];
      if (contractRow === undefined) return ok(null);

      const occSymbolRaw = contractRow.occSymbol;

      // Parse to OccSymbol brand (parse, don't cast — typescript.md)
      const parsedOcc = parseOccSymbol(occSymbolRaw);
      if (!parsedOcc.ok) return ok(null); // malformed symbol in DB → null

      // Step 2: latest leg_observation for this occSymbol
      const obsRows = await db
        .select({
          mark: legObservations.mark,
          underlyingPrice: legObservations.underlyingPrice,
          iv: legObservations.iv,
          bsmIv: legObservations.bsmIv,
          bsmDelta: legObservations.bsmDelta,
          bsmGamma: legObservations.bsmGamma,
          bsmTheta: legObservations.bsmTheta,
          bsmVega: legObservations.bsmVega,
        })
        .from(legObservations)
        .where(eq(legObservations.contract, occSymbolRaw))
        .orderBy(desc(legObservations.time))
        .limit(1);

      const obsRow = obsRows[0];
      if (obsRow === undefined) return ok(null);

      const leg: LegSnapshot = {
        occSymbol: formatOccSymbol(parsedOcc.value),
        mark: parseFloat(obsRow.mark),
        underlyingPrice: parseFloat(obsRow.underlyingPrice),
        ivRaw: obsRow.iv !== null ? parseFloat(obsRow.iv) : null,
        bsmIv: obsRow.bsmIv, // null or string ('NaN' | numeric)
        bsmDelta: obsRow.bsmDelta,
        bsmGamma: obsRow.bsmGamma,
        bsmTheta: obsRow.bsmTheta,
        bsmVega: obsRow.bsmVega,
      };

      return ok(leg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { persistSnapshot, readJournal, resolveLegSnapshot };
}

// ─── Row mapper ─────────────────────────────────────────────────────────────

type RawSnapshotRow = typeof calendarSnapshots.$inferSelect;

function mapSnapshotRow(row: RawSnapshotRow): SnapshotRow | null {
  // snapshot_source enum can be "schwab_chain" | "cboe" | "computed_only".
  // SnapshotRow.source is typed as the literal "cboe" — guard at runtime so
  // an unexpected source value surfaces loudly rather than being silently
  // coerced. (No implicit as-cast per typescript.md.)
  if (row.source !== "cboe") return null;
  const source = row.source; // narrowed to "cboe"
  return {
    time: row.time,
    calendarId: row.calendarId,
    spot: row.spot,
    netMark: row.netMark,
    frontMark: row.frontMark,
    backMark: row.backMark,
    frontIv: row.frontIv,
    backIv: row.backIv,
    frontIvRaw: row.frontIvRaw,
    backIvRaw: row.backIvRaw,
    netDelta: row.netDelta,
    netGamma: row.netGamma,
    netTheta: row.netTheta,
    netVega: row.netVega,
    termSlope: row.termSlope,
    dteFront: row.dteFront,
    dteBack: row.dteBack,
    pnlOpen: row.pnlOpen,
    source,
  };
}
