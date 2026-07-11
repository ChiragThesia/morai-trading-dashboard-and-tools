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

import { ok, err, parseOccSymbol, settlementTimestamp } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  GexSnapshotRow,
  LegObsForGex,
  StorageError,
} from "./ports.ts";
// Cross-context application port (architecture-boundaries rule 7 — same convention
// analytics/application/getRegimeBoard.ts established for ForReadingMacroObservations).
import type { ForReadingMacroObservations, MacroObservationRow } from "../../journal/index.ts";
import { dollarGamma, strikeGex, buildProfile, findFlip, pickWalls } from "../domain/gex.ts";
import { impliedDivYield } from "../domain/implied-carry.ts";

// ─── Spot grid constants (from RESEARCH Pattern 3 + playground-v3 oracle) ────

/** Grid half-width around spot (index points). */
const GRID_HALF_WIDTH = 600;

/** Grid step size (index points). */
const GRID_STEP = 20;

/** Near-term level-set horizon: legs with calendar DTE ≤ this feed nearTerm. */
const NEAR_TERM_MAX_DTE_DAYS = 45;

// 34-04 (TOSP-02): matches the client's DAYS_PER_YEAR convention (D-02, scenario-engine.ts)
// so the T calibrated here and the T re-priced client-side use the same day-count.
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** DGS1MO/DGS3MO interpolation bracket, in days (34-RESEARCH.md Pattern 2). */
const RATE_BRACKET_LOW_DAYS = 30;
const RATE_BRACKET_HIGH_DAYS = 90;

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

/**
 * interpolateShortRate — the FRED DGS1MO/DGS3MO short-rate curve, linearly interpolated to
 * a leg's fractional DTE and clamped to the [30d, 90d] bracket (34-RESEARCH.md Pattern 2).
 * FRED reports percent (e.g. 4.5) — divided by 100 for the BSM-decimal convention. Null
 * when either series has no row (macro read succeeded but the series hasn't been fetched).
 */
function interpolateShortRate(
  macroRows: ReadonlyArray<MacroObservationRow>,
  dteDays: number,
): number | null {
  let oneMo: MacroObservationRow | undefined;
  let threeMo: MacroObservationRow | undefined;
  for (const row of macroRows) {
    if (row.seriesId === "DGS1MO" && (oneMo === undefined || row.date > oneMo.date)) oneMo = row;
    if (row.seriesId === "DGS3MO" && (threeMo === undefined || row.date > threeMo.date)) threeMo = row;
  }
  if (oneMo === undefined || threeMo === undefined) return null;

  const t = Math.min(
    Math.max((dteDays - RATE_BRACKET_LOW_DAYS) / (RATE_BRACKET_HIGH_DAYS - RATE_BRACKET_LOW_DAYS), 0),
    1,
  );
  const percent = oneMo.value + (threeMo.value - oneMo.value) * t;
  return Number.isFinite(percent) ? percent / 100 : null;
}

/**
 * pickAtmBracketPair — the strike nearest spot carrying BOTH a call and a put mark (the
 * ATM-bracket pair the parity solve needs).
 * ponytail: single nearest strike, not RESEARCH's 2-3-strike average — same well-conditioned
 * one-unknown solve with less code; add averaging if UAT shows single-strike noise.
 */
function pickAtmBracketPair(
  legs: ReadonlyArray<LegObsForGex>,
  spot: number,
): { readonly strike: number; readonly callMark: number; readonly putMark: number } | null {
  const byStrike = new Map<number, { call?: number; put?: number }>();
  for (const leg of legs) {
    const mark = Number(leg.mark);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    const entry = byStrike.get(leg.strike) ?? {};
    if (leg.contractType === "C") entry.call = mark;
    else entry.put = mark;
    byStrike.set(leg.strike, entry);
  }

  let best: { strike: number; callMark: number; putMark: number } | null = null;
  let bestDist = Infinity;
  for (const [strikeThousandths, pair] of byStrike) {
    if (pair.call === undefined || pair.put === undefined) continue;
    const strike = strikeThousandths / 1000; // ×1000 convention → points
    const dist = Math.abs(strike - spot);
    if (dist < bestDist) {
      bestDist = dist;
      best = { strike, callMark: pair.call, putMark: pair.put };
    }
  }
  return best;
}

/**
 * computeImpliedCarry — per-expiry {rate, divYield}: r interpolated from the live FRED
 * DGS1MO/DGS3MO curve, q solved via put-call parity over the ATM-bracket marks already in
 * the cohort (34-RESEARCH.md Pattern 2, TOSP-02). Degrades an individual expiry to no entry
 * (never a throw, never NaN) on an unparseable contract, a non-positive T, missing FRED
 * series, or no ATM pair; the whole field is null when nothing solves.
 */
function computeImpliedCarry(
  legs: ReadonlyArray<LegObsForGex>,
  spot: number,
  cycleTime: Date,
  macroRows: ReadonlyArray<MacroObservationRow>,
): GexSnapshotRow["impliedCarry"] {
  const byExpiry = new Map<string, LegObsForGex[]>();
  for (const leg of legs) {
    const group = byExpiry.get(leg.expiration);
    if (group === undefined) byExpiry.set(leg.expiration, [leg]);
    else group.push(leg);
  }

  const entries: Array<{ expiration: string; rate: number; divYield: number }> = [];
  for (const [expiration, group] of byExpiry) {
    const firstLeg = group[0];
    if (firstLeg === undefined) continue;

    const rootParsed = parseOccSymbol(firstLeg.contract);
    if (!rootParsed.ok) continue; // degrade: unparseable contract, skip this expiry

    const expiryDate = new Date(`${expiration}T00:00:00.000Z`);
    if (Number.isNaN(expiryDate.getTime())) continue;

    const settlement = settlementTimestamp(rootParsed.value.root, expiryDate);
    const T = (settlement.getTime() - cycleTime.getTime()) / MS_PER_YEAR;
    if (T <= 0) continue;

    const r = interpolateShortRate(macroRows, T * 365.25);
    if (r === null) continue;

    const pair = pickAtmBracketPair(group, spot);
    if (pair === null) continue;

    const q = impliedDivYield(pair.callMark, pair.putMark, spot, pair.strike, T, r);
    if (q === null) continue;

    entries.push({ expiration, rate: r, divYield: q });
  }

  return entries.length > 0 ? entries : null;
}

export type ComputeGexSnapshotDeps = {
  /** Read the latest leg_observations cohort for GEX computation. */
  readonly readLegObsForGex: ForReadingLegObsForGex;
  /** Persist a GexSnapshotRow (idempotent via onConflictDoNothing at the repo). */
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  /**
   * Read the live macro curve (FRED DGS1MO/DGS3MO) for the per-expiry carry resolve
   * (34-04, TOSP-02). A read failure degrades impliedCarry to null — never fails the
   * whole GEX snapshot.
   */
  readonly readMacroObservations: ForReadingMacroObservations;
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

    // ── Step 3: Compute spot as the average underlyingPrice across the cohort ─
    // All legs in the cohort are at the same cycle time and share the same
    // underlying quote (SPX). Computing the average rather than taking legs[0]
    // is deterministic — it does not depend on JOIN order (WR-03 / IN-04).
    // In practice the values should all be equal (same RTH snapshot), so the
    // average equals any individual value; the average is the safer invariant.
    if (legs.length === 0) return ok(undefined);
    const spot =
      legs.reduce((sum, leg) => sum + leg.underlyingPrice, 0) / legs.length;

    // ── Step 4: Compute per-strike GEX ───────────────────────────────────────
    const strikeEntries = strikeGex(legs, spot);

    // If no usable entries (all legs had NaN/null gamma), skip persist.
    if (strikeEntries.length === 0) return ok(undefined);

    // ── Step 5: Derive callWall / putWall (side-specific, bracketing spot) ────
    // callWall = largest call-side gamma strike AT/ABOVE spot; putWall = most-negative
    // put-side gamma strike AT/BELOW spot. Nulls preserved when a side has no gamma
    // in its bracket (WR-05 semantics).
    const { callWall, putWall } = pickWalls(strikeEntries, spot);

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
    // Uses domain dollarGamma directly (WR-02: removed duplicate dollarGammaContrib).
    const byExpiryMap = new Map<string, number>();
    for (const leg of legs) {
      // Skip legs without usable gamma
      const rawGamma = leg.bsmGamma;
      if (rawGamma === null || rawGamma === "NaN") continue;
      const gamma = Number(rawGamma);
      if (!Number.isFinite(gamma)) continue;

      const sign = leg.contractType === "C" ? 1 : -1;
      const dg = sign * dollarGamma(gamma, leg.openInterest, spot);
      const existing = byExpiryMap.get(leg.expiration);
      byExpiryMap.set(leg.expiration, (existing ?? 0) + dg);
    }

    const byExpiry = [...byExpiryMap.entries()]
      .map(([date, gex]) => ({ date, gex }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Step 8b: near-term (≤45d DTE) level set ──────────────────────────────
    // Far-dated OI (e.g. Sept quarterly 8000s) can dominate the all-expiry walls
    // with a structural level irrelevant intraday; recompute walls + flip from
    // only the near-dated legs. Null when no near-term legs solve.
    const nearLegs = legs.filter((leg) => {
      // Same expiry anchor as buildProfile (~4pm ET on expiration date).
      const expiryMs = new Date(leg.expiration + "T21:00:00Z").getTime();
      const dteDays = (expiryMs - leg.time.getTime()) / 86_400_000;
      return dteDays >= 0 && dteDays <= NEAR_TERM_MAX_DTE_DAYS;
    });

    let nearTerm: GexSnapshotRow["nearTerm"] = null;
    if (nearLegs.length > 0) {
      const nearEntries = strikeGex(nearLegs, spot);
      if (nearEntries.length > 0) {
        const nearWalls = pickWalls(nearEntries, spot);
        nearTerm = {
          callWall: nearWalls.callWall,
          putWall: nearWalls.putWall,
          flip: findFlip(buildProfile(nearLegs, spotGrid)),
        };
      }
    }

    // ── Step 8c: per-expiry implied carry (FRED rate + parity-implied divYield) ──
    // A macro-read failure degrades to null — GEX must still persist (T-34-03).
    const macroResult = await deps.readMacroObservations();
    const impliedCarry = macroResult.ok
      ? computeImpliedCarry(legs, spot, cycleTime, macroResult.value)
      : null;

    // ── Step 9: Build and persist the snapshot row ────────────────────────────
    const row: GexSnapshotRow = {
      cycleTime,
      spot,
      flip,
      callWall,
      putWall,
      netGammaAtSpot,
      // WR-01: profile field is `spot` (spot-price grid level), not `strike`
      profile: profile.map((p) => ({ spot: p.spot, gamma: p.gamma })),
      strikes: strikeEntries.map((e) => ({ k: e.k, gex: e.gex, coi: e.coi, poi: e.poi, vol: e.vol })),
      byExpiry,
      nearTerm,
      impliedCarry,
      computedAt: deps.now(),
    };

    const persistResult = await deps.persistGexSnapshot(row);
    if (!persistResult.ok) return err(persistResult.error);

    return ok(undefined);
  };
}

