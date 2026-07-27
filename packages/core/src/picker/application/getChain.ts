/**
 * getChain.ts — makeGetChainUseCase read use-case (Analyzer chain data table).
 *
 * Reads the latest chain cohort via ForReadingChainForPicker and maps each
 * ChainQuoteForPicker row to a flat ChainEntry:
 *   - dte:        calendar days from the row's OWN observation day to its expiration
 *                 (daysBetween, the same calendar-day arithmetic candidate-selection uses —
 *                 never Date-instant subtraction, never Date.now()).
 *   - bsmIv:      numeric string → number. null (never inverted) and the stored "NaN"
 *                 sentinel (inversion failed) BOTH map to null. Never 0 — a zero IV is a
 *                 real, tradeable value and must not stand in for "unknown". A NaN would
 *                 also fail the route's Zod `number` check at the seam.
 *   - observedAt: row.time.toISOString() — ISO 8601, Z-suffixed.
 *   - everything else passes through unchanged (strike stays the ×1000 integer).
 *
 * Empty cohort → ok([]), never null. StorageError from the repo is propagated unchanged.
 *
 * ChainEntry is structurally compatible with the chain-entry contract in @morai/contracts.
 * It is declared here (not imported) so the hexagon stays pure — architecture-boundaries §2:
 * core → @morai/shared only, no contracts package, no ORM, no node I/O.
 *
 * Pure mapping: no clock read, no I/O beyond the injected port.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingChainForPicker, ForRunningGetChain, StorageError } from "./ports.ts";
import { daysBetween } from "../domain/candidate-selection.ts";

// ─── Response shape (mirrored from the chain-entry contract) ──────────────────

/**
 * ChainEntry — one option-chain row, flattened for the Analyzer data table.
 * Structurally compatible with the chain entry in @morai/contracts; declared here to keep
 * the hexagon pure (getCot.ts's CotEntry precedent).
 */
export type ChainEntry = {
  readonly strike: number; // ×1000 int (e.g. 7400000 = 7400 strike)
  readonly expiration: string; // YYYY-MM-DD
  readonly contractType: "C" | "P";
  /**
   * OCC root. SPX is AM-settled (third-Friday monthlies), SPXW is PM-settled (weeklies).
   * BOTH quote the same strikes and their expiration dates overlap, so (strike, expiration,
   * contractType) is NOT a unique key — root is what separates them. Consumers must carry it
   * into any row identity or strike join, or the two books collide into one row.
   */
  readonly root: "SPX" | "SPXW";
  readonly dte: number; // calendar days, 0 on expiry day
  readonly bsmIv: number | null; // null = never solved or inversion failed — never 0
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
  readonly underlyingPrice: number;
  readonly source: "schwab" | "cboe";
  readonly observedAt: string; // ISO 8601, Z-suffixed
};

export type GetChainDeps = {
  readonly readChain: ForReadingChainForPicker;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeGetChainUseCase — inject deps, return ForRunningGetChain.
 *
 * The returned driver:
 *   1. Reads the latest ChainQuoteForPicker[] cohort from the repo.
 *   2. Maps each row → ChainEntry (dte, bsmIv parse, observedAt).
 *   3. Returns ok([]) when the cohort is empty; propagates StorageError on failure.
 */
export function makeGetChainUseCase(deps: GetChainDeps): ForRunningGetChain {
  return async (): Promise<Result<ReadonlyArray<ChainEntry>, StorageError>> => {
    const result = await deps.readChain();
    if (!result.ok) {
      return result;
    }

    const entries: ReadonlyArray<ChainEntry> = result.value.map((row) => {
      // `contracts.expiration` is a Postgres `date NOT NULL` column, so it is always
      // YYYY-MM-DD — daysBetween's isoDayNumber assert is a true invariant here, never a
      // throw (the same guarantee analyzeAdHocCalendar.ts relies on). observedAt.slice(0,10)
      // is the established cohort-day convention (computePickerSnapshot.ts, candidate-
      // selection.ts); RTH instants never cross midnight UTC, so it equals the ET day.
      const observedAt = row.time.toISOString();
      // parseFloat, not Number: "" and the "NaN" sentinel both yield NaN, so neither can
      // silently become 0 (leg-observations.ts uses the same parse).
      const iv = row.bsmIv === null ? Number.NaN : Number.parseFloat(row.bsmIv);
      return {
        strike: row.strike,
        expiration: row.expiration,
        contractType: row.contractType,
        // Absent root degrades to SPXW, mirroring picker-chain.ts's own PM-settled default —
        // only SPX third-Friday contracts settle AM.
        root: row.root ?? "SPXW",
        dte: daysBetween(observedAt.slice(0, 10), row.expiration),
        bsmIv: Number.isFinite(iv) ? iv : null,
        bid: row.bid,
        ask: row.ask,
        openInterest: row.openInterest,
        underlyingPrice: row.underlyingPrice,
        source: row.source,
        observedAt,
      };
    });

    return ok(entries);
  };
}
