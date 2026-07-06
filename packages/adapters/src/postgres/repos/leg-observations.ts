import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
  ForReadingPendingObs,
  ForWritingBsmResults,
  ForReadingLatestLegObs,
  ForReadingSmileSource,
  ObservationRow,
  ContractRow,
  PendingObs,
  LegSnapshot,
  SmileQuote,
  SmileReadResult,
  StorageError,
} from "@morai/core";
import { and, isNull, isNotNull, ne, eq, lte, inArray, desc, sql } from "drizzle-orm";
import { legObservations, contracts } from "../schema.ts";
import { computeMoneyness } from "../../smile-moneyness.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresLegObservationsRepo — Postgres implementation of
 * ForPersistingObservations, ForUpsertingContracts, ForReadingPendingObs, ForWritingBsmResults.
 *
 * T-02-08: fetchChain filter bounds write volume before this layer.
 * T-02-09: Drizzle parameterized insert/onConflictDoNothing; no raw interpolation.
 * Append-only idempotency: composite PK (time, contract) — onConflictDoNothing.
 * First-seen contracts: onConflictDoNothing on occ_symbol PK.
 * BSM-03: pending scan via partial index (bsm_iv IS NULL AND mark IS NOT NULL).
 * T-02-17: bsm-write touches only bsm_* columns; vendor columns never modified.
 *
 * GAP-A fix: chunk large batches to stay below Postgres's 65,534 bind-parameter limit.
 * 2,000 rows × 14 cols (observations) = 28,000 params per INSERT.
 * 2,000 rows × 8 cols (contracts) = 16,000 params per INSERT.
 */

/** Maximum rows per INSERT statement to stay below Postgres's 65,534 bind-parameter limit. */
const INSERT_CHUNK_ROWS = 2000;
export type PostgresLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly readPendingObs: ForReadingPendingObs;
  readonly writeBsmResults: ForWritingBsmResults;
  readonly getLatestLegObs: ForReadingLatestLegObs;
  readonly readSmile: ForReadingSmileSource;
};

export function makePostgresLegObservationsRepo(
  db: Db,
): PostgresLegObservationsRepo {
  const persistObservations: ForPersistingObservations = async (
    rows: ReadonlyArray<ObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      // Map ObservationRow → leg_observations insert shape
      const values = rows.map((row) => ({
        time: row.time,
        contract: row.contract,
        bid: String(row.bid),
        ask: String(row.ask),
        mark: String(row.mark),
        underlyingPrice: String(row.underlyingPrice),
        iv: row.iv !== null ? String(row.iv) : null,
        delta: row.delta !== null ? String(row.delta) : null,
        gamma: row.gamma !== null ? String(row.gamma) : null,
        theta: row.theta !== null ? String(row.theta) : null,
        vega: row.vega !== null ? String(row.vega) : null,
        openInterest: row.openInterest,
        volume: row.volume,
        source: row.source,
      }));

      // Chunk to stay below Postgres's 65,534 bind-parameter limit.
      // 2,000 rows × 14 cols = 28,000 params per INSERT — comfortable margin.
      for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS) {
        const slice = values.slice(i, i + INSERT_CHUNK_ROWS);
        await db.insert(legObservations).values(slice).onConflictDoNothing();
      }
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const upsertContracts: ForUpsertingContracts = async (
    rows: ReadonlyArray<ContractRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      // Map ContractRow → contracts insert shape
      const values = rows.map((row) => ({
        occSymbol: row.occSymbol,
        underlying: row.underlying,
        root: row.root,
        contractType: row.contractType,
        exerciseStyle: row.exerciseStyle,
        strike: row.strike, // already ×1000 int
        expiration: row.expiration,
        multiplier: row.multiplier,
      }));

      // Chunk to stay below Postgres's 65,534 bind-parameter limit.
      // 2,000 rows × 8 cols = 16,000 params per INSERT — comfortable margin.
      for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS) {
        const slice = values.slice(i, i + INSERT_CHUNK_ROWS);
        await db.insert(contracts).values(slice).onConflictDoNothing();
      }
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingPendingObs ─────────────────────────────────────────────────
  // BSM-03: scan the partial index — returns rows where bsm_iv IS NULL AND mark IS NOT NULL.
  // T-02-15: this scan is the mechanism that makes re-runs a no-op (NaN-stamped rows excluded).
  const readPendingObs: ForReadingPendingObs = async (limit): Promise<
    Result<ReadonlyArray<PendingObs>, StorageError>
  > => {
    try {
      // Step 1: scan the partial index for pending rows — NEWEST-first, bounded.
      // gex-schwab-bsm-null-puts fix: ORDER BY time DESC + LIMIT so the freshest chain cycle
      // is always the cohort processed. The previous unbounded, oldest-first read starved the
      // newest (live) cohort — its legs stayed bsm_* NULL and GEX dropped them (no put wall /
      // flip). The btree partial index (time, contract) supports the backward scan + limit.
      const obsRows = await db
        .select({
          time: legObservations.time,
          contract: legObservations.contract,
          mark: legObservations.mark,
          underlyingPrice: legObservations.underlyingPrice,
        })
        .from(legObservations)
        .where(and(isNull(legObservations.bsmIv), isNotNull(legObservations.mark)))
        .orderBy(desc(legObservations.time))
        .limit(limit);

      if (obsRows.length === 0) return ok([]);

      // Step 2: fetch contract metadata for the pending symbols (single query via inArray)
      const contractSymbols = [...new Set(obsRows.map((obs) => obs.contract))];
      const contractMeta = await db
        .select({
          occSymbol: contracts.occSymbol,
          root: contracts.root,
          contractType: contracts.contractType,
          expiration: contracts.expiration,
          strike: contracts.strike,
        })
        .from(contracts)
        .where(inArray(contracts.occSymbol, contractSymbols));

      // Build lookup map: occSymbol → contract metadata
      type ContractMetaRow = (typeof contractMeta)[number];
      const metaBySymbol = new Map<string, ContractMetaRow>(
        contractMeta.map((m) => [m.occSymbol, m]),
      );

      const pending: PendingObs[] = [];
      const orphanedSymbols: string[] = [];
      for (const obs of obsRows) {
        const meta = metaBySymbol.get(obs.contract);
        if (meta === undefined) {
          orphanedSymbols.push(obs.contract);
          continue; // no contract row → skip; cannot compute BSM without metadata
        }

        // Re-brand the DB varchar through the OCC parser (parse, don't cast)
        const occ = parseOccSymbol(obs.contract);
        if (!occ.ok) continue; // malformed symbol in DB → skip

        // Parse the expiration date string (YYYY-MM-DD from Drizzle date column)
        const parts = meta.expiration.split("-");
        if (parts.length !== 3) continue;
        const [yearStr, monthStr, dayStr] = parts;
        if (yearStr === undefined || monthStr === undefined || dayStr === undefined) continue;
        // Use Date.UTC so UTC components equal the DB date string on any server timezone.
        const expiry = new Date(
          Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)),
        );

        // Root: Drizzle stores as varchar(8); map to union
        const root: "SPX" | "SPXW" = meta.root === "SPXW" ? "SPXW" : "SPX";

        // ContractType: Drizzle enum stores "C" or "P"
        const type: "C" | "P" = meta.contractType === "P" ? "P" : "C";

        // Strike: stored as ×1000 int → convert back to points (e.g. 7275000 → 7275)
        const strike = meta.strike / 1000;

        pending.push({
          time: obs.time,
          contract: formatOccSymbol(occ.value),
          mark: parseFloat(obs.mark),
          underlyingPrice: parseFloat(obs.underlyingPrice),
          strike,
          expiry,
          root,
          type,
        });
      }

      if (orphanedSymbols.length > 0) {
        console.warn(
          `readPendingObs: skipped ${orphanedSymbols.length} observations with no contract row: ${orphanedSymbols.slice(0, 5).join(", ")}${orphanedSymbols.length > 5 ? " …" : ""}`,
        );
      }

      return ok(pending);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForWritingBsmResults ─────────────────────────────────────────────────
  // BSM-03: update bsm_* columns for a batch of rows.
  // T-02-16: pass string 'NaN' for unsolvable rows — never JS NaN.
  // T-02-17: ONLY bsm_* columns updated; vendor columns (bid/ask/mark/iv/delta) untouched.
  // CR-05: entire batch wrapped in a transaction → all-or-nothing; a mid-batch DB
  // error rolls back all updates so no partial write is ever committed.
  const writeBsmResults: ForWritingBsmResults = async (
    writes,
  ): Promise<Result<void, StorageError>> => {
    if (writes.length === 0) return ok(undefined);
    try {
      await db.transaction(async (tx) => {
        for (const write of writes) {
          await tx
            .update(legObservations)
            .set({
              bsmIv: write.bsmIv,
              bsmDelta: write.bsmDelta,
              bsmGamma: write.bsmGamma,
              bsmTheta: write.bsmTheta,
              bsmVega: write.bsmVega,
            })
            .where(
              and(
                eq(legObservations.time, write.time),
                eq(legObservations.contract, write.contract),
              ),
            );
        }
      });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingLatestLegObs ───────────────────────────────────────────────
  // CAL-06: latest leg_observation for an OCC symbol — backs get_live_greeks.
  // ORDER BY time DESC LIMIT 1 → the most-recent row.
  // Returns ok(null) when no observation exists for the symbol.
  // T-03-15: Drizzle parameterized eq(contract, occSymbol) — no raw interpolation.
  const getLatestLegObs: ForReadingLatestLegObs = async (
    occSymbol,
  ): Promise<Result<LegSnapshot | null, StorageError>> => {
    try {
      const rows = await db
        .select({
          contract: legObservations.contract,
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
        .where(eq(legObservations.contract, occSymbol))
        .orderBy(desc(legObservations.time))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return ok(null);

      // Reuse the same mapping helper as resolveLegSnapshot in calendar-snapshots.ts
      const parsedOcc = parseOccSymbol(row.contract);
      if (!parsedOcc.ok) return ok(null); // malformed symbol — shouldn't happen

      const leg: LegSnapshot = {
        occSymbol: formatOccSymbol(parsedOcc.value),
        mark: parseFloat(row.mark),
        underlyingPrice: parseFloat(row.underlyingPrice),
        ivRaw: row.iv !== null ? parseFloat(row.iv) : null,
        bsmIv: row.bsmIv,
        bsmDelta: row.bsmDelta,
        bsmGamma: row.bsmGamma,
        bsmTheta: row.bsmTheta,
        bsmVega: row.bsmVega,
        source: row.source,
      };

      return ok(leg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingSmileSource ────────────────────────────────────────────────
  // ANLY-01 R1 + 06-06 (CR-01): per-(underlying, expiration, strike) smile points for a CYCLE
  // resolved as the latest leg_observations cohort AT OR BEFORE the anchor — NOT exact-equality.
  // The argument is an upper bound (the cycle anchor), mirroring readSnapshotsForCycle's
  // "latest snapshot ≤ now" resolution. Two-step:
  //   Step 1 — resolve the cycle time: MAX(leg_observations.time) ≤ anchor among BSM-solved rows
  //            (bsm_iv NOT NULL AND != 'NaN') so the resolved cycle is one that actually has a smile.
  //   Step 2 — read that cohort's smile via the existing join, eq(time, resolvedTime).
  // Maps bsm_iv → iv and bsm_delta → delta. Excludes NaN-stamped / unsolved rows. moneyness = K/S
  // is computed from the leg's underlying_price (spot); null when spot is non-finite-positive
  // (WR-03 / 06-08). Empty source / no cohort ≤ anchor → [].
  const readSmile: ForReadingSmileSource = async (
    snapshotTime,
  ): Promise<Result<SmileReadResult, StorageError>> => {
    try {
      // Step 1: resolve the latest BSM-solved leg cycle at or before the anchor.
      const latest = await db
        .select({ time: legObservations.time })
        .from(legObservations)
        .where(
          and(
            lte(legObservations.time, snapshotTime),
            isNotNull(legObservations.bsmIv),
            ne(legObservations.bsmIv, sql`'NaN'::numeric`),
          ),
        )
        .orderBy(desc(legObservations.time))
        .limit(1);

      const resolvedTime = latest[0]?.time;
      // No BSM-solved cohort at or before the anchor → null cycle, no quotes.
      if (resolvedTime === undefined) return ok({ cycleTime: null, quotes: [] });

      // Step 2: read the resolved cohort's smile.
      const rows = await db
        .select({
          underlying: contracts.underlying,
          expiration: contracts.expiration,
          strike: contracts.strike,
          bsmIv: legObservations.bsmIv,
          bsmDelta: legObservations.bsmDelta,
          underlyingPrice: legObservations.underlyingPrice,
        })
        .from(legObservations)
        .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
        .where(
          and(
            eq(legObservations.time, resolvedTime),
            isNotNull(legObservations.bsmIv),
            // Exclude NaN-stamped rows — bsm_iv = 'NaN'::numeric is NOT NULL but unusable.
            ne(legObservations.bsmIv, sql`'NaN'::numeric`),
          ),
        );

      const smile: SmileQuote[] = rows.map((row) => ({
        underlying: row.underlying,
        expiration: row.expiration,
        strike: row.strike,
        iv: parseFloat(row.bsmIv ?? "NaN"),
        delta: row.bsmDelta !== null ? parseFloat(row.bsmDelta) : null,
        // moneyness = K/S from underlying_price (spot); null when spot is non-finite-positive.
        moneyness: computeMoneyness(row.strike, parseFloat(row.underlyingPrice)),
      }));
      return ok({ cycleTime: resolvedTime, quotes: smile });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    persistObservations,
    upsertContracts,
    readPendingObs,
    writeBsmResults,
    getLatestLegObs,
    readSmile,
  };
}
