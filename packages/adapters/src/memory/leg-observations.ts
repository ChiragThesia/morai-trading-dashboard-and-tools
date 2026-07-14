/**
 * makeMemoryLegObservationsRepo — in-memory twin of the Postgres leg-observations adapter.
 *
 * Implements the subset of leg-observations ports needed by plan 06 use-cases:
 *   - ForPersistingObservations (write-path, used by tests that need seeded data)
 *   - ForReadingLatestLegObs (getLatestLegObs — backs get_live_greeks)
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * getLatestLegObs semantics: returns the observation with the MAX time
 * for the given OCC symbol; null when no observation exists.
 * (Mirrors Postgres ORDER BY time DESC LIMIT 1.)
 */

import { ok, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { computeMoneyness } from "../smile-moneyness.ts";
import { resolveRootCandidates } from "@morai/core";
import type {
  ForPersistingObservations,
  ForReadingLatestLegObs,
  ForReadingSmileSource,
  ForResolvingLegObservationForSlot,
  ObservationRow,
  LegSnapshot,
  SmileQuote,
  SmileReadResult,
  StorageError,
} from "@morai/core";

/**
 * SeededSmileLeg — a BSM-solved leg observation at the grain the smile read joins on
 * (leg_observations × contracts). Used by the memory twin's readSmile (ANLY-01 R1 source).
 * bsmIv "NaN" or null → excluded from the smile, mirroring Postgres.
 */
export type SeededSmileLeg = {
  readonly snapshotTime: Date;
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly strike: number; // ×1000 int
  readonly bsmIv: string | null;
  readonly bsmDelta: string | null;
  /** spot = underlying_price (points). Omitted → moneyness null (mirrors Postgres' guard). */
  readonly underlyingPrice?: string;
};

/** RTH slot width (mirrors postgres/repos/leg-observations.ts's SLOT_INTERVAL_MS). */
const SLOT_INTERVAL_MS = 30 * 60 * 1000;

export type MemoryLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly getLatestLegObs: ForReadingLatestLegObs;
  readonly readSmile: ForReadingSmileSource;
  /** Phase 40 (HIST-02): as-of-slot read — nearest observation at-or-before an anchor. */
  readonly resolveLegObservationForSlot: ForResolvingLegObservationForSlot;
  /** Test helper: seed a BSM-solved leg for the smile-source read. */
  readonly seedSmileLeg: (leg: SeededSmileLeg) => void;
};

export function makeMemoryLegObservationsRepo(): MemoryLegObservationsRepo {
  // Composite key: `${contract}:${time.toISOString()}` — idempotent (mirrors onConflictDoNothing)
  const store = new Map<string, ObservationRow>();
  // Smile-source seed store, keyed on the smile grain (snapshot_time, underlying, expiration, strike).
  const smileStore = new Map<string, SeededSmileLeg>();

  const persistObservations: ForPersistingObservations = async (
    rows: ReadonlyArray<ObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      const key = `${row.contract}:${row.time.toISOString()}`;
      if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  // getLatestLegObs: scan all rows for the symbol, pick the one with max time.
  // Memory-safe O(n): observation counts are small in tests.
  const getLatestLegObs: ForReadingLatestLegObs = async (
    occSymbol,
  ): Promise<Result<LegSnapshot | null, StorageError>> => {
    let latest: ObservationRow | null = null;

    for (const row of store.values()) {
      if (row.contract !== occSymbol) continue;
      if (latest === null || row.time > latest.time) {
        latest = row;
      }
    }

    if (latest === null) return ok(null);

    const leg: LegSnapshot = {
      occSymbol: latest.contract,
      time: latest.time,
      mark: latest.mark,
      underlyingPrice: latest.underlyingPrice,
      ivRaw: latest.iv,
      // Memory adapter: bsm fields are always null (not written by plan 06 memory tests)
      bsmIv: null,
      bsmDelta: null,
      bsmGamma: null,
      bsmTheta: null,
      bsmVega: null,
      source: latest.source,
    };

    return ok(leg);
  };

  const seedSmileLeg = (leg: SeededSmileLeg): void => {
    const key = `${leg.snapshotTime.toISOString()}|${leg.underlying}|${leg.expiration}|${leg.strike}`;
    smileStore.set(key, leg);
  };

  // resolveLegObservationForSlot (HIST-02): nearest observation to slotAnchor within the
  // half-open interval [slotAnchor, slotAnchor + 30min) — the observation that BELONGS to the
  // slot, not the nearest at-or-before it (live-fix 2026-07-14: the live writer builds a
  // slot's row from the freshest observation, fetched slightly AFTER the anchor, so
  // at-or-before semantics could never see it). Root-candidate-aware (D-04/HIST-01): tries the
  // stored root then its sibling, building each candidate's occSymbol directly (no separate
  // contracts table modeled here — the occSymbol's own embedded root prefix IS the contract's
  // real root).
  const resolveLegObservationForSlot: ForResolvingLegObservationForSlot = async (
    query,
  ): Promise<Result<LegSnapshot | null, StorageError>> => {
    const [y, m, d] = query.expiry.split("-").map(Number);
    const expiry = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    const anchorMs = query.slotAnchor.getTime();
    const intervalEndMs = anchorMs + SLOT_INTERVAL_MS;

    for (const root of resolveRootCandidates(query.underlying)) {
      const occSymbol = formatOccSymbol({
        root,
        expiry,
        type: query.optionType,
        strike: query.strike / 1000,
      });

      let nearest: ObservationRow | null = null;
      for (const row of store.values()) {
        if (row.contract !== occSymbol) continue;
        const t = row.time.getTime();
        if (t < anchorMs || t >= intervalEndMs) continue; // outside [anchor, anchor + interval)
        if (nearest === null || row.time < nearest.time) nearest = row; // nearest-to-anchor = earliest
      }

      if (nearest !== null) {
        return ok({
          occSymbol: nearest.contract,
          time: nearest.time,
          mark: nearest.mark,
          underlyingPrice: nearest.underlyingPrice,
          ivRaw: nearest.iv,
          // Memory adapter: bsm fields are always null (mirrors getLatestLegObs above).
          bsmIv: null,
          bsmDelta: null,
          bsmGamma: null,
          bsmTheta: null,
          bsmVega: null,
          source: nearest.source,
        });
      }
    }

    return ok(null);
  };

  // ForReadingSmileSource (06-06 / CR-01): the argument is the cycle ANCHOR (upper bound), not an
  // exact-equality match. Resolve the latest BSM-solved leg cohort AT OR BEFORE the anchor, then
  // return only that cohort. Excludes NaN-stamped iv (bsmIv === "NaN") and unsolved rows
  // (bsmIv === null), mirroring the Postgres adapter. No cohort ≤ anchor → [].
  const readSmile: ForReadingSmileSource = async (
    snapshotTime,
  ): Promise<Result<SmileReadResult, StorageError>> => {
    const anchor = snapshotTime.getTime();

    // Step 1: resolve the latest time ≤ anchor that has at least one BSM-solved leg.
    let resolvedTime: number | null = null;
    for (const leg of smileStore.values()) {
      if (leg.bsmIv === null || leg.bsmIv === "NaN") continue; // only solved cohorts qualify
      const t = leg.snapshotTime.getTime();
      if (t > anchor) continue;
      if (resolvedTime === null || t > resolvedTime) resolvedTime = t;
    }
    if (resolvedTime === null) return ok({ cycleTime: null, quotes: [] });

    // Step 2: return only the resolved cohort's solved legs.
    const smile: SmileQuote[] = [];
    for (const leg of smileStore.values()) {
      if (leg.snapshotTime.getTime() !== resolvedTime) continue;
      if (leg.bsmIv === null || leg.bsmIv === "NaN") continue;
      // moneyness = K/S from the seeded spot (underlying_price); null when absent/non-finite.
      const spot = leg.underlyingPrice === undefined ? Number.NaN : parseFloat(leg.underlyingPrice);
      smile.push({
        underlying: leg.underlying,
        expiration: leg.expiration,
        strike: leg.strike,
        iv: parseFloat(leg.bsmIv),
        delta: leg.bsmDelta !== null ? parseFloat(leg.bsmDelta) : null,
        moneyness: computeMoneyness(leg.strike, spot),
      });
    }
    return ok({ cycleTime: new Date(resolvedTime), quotes: smile });
  };

  return {
    persistObservations,
    getLatestLegObs,
    readSmile,
    resolveLegObservationForSlot,
    seedSmileLeg,
  };
}
