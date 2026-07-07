/**
 * GEX domain — pure gamma-exposure math.
 *
 * Hexagon law (architecture-boundaries §2):
 *   imports ONLY @morai/shared + the intra-core bsm.ts path.
 *   NO drizzle, NO zod, NO pg-boss, NO @morai/contracts.
 *
 * Functions exported:
 *   dollarGamma  — single-contract $ gamma per 1% spot move ($Bn/1%)
 *   strikeGex    — per-strike net GEX map (calls +, puts −)
 *   findFlip     — linear-interpolated zero-crossing of the net gamma profile
 *   buildProfile — spot-grid net gamma profile (re-prices via bsmGreeks)
 *
 * Oracle reference: playground-v3.html + gex-profile.json + gex-snapshot.json
 *   flip ≈ 7488, netGammaAtSpot ≈ −47 $Bn/1%, callWall = 7600, putWall = 7400
 */

import { bsmGreeks } from "../../journal/domain/bsm.ts";
import type { LegObsForGex } from "../application/ports.ts";

// ─── dollarGamma ─────────────────────────────────────────────────────────────

/**
 * Dollar gamma for a single contract position, expressed in $Bn per 1% spot move.
 *
 * Formula (SPX index options, multiplier = 100):
 *   $ gamma = gamma × OI × 100 × spot² × 0.01 / 1e9
 *
 * Derivation:
 *   - gamma (raw BSM) is ∂²V/∂S² per share
 *   - contract multiplier = 100 shares per contract
 *   - spot² × 0.01 = dollar gain per 1% spot move (S × 1% = 0.01S change;
 *     payoff ≈ ½ × gamma × (ΔS)² per share; for 1% move: ΔS = 0.01S →
 *     (ΔS)² = 0.0001 × S²; the standard GEX form uses gamma × OI × spot² × 0.01)
 *   - divide by 1e9 to express in $Bn
 *
 * @param gamma  - BSM gamma (per share, per point of spot move squared)
 * @param oi     - Open interest (number of contracts)
 * @param spot   - Current underlying spot price (index points)
 * @returns Dollar gamma in $Bn/1% spot move (positive = long gamma exposure)
 */
export function dollarGamma(gamma: number, oi: number, spot: number): number {
  return (gamma * oi * 100 * spot * spot * 0.01) / 1e9;
}

// ─── strikeGex ───────────────────────────────────────────────────────────────

/**
 * Per-strike aggregate GEX entry (returned as readonly).
 * gex:  net dollar gamma at this strike (cgex + pgex), in $Bn/1%.
 * cgex: call-side dollar gamma (≥ 0) — the call hedging concentration.
 * pgex: put-side dollar gamma (≤ 0) — the put hedging concentration.
 * coi: call open interest sum at this strike.
 * poi: put open interest sum at this strike.
 * vol: total open interest (coi + poi).
 */
export type StrikeGexEntry = {
  readonly k: number;
  readonly gex: number;
  readonly cgex: number;
  readonly pgex: number;
  readonly coi: number;
  readonly poi: number;
  readonly vol: number;
};

/**
 * Compute per-strike aggregate GEX from a set of leg observations.
 *
 * Sign convention (standard naive dealer positioning — SqueezeMetrics/Perfiliev):
 * dealers are assumed LONG calls (customers overwrite) → calls contribute POSITIVE
 * gamma, and SHORT puts (customers buy protection) → puts contribute NEGATIVE gamma.
 *
 * Each entry also carries the per-side concentrations (cgex/pgex) so wall selection
 * can follow the side-specific convention (see pickWalls) instead of netting.
 *
 * @param contracts - leg observations (from leg_observations JOIN contracts)
 * @param spot      - current underlying spot price (index points)
 * @returns per-strike GEX array sorted ascending by strike
 */
export function strikeGex(
  contracts: ReadonlyArray<LegObsForGex>,
  spot: number,
): ReadonlyArray<StrikeGexEntry> {
  // Accumulator: strike (in points) → mutable entry
  const acc = new Map<
    number,
    { cgex: number; pgex: number; coi: number; poi: number }
  >();

  for (const leg of contracts) {
    // Skip legs with missing/NaN gamma (NaN-stamped rows)
    const rawGamma = leg.bsmGamma;
    if (rawGamma === null || rawGamma === "NaN") continue;
    const gamma = Number(rawGamma);
    if (!Number.isFinite(gamma)) continue;

    // Strike in points (×1000 convention → divide by 1000)
    const k = leg.strike / 1000;

    const dg = dollarGamma(gamma, leg.openInterest, spot);
    const isCall = leg.contractType === "C";

    const existing = acc.get(k);
    if (existing === undefined) {
      acc.set(k, {
        cgex: isCall ? dg : 0,
        pgex: isCall ? 0 : -dg,
        coi: isCall ? leg.openInterest : 0,
        poi: isCall ? 0 : leg.openInterest,
      });
    } else {
      existing.cgex += isCall ? dg : 0;
      existing.pgex += isCall ? 0 : -dg;
      existing.coi += isCall ? leg.openInterest : 0;
      existing.poi += isCall ? 0 : leg.openInterest;
    }
  }

  // Sort ascending by strike, build result
  const result: StrikeGexEntry[] = [];
  for (const [k, v] of acc) {
    result.push({
      k,
      gex: v.cgex + v.pgex,
      cgex: v.cgex,
      pgex: v.pgex,
      coi: v.coi,
      poi: v.poi,
      vol: v.coi + v.poi,
    });
  }
  result.sort((a, b) => a.k - b.k);
  return result;
}

// ─── pickWalls ───────────────────────────────────────────────────────────────

/**
 * Side-specific wall selection (SpotGamma convention):
 *   callWall = strike with the LARGEST call-side dollar gamma (null when no call gamma)
 *   putWall  = strike with the MOST NEGATIVE put-side dollar gamma (null when no put gamma)
 *
 * NOT the net-GEX argmax/argmin: netting lets one side's OI cancel the other and
 * moves the wall away from where the hedging concentration actually sits.
 */
export function pickWalls(entries: ReadonlyArray<StrikeGexEntry>): {
  readonly callWall: number | null;
  readonly putWall: number | null;
} {
  let callWall: number | null = null;
  let callBest = 0;
  let putWall: number | null = null;
  let putBest = 0;

  for (const entry of entries) {
    if (entry.cgex > callBest) {
      callBest = entry.cgex;
      callWall = entry.k;
    }
    if (entry.pgex < putBest) {
      putBest = entry.pgex;
      putWall = entry.k;
    }
  }

  return { callWall, putWall };
}

// ─── findFlip ────────────────────────────────────────────────────────────────

/**
 * Find the gamma-flip level — the spot price where the net GEX profile crosses zero
 * (transitions from negative dealer gamma to positive dealer gamma).
 *
 * Linear interpolation between adjacent { spot, gamma } pairs where the sign changes.
 * Returns null when the profile never changes sign (Pitfall 5: all-negative or all-positive).
 *
 * The grid axis is named `spot` (not `strike`) because each entry is a simulated
 * spot level, not an option strike — the flip level is itself a spot level (WR-01).
 *
 * @param grid - net gamma profile sorted by spot ascending, each entry { spot, gamma }
 * @returns interpolated zero-crossing spot level, or null when no crossing exists
 */
export function findFlip(
  grid: ReadonlyArray<{ spot: number; gamma: number }>,
): number | null {
  if (grid.length < 2) return null;

  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i];
    const b = grid[i + 1];
    // TypeScript noUncheckedIndexedAccess: a and b may be undefined if grid is sparse
    if (a === undefined || b === undefined) continue;

    // Exact zero: treat as crossing (includes the b.gamma === 0 case)
    if (a.gamma === 0) return a.spot;
    if (b.gamma === 0) return b.spot;

    // Sign change between a and b → linear interpolation
    if (a.gamma < 0 && b.gamma > 0) {
      // zero crossing: a.gamma + t*(b.gamma - a.gamma) = 0 → t = -a.gamma / (b.gamma - a.gamma)
      const t = -a.gamma / (b.gamma - a.gamma);
      return a.spot + t * (b.spot - a.spot);
    }
    if (a.gamma > 0 && b.gamma < 0) {
      const t = -a.gamma / (b.gamma - a.gamma);
      return a.spot + t * (b.spot - a.spot);
    }
  }

  return null; // no zero-crossing found
}

// ─── buildProfile ─────────────────────────────────────────────────────────────

/**
 * Build the net gamma profile across a spot grid by re-pricing each contract's
 * gamma at each grid point via bsmGreeks().
 *
 * For each spot S in spotGrid:
 *   netGamma(S) = sum over all contracts of: dollarGamma(bsmGreeks(S,K,T,iv,r,q,type).gamma, OI, S)
 *
 * The result is in $Bn/1% (same units as dollarGamma output).
 *
 * Constants (SPX):
 *   r = 0.043  (risk-free rate, Fed funds approx)
 *   q = 0.013  (SPX continuous dividend yield, D-01)
 *
 * Each profile entry uses field `spot` (not `strike`) because the axis is a simulated
 * spot-price level, not an option strike. The flip returned by findFlip is also a spot
 * level — using the same name end-to-end prevents mislabeling (WR-01).
 *
 * @param contracts - leg observations with bsmIv, bsmGamma, dte, expiration
 * @param spotGrid  - array of spot prices at which to evaluate the profile
 * @returns profile array of { spot: gridSpotLevel, gamma: netDollarGamma } sorted by spot ascending
 */
export function buildProfile(
  contracts: ReadonlyArray<LegObsForGex>,
  spotGrid: ReadonlyArray<number>,
): ReadonlyArray<{ spot: number; gamma: number }> {
  // SPX standard constants
  const R = 0.043; // risk-free rate
  const Q = 0.013; // continuous dividend yield (D-01)

  // Pre-filter usable legs: must have finite bsmIv and dte > 0
  type UsableLeg = {
    readonly K: number; // strike in points
    readonly T: number; // time to expiry in years
    readonly iv: number; // BSM implied vol (decimal)
    readonly oi: number; // open interest
    readonly type: "C" | "P";
  };

  const usable: UsableLeg[] = [];
  for (const leg of contracts) {
    if (leg.bsmIv === null || leg.bsmIv === "NaN") continue;
    const iv = Number(leg.bsmIv);
    if (!Number.isFinite(iv) || iv <= 0) continue;

    // DTE: compute from expiration string (YYYY-MM-DD) vs the observation time
    // Use leg.time as the anchor (the observation timestamp)
    const expiryMs = new Date(leg.expiration + "T21:00:00Z").getTime(); // ~4pm ET expiry
    const obsMs = leg.time.getTime();
    const dteMs = expiryMs - obsMs;
    if (dteMs <= 0) continue; // expired

    const T = dteMs / (365.25 * 24 * 60 * 60 * 1000); // years
    const K = leg.strike / 1000; // points

    usable.push({ K, T, iv, oi: leg.openInterest, type: leg.contractType });
  }

  // Build profile: for each grid spot, sum dollar gamma across all usable legs
  const profile: { spot: number; gamma: number }[] = [];

  for (const S of spotGrid) {
    let netGamma = 0;
    for (const leg of usable) {
      const greeks = bsmGreeks(S, leg.K, leg.T, leg.iv, R, Q, leg.type);
      // Calls +, puts − (same sign convention as strikeGex)
      const sign = leg.type === "C" ? 1 : -1;
      netGamma += sign * dollarGamma(greeks.gamma, leg.oi, S);
    }
    profile.push({ spot: S, gamma: netGamma });
  }

  return profile;
}
