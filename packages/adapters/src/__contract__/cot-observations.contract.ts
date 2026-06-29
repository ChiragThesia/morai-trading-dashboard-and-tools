import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingCotObservation,
  ForReadingCotObservations,
  CotObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the cot-observations persistence port.
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - Inserting a row persists all fields (contractCode, asOf, all ten legs, publishedAt)
 * - published_at (Friday timestamp, D-07) and as_of (Tuesday date, D-08) are distinct
 * - COT-01 idempotency: re-insert same contractCode+asOf → 0 duplicate rows (DO NOTHING)
 * - listCotObservations() returns rows ordered by as_of DESC
 * - listCotObservations(limit) honours the limit argument
 * - listCotObservations() returns [] when no rows exist (requires fresh store per test)
 *
 * The Postgres wrapper MUST truncate cot_observations in its beforeEach so the
 * "empty array" and limit tests see a predictable table state.
 */

export type CotObservationsRepo = {
  readonly insertCotObservation: ForPersistingCotObservation;
  readonly listCotObservations: ForReadingCotObservations;
};

// Known fixture — mirrors knownCotReport from cot.contract.ts, adding publishedAt
const BASE_CONTRACT_CODE = "13874A";
const TUESDAY_AS_OF = "2026-06-24"; // Tuesday report date (from report's own field, D-08)
const PUBLISHED_AT = new Date("2026-06-27T17:00:00.000Z"); // Friday fetch timestamp (D-07)

function makeRow(overrides: Partial<CotObservationRow> = {}): CotObservationRow {
  return {
    contractCode: BASE_CONTRACT_CODE,
    asOf: TUESDAY_AS_OF,
    publishedAt: PUBLISHED_AT,
    openInterest: 2_987_456,
    dealerLong: 140_230,
    dealerShort: 89_560,
    assetMgrLong: 1_102_340,
    assetMgrShort: 654_320,
    levMoneyLong: 387_650,
    levMoneyShort: 523_410,
    otherReptLong: 210_870,
    otherReptShort: 198_340,
    nonreptLong: 145_000,
    nonreptShort: 132_780,
    ...overrides,
  };
}

export function runCotObservationsContractTests(
  makeRepo: () => CotObservationsRepo,
): void {
  describe("cot-observations persistence contract", () => {
    let repo: CotObservationsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("inserting a row persists contractCode, asOf, openInterest, and all ten legs", async () => {
      const row = makeRow();
      const insertResult = await repo.insertCotObservation(row);
      expect(insertResult.ok).toBe(true);

      const listResult = await repo.listCotObservations();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const found = listResult.value.find(
        (r) => r.contractCode === BASE_CONTRACT_CODE && r.asOf === TUESDAY_AS_OF,
      );
      expect(found).toBeDefined();
      if (found === undefined) return;

      expect(found.contractCode).toBe(row.contractCode);
      expect(found.asOf).toBe(row.asOf);
      expect(found.openInterest).toBe(row.openInterest);
      expect(found.dealerLong).toBe(row.dealerLong);
      expect(found.dealerShort).toBe(row.dealerShort);
      expect(found.assetMgrLong).toBe(row.assetMgrLong);
      expect(found.assetMgrShort).toBe(row.assetMgrShort);
      expect(found.levMoneyLong).toBe(row.levMoneyLong);
      expect(found.levMoneyShort).toBe(row.levMoneyShort);
      expect(found.otherReptLong).toBe(row.otherReptLong);
      expect(found.otherReptShort).toBe(row.otherReptShort);
      expect(found.nonreptLong).toBe(row.nonreptLong);
      expect(found.nonreptShort).toBe(row.nonreptShort);
    });

    it("published_at (Date) and as_of (YYYY-MM-DD) are stored as distinct values (D-07/D-08)", async () => {
      const row = makeRow();
      await repo.insertCotObservation(row);

      const listResult = await repo.listCotObservations();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const found = listResult.value.find(
        (r) => r.contractCode === BASE_CONTRACT_CODE && r.asOf === TUESDAY_AS_OF,
      );
      expect(found).toBeDefined();
      if (found === undefined) return;

      // asOf must be the Tuesday date string "2026-06-24" (D-08)
      expect(found.asOf).toBe(TUESDAY_AS_OF);
      // publishedAt must round-trip as a Date equal to the Friday fetch timestamp (D-07)
      expect(found.publishedAt).toBeInstanceOf(Date);
      expect(found.publishedAt.getTime()).toBe(PUBLISHED_AT.getTime());
      // D-07/D-08: as_of (Tuesday "2026-06-24") ≠ published_at date portion (Friday "2026-06-27")
      expect(found.asOf).not.toBe(found.publishedAt.toISOString().slice(0, 10));
    });

    it("COT-01 idempotency: re-inserting same contractCode+asOf inserts exactly 0 duplicate rows", async () => {
      const row = makeRow();
      const first = await repo.insertCotObservation(row);
      expect(first.ok).toBe(true);

      // Re-insert with different openInterest — proves DO NOTHING (not DO UPDATE)
      const duplicate = makeRow({ openInterest: 9_999_999 });
      const second = await repo.insertCotObservation(duplicate);
      expect(second.ok).toBe(true);

      const listResult = await repo.listCotObservations();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const rowsForWeek = listResult.value.filter(
        (r) => r.contractCode === BASE_CONTRACT_CODE && r.asOf === TUESDAY_AS_OF,
      );
      // Exactly ONE row — DO NOTHING means the re-insert is a no-op
      expect(rowsForWeek).toHaveLength(1);
      // Original openInterest preserved (not overwritten by the duplicate)
      const weekRow = rowsForWeek.at(0);
      expect(weekRow).toBeDefined();
      if (weekRow === undefined) return;
      expect(weekRow.openInterest).toBe(row.openInterest);
    });

    it("listCotObservations() returns rows ordered by as_of DESC", async () => {
      const older = makeRow({ asOf: "2026-06-17" });
      const newer = makeRow({ asOf: "2026-06-24" });
      await repo.insertCotObservation(older);
      await repo.insertCotObservation(newer);

      const listResult = await repo.listCotObservations();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      // Find the two rows we inserted; order must be DESC within the result
      const myRows = listResult.value.filter(
        (r) =>
          r.contractCode === BASE_CONTRACT_CODE &&
          (r.asOf === "2026-06-17" || r.asOf === "2026-06-24"),
      );
      expect(myRows).toHaveLength(2);
      const firstRow = myRows.at(0);
      const secondRow = myRows.at(1);
      expect(firstRow).toBeDefined();
      expect(secondRow).toBeDefined();
      if (firstRow === undefined || secondRow === undefined) return;
      // Newest first (2026-06-24 > 2026-06-17)
      expect(firstRow.asOf).toBe("2026-06-24");
      expect(secondRow.asOf).toBe("2026-06-17");
    });

    it("listCotObservations(1) returns at most 1 row (the newest)", async () => {
      const older = makeRow({ asOf: "2026-06-17" });
      const newer = makeRow({ asOf: "2026-06-24" });
      await repo.insertCotObservation(older);
      await repo.insertCotObservation(newer);

      const listResult = await repo.listCotObservations(1);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toHaveLength(1);
      const firstRow = listResult.value.at(0);
      expect(firstRow).toBeDefined();
      if (firstRow === undefined) return;
      // Limit=1 with DESC → must return the newest as_of
      expect(firstRow.asOf).toBe("2026-06-24");
    });

    it("listCotObservations() returns empty array when no rows exist", async () => {
      const listResult = await repo.listCotObservations();
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      // Fresh store (memory: new instance; Postgres: truncated in wrapper beforeEach)
      expect(listResult.value).toEqual([]);
    });
  });
}
