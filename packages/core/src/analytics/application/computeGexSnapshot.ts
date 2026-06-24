/**
 * makeComputeGexSnapshotUseCase — the compute-gex-snapshot use-case.
 *
 * Reads the latest leg_observations cohort via ForReadingLegObsForGex, computes the full
 * GEX payload using the 08-03 domain functions (strikeGex / buildProfile / findFlip),
 * and persists exactly ONE GexSnapshotRow stamped with the resolved DATA cycle time.
 *
 * SC-2 design: cycle_time derives from the leg-obs cohort's `time` field (the DATA
 * instant), never from now(). now() is injected for bounding resolution ONLY — the same
 * 06-06 CR-01/CR-02 design as computeAnalytics. Re-runs for the same cycle collapse onto
 * the same cycle_time key (onConflictDoNothing at the repo layer = SC-4 idempotency).
 *
 * When the leg-obs array is empty (no usable rows with finite bsmGamma), the use-case
 * writes no row and returns ok(undefined) — no crash, no NaN row.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + local ports/domain.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  GexSnapshotRow,
  LegObsForGex,
  StorageError,
} from "./ports.ts";
import { strikeGex, buildProfile, findFlip } from "../domain/gex.ts";

// ─── Spot grid constants (from RESEARCH Pattern 3 + playground-v3 oracle) ────

/** Grid half-width around spot (index points). */
const GRID_HALF_WIDTH = 600;

/** Grid step size (index points). */
const GRID_STEP = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Snap a timestamp to the nearest 30-minute boundary (floor).
 * From RESEARCH.md Pattern 3: `snapCycleTime` — the cycle_time key for idempotency.
 * cycle_time derives from the DATA's own time, not now() — so now() is unused here.
 */
function snapCycleTime(t: Date): Date {
  const slotMs = 30 * 60 * 1000;
  return new Date(Math.floor(t.getTime() / slotMs) * slotMs);
}

/**
 * Build a spot-grid for the profile: [spot - GRID_HALF_WIDTH, ..., spot + GRID_HALF_WIDTH]
 * in GRID_STEP increments.
 */
function buildSpotGrid(spot: number): ReadonlyArray<number> {
  const grid: number[] = [];
  const start = Math.round(spot - GRID_HALF_WIDTH);
  const end = Math.round(spot + GRID_HALF_WIDTH);
  for (let s = start; s <= end; s += GRID_STEP) {
    grid.push(s);
  }
  return grid;
}

export type ComputeGexSnapshotDeps = {
  /** Read the latest leg_observations cohort for GEX computation. */
  readonly readLegObsForGex: ForReadingLegObsForGex;
  /** Persist a GexSnapshotRow (idempotent via onConflictDoNothing at the repo). */
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  /**
   * Clock injection — now() bounds resolution ONLY (architecture-boundaries §2).
   * NEVER used as the persisted cycle_time (06-06 / CR-01/CR-02 design).
   */
  readonly now: () => Date;
};

export function makeComputeGexSnapshotUseCase(
  deps: ComputeGexSnapshotDeps,
): () => Promise<Result<void, StorageError>> {
  return async (): Promise<Result<void, StorageError>> => {
    // ── Step 1: Read the latest leg-obs cohort ───────────────────────────────
    const readResult = await deps.readLegObsForGex();
    if (!readResult.ok) return err(readResult.error);
    const legs = readResult.value;

    // Empty cohort → no usable data; write no row and return ok.
    if (legs.length === 0) return ok(undefined);

    // ── Step 2: Resolve the data cycle time from the cohort ──────────────────
    // The cycle_time MUST come from the DATA (the leg-obs cohort's own `time` field).
    // SC-2 / CR-01: cycleTime ≠ now() — re-runs within the same cycle collapse on the
    // same key. Take the latest `time` in the cohort and snap to the 30-min slot.
    const latestTime = legs.reduce<Date | undefined>((max, leg) => {
      if (max === undefined) return leg.time;
      return leg.time.getTime() > max.getTime() ? leg.time : max;
    }, undefined);

    if (latestTime === undefined) return ok(undefined); // guard (already handled above)

    const cycleTime = snapCycleTime(latestTime);

    // ── Step 3: Extract spot (average underlyingPrice across the cohort) ─────
    // Use the first leg's underlyingPrice as spot — all legs at the same cycle time
    // share the same underlying quote.
    const firstLeg = legs[0];
    if (firstLeg === undefined) return ok(undefined);
    const spot = firstLeg.underlyingPrice;

    // ── Step 4: Compute per-strike GEX ───────────────────────────────────────
    const strikeEntries = strikeGex(legs, spot);

    // If no usable entries (all legs had NaN/null gamma), skip persist.
    if (strikeEntries.length === 0) return ok(undefined);

    // ── Step 5: Derive callWall / putWall / netGammaAtSpot ───────────────────
    // callWall = argmax over entries with positive gex (highest positive)
    // putWall  = argmin (most negative) entry
    let callWall: number | null = null;
    let callWallGex = -Infinity;
    let putWall: number | null = null;
    let putWallGex = Infinity;

    for (const entry of strikeEntries) {
      if (entry.gex > 0 && entry.gex > callWallGex) {
        callWallGex = entry.gex;
        callWall = entry.k;
      }
      if (entry.gex < putWallGex) {
        putWallGex = entry.gex;
        putWall = entry.k;
      }
    }

    // ── Step 6: Build the spot-grid profile ──────────────────────────────────
    const spotGrid = buildSpotGrid(spot);
    const profile = buildProfile(legs, spotGrid);

    // netGammaAtSpot: the profile value AT spot — the sum of dollar-gamma
    // re-priced at the current spot across all contracts (profile-at-spot semantics).
    // This is the oracle-defined scalar (gex.test.ts: "profile at s=7380 is -47.43").
    // It is NOT the per-strike concentrated GEX of the closest strike.
    const [spotPoint] = buildProfile(legs, [spot]);
    const netGammaAtSpot = spotPoint?.gamma ?? 0;

    // ── Step 7: Find the flip level ──────────────────────────────────────────
    const flip = findFlip(profile);

    // ── Step 8: Compute byExpiry ─────────────────────────────────────────────
    // Group per-strike GEX by expiration date.
    const byExpiryMap = new Map<string, number>();
    for (const leg of legs) {
      // Skip legs without usable gamma
      const rawGamma = leg.bsmGamma;
      if (rawGamma === null || rawGamma === "NaN") continue;
      const gamma = Number(rawGamma);
      if (!Number.isFinite(gamma)) continue;

      const sign = leg.contractType === "C" ? 1 : -1;
      const k = leg.strike / 1000;
      const dg = sign * dollarGammaContrib(gamma, leg.openInterest, spot);
      const existing = byExpiryMap.get(leg.expiration);
      byExpiryMap.set(leg.expiration, (existing ?? 0) + dg);

      void k; // k is used in strikeGex not here
    }

    const byExpiry = [...byExpiryMap.entries()]
      .map(([date, gex]) => ({ date, gex }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Step 9: Build and persist the snapshot row ────────────────────────────
    const row: GexSnapshotRow = {
      cycleTime,
      spot,
      flip,
      callWall,
      putWall,
      netGammaAtSpot,
      profile: profile.map((p) => ({ strike: p.strike, gamma: p.gamma })),
      strikes: strikeEntries.map((e) => ({ k: e.k, gex: e.gex, coi: e.coi, poi: e.poi, vol: e.vol })),
      byExpiry,
      computedAt: deps.now(),
    };

    const persistResult = await deps.persistGexSnapshot(row);
    if (!persistResult.ok) return err(persistResult.error);

    return ok(undefined);
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Dollar gamma contribution (same formula as domain dollarGamma). */
function dollarGammaContrib(gamma: number, oi: number, spot: number): number {
  return (gamma * oi * 100 * spot * spot * 0.01) / 1e9;
}
