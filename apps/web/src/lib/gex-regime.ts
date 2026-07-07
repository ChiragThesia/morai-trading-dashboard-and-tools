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

/**
 * zeroDteGex — the 0DTE net dealer GEX scalar from the snapshot's byExpiry rollup.
 *
 * "0DTE" = the expiry whose date equals the snapshot's ET calendar date (SPX expires
 * daily; the trading day is defined in America/New_York, so a post-close snapshot at
 * 00:30Z still belongs to the prior ET day). Returns null when that expiry has already
 * rolled off the snapshot (or the timestamp is unparseable) — callers render "—".
 *
 * Units: same $Bn/1% scale as netGammaAtSpot (byExpiry values come from dollarGamma).
 */
export function zeroDteGex(
  byExpiry: ReadonlyArray<{ readonly date: string; readonly gex: number }>,
  computedAt: string,
): number | null {
  const t = new Date(computedAt);
  if (Number.isNaN(t.getTime())) return null;
  // en-CA locale formats as YYYY-MM-DD — matches the byExpiry date convention.
  const etDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(t);
  return byExpiry.find((e) => e.date === etDate)?.gex ?? null;
}

/**
 * fmtGammaBn — format a $Bn/1%-unit gamma scalar as "+$9.8B" / "−$9.8B".
 * Same visual grammar as the Overview pill header's net-γ formatting.
 */
export function fmtGammaBn(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(1)}B`;
}
