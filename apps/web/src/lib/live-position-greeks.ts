/**
 * live-position-greeks.ts — Pure live-or-static per-row greek resolver
 *
 * Consumes the live SSE tick map from useLiveStream and overlays live values
 * onto the Overview positions table rows. When no tick exists for a symbol,
 * falls back to the existing static computePositionGreeks / marketValue path
 * so the output is byte-identical to today's polled rendering.
 *
 * Scale contract (D-06 — must match Overview's netGreeksForLegs exactly):
 *   computePositionGreeks returns greeks.{delta,…} = kernel_per_share × netQty.
 *   The position greek is kernel_per_share × netQty × 100, so the STATIC path applies
 *   only the ×100 contract multiplier (computePositionGreeks already applied netQty).
 *   Live tick.bsm{Delta,…} is RAW per-share, so the LIVE path applies nq = netQty × 100.
 *   Both yield kernel_per_share × netQty × 100. Multiplying the static path by nq would
 *   double-apply netQty — over-scaling magnitude and flipping short-leg signs (CR-01).
 *
 * No any / as / !.
 */

import type { BrokerPositionResponse, StreamLiveGreekEvent } from "@morai/contracts";
import { computePositionGreeks } from "./position-greeks.ts";

// ─── Constants (must match Overview.tsx — D-01/D-12 defaults) ─────────────────

const DEFAULT_IV = 0.18;
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Output of a per-row resolution — live values when ticks present, static otherwise. */
export type LiveRowResult = {
  /** Signed total market value (live mark × netQty × 100, or Σ marketValue). */
  readonly netVal: number;
  /**
   * Signed unrealized P&L, or null if ANY leg is missing averagePrice and has no tick.
   * (tick.mark − averagePrice) × netQty × 100 live; Σ(marketValue − avg×netQty×100) static.
   */
  readonly unreal: number | null;
  /** Net position greeks, scaled to position terms (per-share × netQty × 100). */
  readonly greeks: { delta: number; gamma: number; theta: number; vega: number };
  /**
   * ISO-8601 UTC timestamp of the latest tick among legs that had a tick (lexicographic max).
   * null when no leg in this row received a live tick — per-symbol static fallback active.
   */
  readonly liveTs: string | null;
};

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the display values for one positions-table row.
 *
 * For each leg: if the liveGreeks Map contains a tick for that leg's occSymbol,
 * use the live values; otherwise fall through to the static computation (identical
 * to netGreeksForLegs / netValue / netUnreal in Overview.tsx).
 *
 * @param legs       All legs of the calendar/single row (ReadonlyArray from buildRows).
 * @param spot       Current spot price (from GEX snapshot).
 * @param liveGreeks Map of latest Zod-parsed tick per occSymbol (from useLiveStream).
 */
export function resolveLivePositionRow(
  legs: ReadonlyArray<BrokerPositionResponse>,
  spot: number,
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>,
): LiveRowResult {
  let netVal = 0;
  let unreal: number | null = 0; // null sentinel: any null averagePrice without tick makes whole row null
  const greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  let liveTs: string | null = null;

  // Money fields are all-or-nothing per row (2026-07-20 regression): a leg with no
  // tick (e.g. an expiry outside the chain-fetch window never gets observations) must
  // not be summed against a sibling's tick mark — two sources/instants inside one
  // hedged spread don't cancel, and a stale tick showed as +$1.4k phantom P&L. When
  // any leg lacks a tick, ALL legs price from the broker payload (one instant).
  const allTicked = legs.every((leg) => liveGreeks.has(leg.occSymbol));

  for (const leg of legs) {
    const netQty = leg.longQty - leg.shortQty;
    const nq = netQty * 100;
    const tick = allTicked ? liveGreeks.get(leg.occSymbol) : undefined;
    const greekTick = liveGreeks.get(leg.occSymbol);

    // ── Net val ──────────────────────────────────────────────────────────────
    if (tick !== undefined) {
      // Live: mark is per-share; signed by netQty (short = negative)
      netVal += tick.mark * netQty * 100;
    } else {
      // Static: marketValue is already the signed broker mark total
      netVal += leg.marketValue ?? 0;
    }

    // ── Unrealized P&L ───────────────────────────────────────────────────────
    if (unreal !== null) {
      if (tick !== undefined) {
        if (leg.averagePrice === null) {
          // No cost basis — row unreal becomes null
          unreal = null;
        } else {
          unreal += (tick.mark - leg.averagePrice) * netQty * 100;
        }
      } else {
        if (leg.marketValue === null || leg.averagePrice === null) {
          unreal = null;
        } else {
          // Static path mirrors netUnreal in Overview.tsx exactly
          unreal += leg.marketValue - leg.averagePrice * netQty * 100;
        }
      }
    }

    // ── Greeks (display-only, not money — per-leg blend is fine) ─────────────
    if (greekTick !== undefined) {
      // Live: tick.bsm* is RAW per-share (same layer as the kernel). Position greek =
      // per-share × netQty × 100 = per-share × nq. One netQty only (CR-01).
      greeks.delta += greekTick.bsmDelta * nq;
      greeks.gamma += greekTick.bsmGamma * nq;
      greeks.theta += greekTick.bsmTheta * nq;
      greeks.vega += greekTick.bsmVega * nq;
    } else {
      // Static: computePositionGreeks already scales by netQty, so apply ONLY the ×100
      // contract multiplier — using nq here would double-apply netQty (CR-01).
      const r = computePositionGreeks({
        occSymbol: leg.occSymbol,
        spot,
        iv: DEFAULT_IV,
        rate: DEFAULT_RATE,
        divYield: DEFAULT_DIV,
        longQty: leg.longQty,
        shortQty: leg.shortQty,
      });
      if (!r.ok) continue; // skip leg on OCC parse error (matches netGreeksForLegs)
      greeks.delta += r.value.greeks.delta * 100;
      greeks.gamma += r.value.greeks.gamma * 100;
      greeks.theta += r.value.greeks.theta * 100;
      greeks.vega += r.value.greeks.vega * 100;
    }

    // ── liveTs: lexicographically greatest ts — only when the whole row is live
    // (a partially-ticked row's money is static; badging it live would lie) ────
    if (tick !== undefined) {
      if (liveTs === null || tick.ts > liveTs) {
        liveTs = tick.ts;
      }
    }
  }

  return { netVal, unreal, greeks, liveTs };
}
