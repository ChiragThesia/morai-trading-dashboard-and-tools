/**
 * makePostgresGexSnapshotRepo — Postgres implementation of the three GEX driven ports.
 *
 * ForReadingLegObsForGex: SELECT lo.*, c.strike, c.expiration, c.contract_type
 *   FROM leg_observations lo JOIN contracts c ON lo.contract = c.occ_symbol
 *   WHERE lo.time = (SELECT MAX(time) FROM leg_observations WHERE bsm_gamma IS NOT NULL)
 *   Returns LegObsForGex[] with all chain rows at the latest cycle (Pitfall 2 JOIN).
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
import { eq, and, isNotNull, desc, max, asc } from "drizzle-orm";
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

export type PostgresGexSnapshotRepo = {
  readonly readLegObsForGex: ForReadingLegObsForGex;
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  readonly readGexSnapshot: ForReadingGexSnapshot;
};

export function makePostgresGexSnapshotRepo(db: Db): PostgresGexSnapshotRepo {
  // ── ForReadingLegObsForGex ────────────────────────────────────────────────
  // Pitfall 2: leg_observations does NOT store contractType/strike/expiration —
  // those live on the contracts table. JOIN is mandatory.
  // Two-step: (1) resolve the latest cycle time where bsm_gamma is NOT NULL;
  //           (2) read the full JOIN result at that cycle time.
  const readLegObsForGex: ForReadingLegObsForGex = async (): Promise<
    Result<ReadonlyArray<LegObsForGex>, StorageError>
  > => {
    try {
      // Step 1: find the latest cycle time that has BSM-filled gamma values.
      const latestRows = await db
        .select({ maxTime: max(legObservations.time) })
        .from(legObservations)
        .where(isNotNull(legObservations.bsmGamma));

      const latestTime = latestRows[0]?.maxTime;
      if (latestTime === undefined || latestTime === null) return ok([]);

      // Step 2: JOIN leg_observations ↔ contracts at the resolved cycle time.
      // ORDER BY strike, contractType for a deterministic row order (IN-04 / WR-03):
      // the use-case now averages underlyingPrice, so legs[0] is moot, but a stable
      // order also makes raw-cohort debugging reproducible.
      const rows = await db
        .select({
          time: legObservations.time,
          contract: legObservations.contract,
          underlyingPrice: legObservations.underlyingPrice,
          bsmGamma: legObservations.bsmGamma,
          bsmIv: legObservations.bsmIv,
          openInterest: legObservations.openInterest,
          // JOIN fields from contracts (Pitfall 2)
          contractType: contracts.contractType,
          strike: contracts.strike,
          expiration: contracts.expiration,
        })
        .from(legObservations)
        .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
        .where(
          and(
            eq(legObservations.time, latestTime),
            isNotNull(legObservations.bsmGamma),
          ),
        )
        .orderBy(asc(contracts.strike), asc(contracts.contractType));

      const legs: LegObsForGex[] = rows.map((row) => ({
        time: row.time,
        contract: row.contract,
        underlyingPrice: parseFloat(row.underlyingPrice),
        bsmGamma: row.bsmGamma, // numeric string or null (null when not computed)
        bsmIv: row.bsmIv,       // numeric string or null
        openInterest: row.openInterest,
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
  // Insert one gex_snapshots row. JSONB columns accept JS objects directly (Drizzle
  // handles serialization). Numeric scalars must be strings for Drizzle numeric type.
  // .onConflictDoNothing() on the cycle_time PK = SC-4 idempotency.
  const persistGexSnapshot: ForPersistingGexSnapshot = async (
    row: GexSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(gexSnapshots)
        .values({
          cycleTime: row.cycleTime,
          spot: String(row.spot),
          flip: row.flip !== null ? String(row.flip) : null,
          // callWall/putWall are now numeric columns (may be fractional for half-point strikes)
          callWall: row.callWall !== null ? String(row.callWall) : null,
          putWall: row.putWall !== null ? String(row.putWall) : null,
          netGammaAtSpot: String(row.netGammaAtSpot),
          // JSONB columns: pass as JS objects; Drizzle jsonb handles serialization.
          profile: row.profile,
          strikes: row.strikes,
          byExpiry: row.byExpiry,
          computedAt: row.computedAt,
        })
        .onConflictDoNothing(); // SC-4: cycle_time PK — re-run within same cycle = no-op

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

      if (!profileParsed.success || !strikesParsed.success || !byExpiryParsed.success) {
        return err<StorageError>({
          kind: "storage-error",
          message: `JSONB parse failed: profile=${!profileParsed.success}, strikes=${!strikesParsed.success}, byExpiry=${!byExpiryParsed.success}`,
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

