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
import { computeSnapshotPnl, resolveRootCandidates, isGapRow } from "@morai/core";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  ForReadingCalendarSnapshotsForCycle,
  ForReadingLatestSnapshotTime,
  ForRecomputingSnapshotPnl,
  ForReadingLatestSnapshotPerOpenCalendarForJournal,
  ForReadingFullSnapshotHistoryForCalendar,
  ForHealingSnapshot,
  ForDeletingSnapshotsOutsideWindow,
  LatestSnapshotForOpenCalendar,
  FullHistorySnapshotRow,
  SnapshotRow,
  LegSnapshot,
  CalendarSnapshotForCycle,
  StorageError,
} from "@morai/core";
import { eq, and, lt, gt, or, lte, desc, asc, max, inArray } from "drizzle-orm";
import { calendarSnapshots, legObservations, contracts, calendars } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresCalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
  readonly readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle;
  readonly readLatestSnapshotTime: ForReadingLatestSnapshotTime;
  readonly recomputeSnapshotPnl: ForRecomputingSnapshotPnl;
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendarForJournal;
  readonly readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar;
  readonly healSnapshot: ForHealingSnapshot;
  readonly deleteSnapshotsOutsideWindow: ForDeletingSnapshotsOutsideWindow;
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
          // SNAP-01 / D-12: provenance marker. Undefined/absent -> stored as NULL,
          // read back as "scheduled" (mapSnapshotRow default).
          trigger: row.trigger ?? null,
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

      return ok(rows.map(mapSnapshotRow));
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
      // Step 1: find the OCC symbol via attribute match.
      // Match on contracts.ROOT, not contracts.underlying: weekly options carry occ root
      // "SPXW" while contracts.underlying is the index "SPX". Calendars are tracked by the
      // root ("SPXW"), so matching underlying would never hit (→ null legs → 0/NaN snapshots).
      // The root also disambiguates the SPX vs SPXW share of a strike/expiry (different settle).
      // HIST-01: a calendar's two legs can carry DIFFERENT real roots even though
      // calendars.underlying stores only one — try every candidate root (stored root
      // first, then its sibling) instead of an exact match.
      const contractRows = await db
        .select({ occSymbol: contracts.occSymbol })
        .from(contracts)
        .where(
          and(
            inArray(contracts.root, resolveRootCandidates(query.underlying)),
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
          time: legObservations.time,
          mark: legObservations.mark,
          underlyingPrice: legObservations.underlyingPrice,
          iv: legObservations.iv,
          bsmIv: legObservations.bsmIv,
          bsmDelta: legObservations.bsmDelta,
          bsmGamma: legObservations.bsmGamma,
          bsmTheta: legObservations.bsmTheta,
          bsmVega: legObservations.bsmVega,
          source: legObservations.source,
        })
        .from(legObservations)
        .where(eq(legObservations.contract, occSymbolRaw))
        .orderBy(desc(legObservations.time))
        .limit(1);

      const obsRow = obsRows[0];
      if (obsRow === undefined) return ok(null);

      const leg: LegSnapshot = {
        occSymbol: formatOccSymbol(parsedOcc.value),
        time: obsRow.time,
        mark: parseFloat(obsRow.mark),
        underlyingPrice: parseFloat(obsRow.underlyingPrice),
        ivRaw: obsRow.iv !== null ? parseFloat(obsRow.iv) : null,
        bsmIv: obsRow.bsmIv, // null or string ('NaN' | numeric)
        bsmDelta: obsRow.bsmDelta,
        bsmGamma: obsRow.bsmGamma,
        bsmTheta: obsRow.bsmTheta,
        bsmVega: obsRow.bsmVega,
        source: obsRow.source,
      };

      return ok(leg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingCalendarSnapshotsForCycle (06-04) ──────────────────────────────
  // Reads the calendar_snapshots rows for the CURRENT cycle — the most recent snapshot
  // time on or before `snapshotTime` — and maps them to the term-slope passthrough shape.
  // term_slope crosses as a numeric string; "NaN" → parseFloat → NaN, which the
  // computeAnalytics use-case skips (D-06 continuity rows are never written).
  const readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle = async (
    snapshotTime: Date,
  ): Promise<Result<ReadonlyArray<CalendarSnapshotForCycle>, StorageError>> => {
    try {
      // Find the latest snapshot time on or before the requested cycle time.
      const latest = await db
        .select({ time: calendarSnapshots.time })
        .from(calendarSnapshots)
        .where(lte(calendarSnapshots.time, snapshotTime))
        .orderBy(desc(calendarSnapshots.time))
        .limit(1);

      const cycleTime = latest[0]?.time;
      if (cycleTime === undefined) return ok([]);

      const rows = await db
        .select({
          time: calendarSnapshots.time,
          calendarId: calendarSnapshots.calendarId,
          termSlope: calendarSnapshots.termSlope,
          frontIv: calendarSnapshots.frontIv,
          backIv: calendarSnapshots.backIv,
        })
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.time, cycleTime));

      const mapped: CalendarSnapshotForCycle[] = rows.map((row) => ({
        snapshotTime: row.time,
        calendarId: row.calendarId,
        termSlope: parseFloat(row.termSlope),
        frontIv: parseFloat(row.frontIv),
        backIv: parseFloat(row.backIv),
      }));
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingLatestSnapshotTime (20-05, SNAP-01 Pattern 2) ─────────────────
  // SELECT MAX(time) — index-only scan (time leads the composite PK). Null on
  // cold start (no rows). Never throws — DB errors map to StorageError.
  const readLatestSnapshotTime: ForReadingLatestSnapshotTime = async (): Promise<
    Result<Date | null, StorageError>
  > => {
    try {
      const rows = await db
        .select({ latest: max(calendarSnapshots.time) })
        .from(calendarSnapshots);
      const latest = rows[0]?.latest;
      return ok(latest !== null && latest !== undefined ? latest : null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── recomputeSnapshotPnl (JRNL-01 pnl-unit-mismatch fix) ────────────────────
  // Re-derives pnl_open on every stored row for a calendar from the given openNetDebit/qty,
  // using the SAME D-05 formula the live snapshot writer uses (computeSnapshotPnl) — no
  // formula drift. No online fetch: re-derives purely from each row's stored net_mark.
  //
  // Atomicity (money path): the SELECT + per-row UPDATEs run inside one transaction, so a
  // mid-loop failure rolls back the whole batch rather than leaving a calendar's snapshots
  // half-corrected. rowsUpdated therefore reflects a single committed all-or-nothing batch.
  const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (
    calendarId: string,
    openNetDebit: number,
    qty: number,
  ): Promise<Result<{ readonly rowsUpdated: number }, StorageError>> => {
    try {
      const rowsUpdated = await db.transaction(async (tx) => {
        const rows = await tx
          .select({ time: calendarSnapshots.time, netMark: calendarSnapshots.netMark })
          .from(calendarSnapshots)
          .where(eq(calendarSnapshots.calendarId, calendarId));

        for (const row of rows) {
          const netMark = parseFloat(row.netMark);
          const pnlOpen = String(computeSnapshotPnl(netMark, openNetDebit, qty));
          await tx
            .update(calendarSnapshots)
            .set({ pnlOpen })
            .where(
              and(
                eq(calendarSnapshots.calendarId, calendarId),
                eq(calendarSnapshots.time, row.time),
              ),
            );
        }

        return rows.length;
      });

      return ok({ rowsUpdated });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingLatestSnapshotPerOpenCalendar (26-03, EXIT-02) ───────────────
  // Fresh DISTINCT ON (calendar_id) query, NEVER readJournal/mapSnapshotRow — that mapper
  // silently drops schwab_chain-sourced rows (RESEARCH Pitfall 1). Joined to calendars
  // WHERE status = 'open' so only open positions are read; a calendar with no snapshot
  // rows is simply absent from the result (inner join), not an error.
  const readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendarForJournal = async (): Promise<
    Result<ReadonlyArray<LatestSnapshotForOpenCalendar>, StorageError>
  > => {
    try {
      const rows = await db
        .selectDistinctOn([calendarSnapshots.calendarId], {
          time: calendarSnapshots.time,
          calendarId: calendarSnapshots.calendarId,
          spot: calendarSnapshots.spot,
          netMark: calendarSnapshots.netMark,
          frontMark: calendarSnapshots.frontMark,
          backMark: calendarSnapshots.backMark,
          frontIv: calendarSnapshots.frontIv,
          backIv: calendarSnapshots.backIv,
          frontIvRaw: calendarSnapshots.frontIvRaw,
          backIvRaw: calendarSnapshots.backIvRaw,
          netDelta: calendarSnapshots.netDelta,
          netGamma: calendarSnapshots.netGamma,
          netTheta: calendarSnapshots.netTheta,
          netVega: calendarSnapshots.netVega,
          termSlope: calendarSnapshots.termSlope,
          dteFront: calendarSnapshots.dteFront,
          dteBack: calendarSnapshots.dteBack,
          pnlOpen: calendarSnapshots.pnlOpen,
          source: calendarSnapshots.source,
          trigger: calendarSnapshots.trigger,
        })
        .from(calendarSnapshots)
        .innerJoin(calendars, eq(calendars.id, calendarSnapshots.calendarId))
        .where(eq(calendars.status, "open"))
        // DISTINCT ON requires the distinct column to lead the ORDER BY; time DESC within
        // each calendar makes the newest row win — no source filter (Pitfall 1).
        .orderBy(asc(calendarSnapshots.calendarId), desc(calendarSnapshots.time));

      const mapped: LatestSnapshotForOpenCalendar[] = rows.map((row) => {
        // snapshot_source enum has a third value ("computed_only") that never actually lands
        // in this column — the writer (snapshotCalendars.ts) maps it to "cboe" before
        // persisting. Mirror that same mapping here (never drop the row, unlike mapSnapshotRow).
        const source: "cboe" | "schwab_chain" =
          row.source === "schwab_chain" ? "schwab_chain" : "cboe";
        const trigger: "scheduled" | "event-move" =
          row.trigger === "event-move" ? "event-move" : "scheduled";
        return {
          calendarId: row.calendarId,
          snapshot: {
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
            trigger,
          },
        };
      });
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingFullSnapshotHistoryForCalendar (27-03, BT-03) ────────────────
  // Plain SELECT — no status join, no source filter — every row for one calendar, ASC.
  // Mirrors readLatestSnapshotPerOpenCalendar's source-inclusive mapping (never
  // mapSnapshotRow's `source !== "cboe" → null` drop, RESEARCH Pattern 4).
  const readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<FullHistorySnapshotRow>, StorageError>> => {
    try {
      const rows = await db
        .select({
          time: calendarSnapshots.time,
          calendarId: calendarSnapshots.calendarId,
          netMark: calendarSnapshots.netMark,
          frontIv: calendarSnapshots.frontIv,
          backIv: calendarSnapshots.backIv,
          dteFront: calendarSnapshots.dteFront,
          dteBack: calendarSnapshots.dteBack,
          spot: calendarSnapshots.spot,
          source: calendarSnapshots.source,
        })
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.calendarId, calendarId))
        .orderBy(asc(calendarSnapshots.time));

      const mapped: FullHistorySnapshotRow[] = rows.map((row) => {
        // snapshot_source enum's third value ("computed_only") never actually lands in this
        // column (the writer maps it to "cboe" before persisting) — mirror
        // readLatestSnapshotPerOpenCalendar's inclusive mapping, never drop the row.
        const source: string = row.source === "schwab_chain" ? "schwab_chain" : "cboe";
        return {
          calendarId: row.calendarId,
          time: row.time,
          netMark: parseFloat(row.netMark),
          frontIv: parseFloat(row.frontIv),
          backIv: parseFloat(row.backIv),
          dteFront: row.dteFront,
          dteBack: row.dteBack,
          spot: parseFloat(row.spot),
          source,
        };
      });
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── healSnapshot (HIST-02, D-03) ────────────────────────────────────────────
  // Fill-only conditional write, atomic (SELECT-then-decide inside one transaction, mirroring
  // recomputeSnapshotPnl's tx shape — so a concurrent live write can never be clobbered by a
  // race). INSERT when no row exists for (calendar_id, time); UPDATE to the healed row when the
  // existing row IS a gap (isGapRow — the LOCKED predicate from @morai/core's attribution.ts,
  // never a second gap definition); NO-OP when the existing row is NOT a gap (a live row wins).
  const healSnapshot: ForHealingSnapshot = async (
    row: SnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(calendarSnapshots)
          .where(
            and(eq(calendarSnapshots.calendarId, row.calendarId), eq(calendarSnapshots.time, row.time)),
          );

        const existing = existingRows[0];
        const values = {
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
          trigger: row.trigger ?? null,
        };

        if (existing === undefined) {
          // CR-01 (40-REVIEW.md): under READ COMMITTED, a concurrent healSnapshot call on the
          // same (calendar_id, time) can also observe "no row" and INSERT first —
          // onConflictDoNothing absorbs that race instead of surfacing an unhandled
          // unique-violation. If we lost the race, re-read and apply the SAME fill-only
          // decision as the existing-row branch below (mirrors persistSnapshot's idiom).
          const inserted = await tx
            .insert(calendarSnapshots)
            .values({ time: row.time, calendarId: row.calendarId, ...values })
            .onConflictDoNothing()
            .returning({ time: calendarSnapshots.time });
          if (inserted.length > 0) return; // we won the race

          const racedRows = await tx
            .select()
            .from(calendarSnapshots)
            .where(
              and(eq(calendarSnapshots.calendarId, row.calendarId), eq(calendarSnapshots.time, row.time)),
            );
          const raced = racedRows[0];
          if (raced === undefined || !isGapRow(raced)) return;

          await tx
            .update(calendarSnapshots)
            .set(values)
            .where(
              and(eq(calendarSnapshots.calendarId, row.calendarId), eq(calendarSnapshots.time, row.time)),
            );
          return;
        }

        if (!isGapRow(existing)) return; // live row wins — never overwritten (D-03)

        await tx
          .update(calendarSnapshots)
          .set(values)
          .where(
            and(eq(calendarSnapshots.calendarId, row.calendarId), eq(calendarSnapshots.time, row.time)),
          );
      });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── deleteSnapshotsOutsideWindow (HIST-02, D-08) ────────────────────────────
  // Deletes rows outside [openedAt, closedAt] for a calendar; closedAt null (open calendar)
  // trims only the pre-openedAt side. Returns the exact deleted count via RETURNING.
  const deleteSnapshotsOutsideWindow: ForDeletingSnapshotsOutsideWindow = async (
    calendarId: string,
    openedAt: Date,
    closedAt: Date | null,
  ): Promise<Result<{ readonly deletedCount: number }, StorageError>> => {
    try {
      const windowPredicate =
        closedAt === null
          ? lt(calendarSnapshots.time, openedAt)
          : or(lt(calendarSnapshots.time, openedAt), gt(calendarSnapshots.time, closedAt));

      const deletedRows = await db
        .delete(calendarSnapshots)
        .where(and(eq(calendarSnapshots.calendarId, calendarId), windowPredicate))
        .returning({ time: calendarSnapshots.time });

      return ok({ deletedCount: deletedRows.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    persistSnapshot,
    readJournal,
    resolveLegSnapshot,
    readSnapshotsForCycle,
    readLatestSnapshotTime,
    recomputeSnapshotPnl,
    readLatestSnapshotPerOpenCalendar,
    readFullSnapshotHistoryForCalendar,
    healSnapshot,
    deleteSnapshotsOutsideWindow,
  };
}

// ─── Row mapper ─────────────────────────────────────────────────────────────

type RawSnapshotRow = typeof calendarSnapshots.$inferSelect;

function mapSnapshotRow(row: RawSnapshotRow): SnapshotRow {
  // snapshot_source enum's third value ("computed_only") never actually lands in this
  // column (the writer maps it to "cboe" before persisting) — mirror
  // readLatestSnapshotPerOpenCalendar/readFullSnapshotHistoryForCalendar's inclusive
  // mapping (Pitfall 1): never drop the row by source.
  const source: "cboe" | "schwab_chain" =
    row.source === "schwab_chain" ? "schwab_chain" : "cboe";
  // SNAP-01 / D-12: NULL (legacy rows, pre-0016) and any unexpected value default to
  // "scheduled" — the only other valid value is "event-move".
  const trigger: "scheduled" | "event-move" =
    row.trigger === "event-move" ? "event-move" : "scheduled";
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
    trigger,
  };
}
