/**
 * getCot.ts — makeGetCotUseCase read use-case (COT-02).
 *
 * Reads stored CotObservationRow[] from the repo and maps each row to a CotEntry:
 *   - asOf:         YYYY-MM-DD string (row.asOf, Tuesday report date, D-08)
 *   - publishedAt:  ISO datetime string (row.publishedAt.toISOString(), Friday fetch, D-07)
 *   - raw long/short legs (all five TFF classes)
 *   - net* fields derived by cotNet (D-04 — net not stored; derived here)
 *
 * CotEntry is structurally compatible with cotSeriesEntry from @morai/contracts.
 * It is defined here (not imported from contracts) so the hexagon stays pure
 * (architecture-boundaries §2: core → @morai/shared only).
 *
 * Empty store → ok([]).  StorageError from the repo is propagated unchanged.
 *
 * ForRunningGetCot is the driver port type consumed by 13-06's route + MCP tool.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingCotObservations, StorageError } from "./ports.ts";
import { cotNet } from "./cotNet.ts";

// ─── Domain shape (mirrored from cotSeriesEntry contract) ─────────────────────

/**
 * CotEntry — one week of CFTC TFF positioning after derivation.
 * Structurally compatible with CotSeriesEntry from @morai/contracts (D-04 / COT-02).
 * Defined here to keep the hexagon pure (no contracts import).
 */
export type CotEntry = {
  readonly asOf: string;           // YYYY-MM-DD — Tuesday report date (D-08)
  readonly publishedAt: string;    // ISO 8601 datetime — Friday fetch timestamp (D-07)
  readonly contractCode: string;   // "13874A" for E-mini S&P 500
  readonly openInterest: number;   // total open interest

  // ─── Dealer / Intermediary ─────────────────────────────────────────────────
  readonly dealerLong: number;
  readonly dealerShort: number;
  readonly netDealer: number;      // dealerLong − dealerShort (D-04)

  // ─── Asset Manager / Institutional ────────────────────────────────────────
  readonly assetMgrLong: number;
  readonly assetMgrShort: number;
  readonly netAssetManager: number; // assetMgrLong − assetMgrShort

  // ─── Leveraged Funds (D-05 headline signal) ────────────────────────────────
  readonly levMoneyLong: number;
  readonly levMoneyShort: number;
  readonly netLeveraged: number;   // levMoneyLong − levMoneyShort (D-05)

  // ─── Other Reportable ─────────────────────────────────────────────────────
  readonly otherReptLong: number;
  readonly otherReptShort: number;
  readonly netOther: number;       // otherReptLong − otherReptShort

  // ─── Non-Reportable (small speculators) ───────────────────────────────────
  readonly nonreptLong: number;
  readonly nonreptShort: number;
  readonly netNonreportable: number; // nonreptLong − nonreptShort
};

// ─── Port types ───────────────────────────────────────────────────────────────

/** ForRunningGetCot — driver port returned by makeGetCotUseCase (COT-02). */
export type ForRunningGetCot = () => Promise<
  Result<ReadonlyArray<CotEntry>, StorageError>
>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeGetCotUseCase — inject deps, return ForRunningGetCot.
 *
 * The returned driver:
 *   1. Reads CotObservationRow[] from the repo (ordered by asOf DESC).
 *   2. Maps each row → CotEntry using cotNet for the five net* fields.
 *   3. Returns ok([]) when no rows exist; propagates StorageError on failure.
 */
export function makeGetCotUseCase(deps: {
  readonly readCotObservations: ForReadingCotObservations;
}): ForRunningGetCot {
  return async (): Promise<Result<ReadonlyArray<CotEntry>, StorageError>> => {
    const result = await deps.readCotObservations();
    if (!result.ok) {
      return result;
    }

    const entries: ReadonlyArray<CotEntry> = result.value.map((row) => {
      const nets = cotNet(row);
      return {
        asOf: row.asOf,
        publishedAt: row.publishedAt.toISOString(),
        contractCode: row.contractCode,
        openInterest: row.openInterest,
        dealerLong: row.dealerLong,
        dealerShort: row.dealerShort,
        netDealer: nets.netDealer,
        assetMgrLong: row.assetMgrLong,
        assetMgrShort: row.assetMgrShort,
        netAssetManager: nets.netAssetManager,
        levMoneyLong: row.levMoneyLong,
        levMoneyShort: row.levMoneyShort,
        netLeveraged: nets.netLeveraged,
        otherReptLong: row.otherReptLong,
        otherReptShort: row.otherReptShort,
        netOther: nets.netOther,
        nonreptLong: row.nonreptLong,
        nonreptShort: row.nonreptShort,
        netNonreportable: nets.netNonreportable,
      };
    });

    return ok(entries);
  };
}
