/**
 * makePostgresGexSnapshotRepo — Postgres implementation of the three GEX driven ports.
 *
 * ForReadingLegObsForGex: SELECT DISTINCT ON (lo.contract) lo.*, c.strike, c.expiration,
 *   c.contract_type FROM leg_observations lo JOIN contracts c ON lo.contract = c.occ_symbol
 *   WHERE lo.time in [MAX(time WHERE bsm_gamma IS NOT NULL) − 10 min, MAX(...)]
 *   ORDER BY lo.contract, lo.time DESC — the dual-source cohort: union of Schwab + CBOE
 *   rows in the latest cycle's lookback window, one row per contract, newest wins
 *   (Pitfall 2 JOIN; lookback not calendar slots — boundary-straddle regression).
 *
 * ForPersistingGexSnapshot: INSERT one gex_snapshots row with JSONB blobs for
 *   profile/strikes/byExpiry + numeric scalars as strings.
 *   .onConflictDoNothing() on the cycle_time PK (SC-4 idempotency).
 *
 * ForReadingGexSnapshot: ORDER BY cycle_time DESC LIMIT 1; returns the row or null.
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  ForReadingGexSnapshot,
  GexSnapshotRow,
  LegObsForGex,
  StorageError,
} from "@morai/core";
import { z } from "zod";
import { and, isNotNull, desc, max, asc, eq, gte, lte } from "drizzle-orm";
import { legObservations, contracts, gexSnapshots } from "./schema.ts";
import type { Db } from "./db.ts";

// ── JSONB sub-schemas for parse-don't-cast at the read seam (WR-06) ──────────
// DB JSONB blobs are untyped at runtime; $type<> is compile-time only.
// Parse through Zod so a malformed/legacy row surfaces a StorageError rather
// than flowing into the domain as a silently invalid shape.

const profileSchema = z.array(
  z.object({ spot: z.number(), gamma: z.number() }),
);

const strikesSchema = z.array(
  z.object({
    k: z.number(),
    gex: z.number(),
    coi: z.number(),
    poi: z.number(),
    vol: z.number(),
  }),
);

const byExpirySchema = z.array(
  z.object({ date: z.string(), gex: z.number() }),
);

const nearTermSchema = z
  .object({
    callWall: z.number().nullable(),
    putWall: z.number().nullable(),
    flip: z.number().nullable(),
  })
  .nullable();

export type PostgresGexSnapshotRepo = {
  readonly readLegObsForGex: ForReadingLegObsForGex;
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  readonly readGexSnapshot: ForReadingGexSnapshot;
};

export function makePostgresGexSnapshotRepo(db: Db): PostgresGexSnapshotRepo {
  // ── ForReadingLegObsForGex ────────────────────────────────────────────────
  // Pitfall 2: leg_observations does NOT store contractType/strike/expiration —
  // those live on the contracts table. JOIN is mandatory.
  // Two-step: (1) resolve the latest observation time where bsm_gamma is NOT NULL;
  //           (2) read the full JOIN result across a lookback window ending there.
  //
  // chain-window-narrow-regression: one fetch cycle lands as TWO nearby timestamps
  // (Schwab + CBOE each stamp their own observedAt), so the cohort is the UNION of
  // all BSM-solved rows in [maxTime − LOOKBACK, maxTime] — strict max(time) equality
  // would drop a source, and a CALENDAR-SLOT union breaks when the cycle straddles
  // the 30-min boundary (live 2026-07-08: CBOE 16:59:31 vs Schwab 17:00:31 — cron
  // jitter + Schwab latency straddle the boundary constantly). The lookback is
  // anchored to the data itself, so there is no boundary to straddle. DISTINCT ON
  // (contract) with time DESC dedupes the near-ATM overlap (newest row wins) so
  // strikeGex never double-counts a contract's OI. LOOKBACK is well under the 30-min
  // cycle spacing, so adjacent cycles never merge.
  const readLegObsForGex: ForReadingLegObsForGex = async (): Promise<
    Result<ReadonlyArray<LegObsForGex>, StorageError>
  > => {
    try {
      // Step 1: find the latest observation time that has BSM-filled gamma values.
      const latestRows = await db
        .select({ maxTime: max(legObservations.time) })
        .from(legObservations)
        .where(isNotNull(legObservations.bsmGamma));

      const latestTime = latestRows[0]?.maxTime;
      if (latestTime === undefined || latestTime === null) return ok([]);

      // Step 2: JOIN leg_observations ↔ contracts across the lookback window,
      // one row per contract (newest wins).
      const lookbackMs = 10 * 60 * 1000;
      const windowStart = new Date(latestTime.getTime() - lookbackMs);

      const rows = await db
        .selectDistinctOn([legObservations.contract], {
          time: legObservations.time,
          contract: legObservations.contract,
          underlyingPrice: legObservations.underlyingPrice,
          bsmGamma: legObservations.bsmGamma,
          bsmIv: legObservations.bsmIv,
          openInterest: legObservations.openInterest,
          // Raw mark — 34-03, parity-solver input (leg_observations.mark, already notNull).
          mark: legObservations.mark,
          // JOIN fields from contracts (Pitfall 2)
          contractType: contracts.contractType,
          strike: contracts.strike,
          expiration: contracts.expiration,
        })
        .from(legObservations)
        .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
        .where(
          and(
            gte(legObservations.time, windowStart),
            lte(legObservations.time, latestTime),
            isNotNull(legObservations.bsmGamma),
          ),
        )
        // DISTINCT ON requires the distinct column to lead the ORDER BY;
        // time DESC within each contract makes the newest row win.
        .orderBy(asc(legObservations.contract), desc(legObservations.time));

      const legs: LegObsForGex[] = rows.map((row) => ({
        time: row.time,
        contract: row.contract,
        underlyingPrice: parseFloat(row.underlyingPrice),
        bsmGamma: row.bsmGamma, // numeric string or null (null when not computed)
        bsmIv: row.bsmIv,       // numeric string or null
        openInterest: row.openInterest,
        mark: row.mark, // numeric string (notNull) — 34-03 parity-solver input
        contractType: row.contractType,
        strike: row.strike, // ×1000 integer convention (e.g. 7400000)
        expiration: row.expiration, // YYYY-MM-DD from date column
      }));

      return ok(legs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ── ForPersistingGexSnapshot ──────────────────────────────────────────────
  // Upsert one gex_snapshots row. JSONB columns accept JS objects directly (Drizzle
  // handles serialization). Numeric scalars must be strings for Drizzle numeric type.
  //
  // UPSERT (not onConflictDoNothing) on the cycle_time PK: SC-4 idempotency means no
  // duplicate rows, NOT first-write-wins. BSM drains newest-first, so an early chain
  // run can compute GEX from a partially-solved cohort; the later recompute (fuller
  // cohort) must overwrite it — onConflictDoNothing let a premature row block its own
  // correction (live 2026-07-08 regression).
  const persistGexSnapshot: ForPersistingGexSnapshot = async (
    row: GexSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      const values = {
        cycleTime: row.cycleTime,
        spot: String(row.spot),
        flip: row.flip !== null ? String(row.flip) : null,
        // callWall/putWall are numeric columns (may be fractional for half-point strikes)
        callWall: row.callWall !== null ? String(row.callWall) : null,
        putWall: row.putWall !== null ? String(row.putWall) : null,
        netGammaAtSpot: String(row.netGammaAtSpot),
        // JSONB columns: pass as JS objects; Drizzle jsonb handles serialization.
        profile: row.profile,
        strikes: row.strikes,
        byExpiry: row.byExpiry,
        nearTerm: row.nearTerm,
        computedAt: row.computedAt,
      };
      const { cycleTime: _pk, ...updates } = values;
      await db
        .insert(gexSnapshots)
        .values(values)
        .onConflictDoUpdate({ target: gexSnapshots.cycleTime, set: updates });

      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ── ForReadingGexSnapshot ─────────────────────────────────────────────────
  // ORDER BY cycle_time DESC LIMIT 1 → the most-recent snapshot row.
  // Returns ok(null) when no snapshot exists yet.
  const readGexSnapshot: ForReadingGexSnapshot = async (): Promise<
    Result<GexSnapshotRow | null, StorageError>
  > => {
    try {
      const rows = await db
        .select()
        .from(gexSnapshots)
        .orderBy(desc(gexSnapshots.cycleTime))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return ok(null);

      // Map DB row → GexSnapshotRow domain type.
      // Numeric columns come back as strings (Drizzle numeric convention) → parseFloat.
      // JSONB blobs are Zod-parsed at the seam rather than trust-cast (WR-06:
      // parse-don't-cast for every external input at an adapter boundary).
      const profileParsed = profileSchema.safeParse(row.profile);
      const strikesParsed = strikesSchema.safeParse(row.strikes);
      const byExpiryParsed = byExpirySchema.safeParse(row.byExpiry);
      // near_term is nullable (and null on pre-0019 rows) — undefined/null map to null.
      const nearTermParsed = nearTermSchema.safeParse(row.nearTerm ?? null);

      if (
        !profileParsed.success ||
        !strikesParsed.success ||
        !byExpiryParsed.success ||
        !nearTermParsed.success
      ) {
        return err<StorageError>({
          kind: "storage-error",
          message: `JSONB parse failed: profile=${!profileParsed.success}, strikes=${!strikesParsed.success}, byExpiry=${!byExpiryParsed.success}, nearTerm=${!nearTermParsed.success}`,
        });
      }

      const snap: GexSnapshotRow = {
        cycleTime: row.cycleTime,
        spot: parseFloat(row.spot),
        flip: row.flip !== null ? parseFloat(row.flip) : null,
        // callWall/putWall are now numeric columns (may be fractional) — parseFloat guards null
        callWall: row.callWall !== null ? parseFloat(row.callWall) : null,
        putWall: row.putWall !== null ? parseFloat(row.putWall) : null,
        netGammaAtSpot: parseFloat(row.netGammaAtSpot),
        profile: profileParsed.data,
        strikes: strikesParsed.data,
        byExpiry: byExpiryParsed.data,
        nearTerm: nearTermParsed.data,
        computedAt: row.computedAt,
      };

      return ok(snap);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    readLegObsForGex,
    persistGexSnapshot,
    readGexSnapshot,
  };
}

