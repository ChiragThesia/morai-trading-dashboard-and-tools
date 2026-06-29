/**
 * getCot.test.ts — makeGetCotUseCase read use-case (COT-02).
 *
 * Tests verify:
 *   1. Empty store → ok([])
 *   2. 2 seeded weeks → 2 entries returned (most-recent-first, matching the repo's DESC order)
 *   3. Each entry shape is valid: asOf YYYY-MM-DD, publishedAt ISO datetime, all int fields,
 *      net = long − short per class (inline validation mirroring cotSeriesEntry contract shape)
 *   4. netLeveraged = levMoneyLong − levMoneyShort (D-05 headline signal)
 *   5. StorageError from the repo is propagated unchanged
 *
 * Test doubles are inline implementations — core cannot import from @morai/adapters or
 * @morai/contracts (architecture-boundaries §2; packages/core/tsconfig.json references only
 * @morai/shared and @morai/quant).
 *
 * Shape validation is inline (YYYY-MM-DD regex, ISO datetime regex, Number.isInteger) —
 * equivalent to what cotSeriesEntry.safeParse from @morai/contracts would assert.
 *
 * No any/as/! (typescript.md). All promises awaited.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  CotObservationRow,
  ForReadingCotObservations,
  StorageError,
} from "./ports.ts";
import { makeGetCotUseCase } from "./getCot.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Week A — earlier (as_of 2026-01-06, Tuesday)
const ROW_A: CotObservationRow = {
  contractCode: "13874A",
  asOf: "2026-01-06",
  publishedAt: new Date("2026-01-10T21:00:00Z"), // Friday fetch
  openInterest: 480_000,
  dealerLong: 90_000,
  dealerShort: 70_000,
  assetMgrLong: 180_000,
  assetMgrShort: 160_000,
  levMoneyLong: 290_000,
  levMoneyShort: 270_000,
  otherReptLong: 45_000,
  otherReptShort: 35_000,
  nonreptLong: 75_000,
  nonreptShort: 65_000,
};

// Week B — more recent (as_of 2026-01-13, Tuesday)
const ROW_B: CotObservationRow = {
  contractCode: "13874A",
  asOf: "2026-01-13",
  publishedAt: new Date("2026-01-17T21:00:00Z"), // Friday fetch
  openInterest: 500_000,
  dealerLong: 100_000,
  dealerShort: 80_000,
  assetMgrLong: 200_000,
  assetMgrShort: 150_000,
  levMoneyLong: 300_000,
  levMoneyShort: 280_000,
  otherReptLong: 50_000,
  otherReptShort: 40_000,
  nonreptLong: 80_000,
  nonreptShort: 70_000,
};

// Inline memory repo — mirrors ForReadingCotObservations semantics (asOf DESC, optional limit)
function makeMemoryReadCotObservations(
  rows: ReadonlyArray<CotObservationRow>,
): ForReadingCotObservations {
  return async (limit?: number) => {
    const sorted = [...rows].sort((a, b) => b.asOf.localeCompare(a.asOf));
    const result = limit !== undefined ? sorted.slice(0, limit) : sorted;
    return ok(result);
  };
}

// ─── Shape validation helpers ─────────────────────────────────────────────────

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeGetCotUseCase", () => {
  it("empty store → ok([])", async () => {
    const readCotObservations = makeMemoryReadCotObservations([]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("2 seeded weeks → 2 entries (most-recent-first)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_A, ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    // Repo orders by asOf DESC — week B (2026-01-13) should come first
    expect(result.value[0]?.asOf).toBe("2026-01-13");
    expect(result.value[1]?.asOf).toBe("2026-01-06");
  });

  it("each entry has a valid asOf (YYYY-MM-DD) and publishedAt (ISO datetime)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_A, ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const entry of result.value) {
      expect(DATE_RE.test(entry.asOf)).toBe(true);
      expect(ISO_DATETIME_RE.test(entry.publishedAt)).toBe(true);
    }
  });

  it("all integer fields are integers (openInterest, legs, nets)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0];
    if (entry === undefined) return expect.fail("expected entry");
    const intFields: ReadonlyArray<number> = [
      entry.openInterest,
      entry.dealerLong, entry.dealerShort, entry.netDealer,
      entry.assetMgrLong, entry.assetMgrShort, entry.netAssetManager,
      entry.levMoneyLong, entry.levMoneyShort, entry.netLeveraged,
      entry.otherReptLong, entry.otherReptShort, entry.netOther,
      entry.nonreptLong, entry.nonreptShort, entry.netNonreportable,
    ];
    for (const v of intFields) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("net = long − short for each class (cotNet applied)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0];
    if (entry === undefined) return expect.fail("expected entry");
    // Verify net = long − short for every TFF class
    expect(entry.netDealer).toBe(ROW_B.dealerLong - ROW_B.dealerShort);
    expect(entry.netAssetManager).toBe(ROW_B.assetMgrLong - ROW_B.assetMgrShort);
    expect(entry.netLeveraged).toBe(ROW_B.levMoneyLong - ROW_B.levMoneyShort);
    expect(entry.netOther).toBe(ROW_B.otherReptLong - ROW_B.otherReptShort);
    expect(entry.netNonreportable).toBe(ROW_B.nonreptLong - ROW_B.nonreptShort);
  });

  it("netLeveraged = levMoneyLong − levMoneyShort (D-05 headline signal)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0];
    if (entry === undefined) return expect.fail("expected entry");
    expect(entry.netLeveraged).toBe(ROW_B.levMoneyLong - ROW_B.levMoneyShort); // 20_000
  });

  it("publishedAt is the ISO string of the stored Date (not as_of)", async () => {
    const readCotObservations = makeMemoryReadCotObservations([ROW_B]);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0];
    if (entry === undefined) return expect.fail("expected entry");
    expect(entry.publishedAt).toBe(ROW_B.publishedAt.toISOString());
    // publishedAt (Friday) ≠ asOf (Tuesday)
    expect(entry.publishedAt.slice(0, 10)).not.toBe(entry.asOf);
  });

  it("propagates StorageError from the repo", async () => {
    const storageErr: StorageError = { kind: "storage-error", message: "connection refused" };
    const readCotObservations: ForReadingCotObservations = async () => err(storageErr);
    const getCot = makeGetCotUseCase({ readCotObservations });
    const result = await getCot();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
    expect(result.error.message).toBe("connection refused");
  });
});
