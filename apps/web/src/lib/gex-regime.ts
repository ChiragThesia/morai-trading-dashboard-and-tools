/**
 * gex-regime.ts — GEX regime classifier.
 *
 * Pure function: classifyRegime(netGammaAtSpot) → "AMPLIFY" | "DAMPEN"
 *
 * Regime logic:
 *   - AMPLIFY (coral, negative gamma): netGammaAtSpot < 0
 *     Dealers are net short gamma → must trade WITH the market to hedge.
 *     This amplifies directional moves (dealer gamma acts as a positive feedback loop).
 *   - DAMPEN (teal, positive gamma): netGammaAtSpot >= 0
 *     Dealers are net long gamma → must trade AGAINST the market to hedge.
 *     This dampens directional moves (dealer gamma acts as a mean-reversion force).
 *
 * Used by:
 *   - Market screen regime strip (Plan 08)
 *   - Analyzer right panel GEX note text (Plan 10)
 */

export type GexRegime = "AMPLIFY" | "DAMPEN";

/**
 * classifyRegime — pure function, no I/O.
 *
 * @param netGammaAtSpot - Net aggregate dealer GEX at the current spot level ($Bn/1% units).
 *                          From gexSnapshotEntry.netGammaAtSpot.
 * @returns "AMPLIFY" when net gamma at spot is negative (dealers short gamma),
 *          "DAMPEN" when net gamma at spot is zero or positive (dealers long gamma).
 */
export function classifyRegime(netGammaAtSpot: number): GexRegime {
  return netGammaAtSpot < 0 ? "AMPLIFY" : "DAMPEN";
}
