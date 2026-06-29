/**
 * cotNet — pure net-per-class derivation for CFTC TFF positioning (D-04, COT-01/COT-02).
 *
 * NET = long − short for each of the five TFF trader classes.
 * NET is derived at the use-case layer and never stored in cot_observations (D-04).
 * netLeveraged is the headline "big guys" signal (hedge funds / CTAs, D-05).
 *
 * Pure function: no I/O, no ports, no side effects. Input type is a Pick of CotReport
 * so it can be tested with bare objects and composed into getCot without a full row.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import type { CotReport } from "./ports.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * CotNetResult — the five TFF net positions, one per class.
 * All values are integers (long − short over integer counts).
 * A negative net means the class holds more shorts than longs.
 */
export type CotNetResult = {
  readonly netDealer: number;
  readonly netAssetManager: number;
  readonly netLeveraged: number;
  readonly netOther: number;
  readonly netNonreportable: number;
};

type CotLegs = Pick<
  CotReport,
  | "dealerLong"
  | "dealerShort"
  | "assetMgrLong"
  | "assetMgrShort"
  | "levMoneyLong"
  | "levMoneyShort"
  | "otherReptLong"
  | "otherReptShort"
  | "nonreptLong"
  | "nonreptShort"
>;

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * cotNet(report) → { netDealer, netAssetManager, netLeveraged, netOther, netNonreportable }
 *
 * Property invariant: net + short === long for every class (no floating-point drift
 * since all inputs are integer position counts from the CFTC report).
 */
export function cotNet(report: CotLegs): CotNetResult {
  return {
    netDealer: report.dealerLong - report.dealerShort,
    netAssetManager: report.assetMgrLong - report.assetMgrShort,
    netLeveraged: report.levMoneyLong - report.levMoneyShort,
    netOther: report.otherReptLong - report.otherReptShort,
    netNonreportable: report.nonreptLong - report.nonreptShort,
  };
}
