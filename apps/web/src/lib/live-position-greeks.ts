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
 *   netGreeksForLegs then multiplies by nq = netQty × 100.
 *   Live tick.bsm{Delta,…} is RAW per-share (same layer as kernel_per_share).
 *   Therefore the live contribution uses the same downstream factors:
 *     contribution = tick.bsmDelta × netQty × nq  (= tick × netQty² × 100)
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
  /** Net position greeks, scaled to position terms (per-share × netQty × nq). */
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

  for (const leg of legs) {
    const netQty = leg.longQty - leg.shortQty;
    const nq = netQty * 100;
    const tick = liveGreeks.get(leg.occSymbol);

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

    // ── Greeks ───────────────────────────────────────────────────────────────
    if (tick !== undefined) {
      // Live: substitute per-share tick values at the same layer as the kernel,
      // then apply the identical downstream scale factors (netQty × nq)
      greeks.delta += tick.bsmDelta * netQty * nq;
      greeks.gamma += tick.bsmGamma * netQty * nq;
      greeks.theta += tick.bsmTheta * netQty * nq;
      greeks.vega += tick.bsmVega * netQty * nq;
    } else {
      // Static: computePositionGreeks already scales by netQty;
      // netGreeksForLegs in Overview then multiplies by nq — same here
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
      greeks.delta += r.value.greeks.delta * nq;
      greeks.gamma += r.value.greeks.gamma * nq;
      greeks.theta += r.value.greeks.theta * nq;
      greeks.vega += r.value.greeks.vega * nq;
    }

    // ── liveTs: lexicographically greatest ts among ticked legs ──────────────
    if (tick !== undefined) {
      if (liveTs === null || tick.ts > liveTs) {
        liveTs = tick.ts;
      }
    }
  }

  return { netVal, unreal, greeks, liveTs };
}
