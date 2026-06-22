import { describe, it, expect, beforeEach } from "vitest";
import type { ForReadingSmileSource } from "@morai/core";

/**
 * Shared contract-test suite for the leg-observations smile-source read (ForReadingSmileSource).
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * readSmile(snapshotTime) returns the per-(underlying, expiration, strike) smile points present in
 * leg_observations at that snapshot time, mapping bsm_iv → iv and bsm_delta → delta, EXCLUDING
 * NaN-stamped iv rows (bsm_iv = 'NaN'). moneyness has no source column → null.
 *
 * Asserts (ANLY-01 R1 source):
 * - a snapshot with N BSM-solved strikes → N smile points with iv from bsm_iv, delta from bsm_delta
 * - NaN-stamped rows (bsm_iv = 'NaN') are excluded
 * - rows whose bsm_iv is NULL (not yet solved) are excluded
 * - an empty time → empty array (never null/error)
 */

export type SmileSourceRepo = {
  readonly readSmile: ForReadingSmileSource;
  /** Seed a BSM-solved leg observation at the grain the smile read joins on. */
  readonly seedLeg: (input: {
    readonly snapshotTime: Date;
    readonly underlying: string;
    readonly expiration: string; // YYYY-MM-DD
    readonly strike: number; // ×1000 int
    readonly bsmIv: string | null; // numeric string, "NaN", or null
    readonly bsmDelta: string | null;
  }) => Promise<void>;
};

export function runSmileSourceContractTests(makeRepo: () => SmileSourceRepo): void {
  describe("leg-observations smile-source read contract", () => {
    let repo: SmileSourceRepo;
    let snapshotTime: Date;

    beforeEach(() => {
      repo = makeRepo();
      // Unique time per test to avoid cross-test collisions on the shared container.
      const ms = Math.floor(Math.random() * 1_000_000) * 1000;
      snapshotTime = new Date(Date.UTC(2030, 0, 1) + ms);
      snapshotTime.setMilliseconds(0);
    });

    it("returns one smile point per BSM-solved strike (iv from bsm_iv, delta from bsm_delta)", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5600000,
        bsmIv: "0.15", bsmDelta: "0.3",
      });

      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      const byStrike = new Map(result.value.map((q) => [q.strike, q]));
      expect(byStrike.get(5400000)?.iv).toBeCloseTo(0.18, 9);
      expect(byStrike.get(5400000)?.delta).toBeCloseTo(-0.2, 9);
      expect(byStrike.get(5600000)?.iv).toBeCloseTo(0.15, 9);
      expect(byStrike.get(5600000)?.delta).toBeCloseTo(0.3, 9);
      expect(byStrike.get(5400000)?.underlying).toBe("SPX");
      expect(byStrike.get(5400000)?.expiration).toBe("2026-07-17");
      expect(byStrike.get(5400000)?.moneyness).toBeNull();
    });

    it("excludes NaN-stamped iv rows (bsm_iv = 'NaN')", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5500000,
        bsmIv: "NaN", bsmDelta: "NaN",
      });

      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.strike).toBe(5400000);
    });

    it("excludes not-yet-solved rows (bsm_iv IS NULL)", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5700000,
        bsmIv: null, bsmDelta: null,
      });

      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.strike).toBe(5400000);
    });

    it("preserves a null delta when bsm_delta is NULL but bsm_iv is solved", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: null,
      });
      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.delta).toBeNull();
    });

    it("returns an empty array when no leg observations exist at the time", async () => {
      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });
  });
}
