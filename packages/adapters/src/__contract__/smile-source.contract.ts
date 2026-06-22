import { describe, it, expect, beforeEach } from "vitest";
import type { ForReadingSmileSource } from "@morai/core";

/**
 * Shared contract-test suite for the leg-observations smile-source read (ForReadingSmileSource).
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * readSmile(snapshotTime) returns the per-(underlying, expiration, strike) smile points present in
 * leg_observations at that snapshot time, mapping bsm_iv → iv and bsm_delta → delta, EXCLUDING
 * NaN-stamped iv rows (bsm_iv = 'NaN'). moneyness is computed K/S = (strike / 1000) / spot from
 * the leg's underlying_price (spot); null when spot is absent/non-finite-positive (WR-03 / 06-08).
 *
 * Asserts (ANLY-01 R1 source):
 * - a snapshot with N BSM-solved strikes → N smile points with iv from bsm_iv, delta from bsm_delta
 * - moneyness = (strike / 1000) / spot when spot is a finite positive number
 * - moneyness = null when spot is absent/zero/non-finite (never Infinity/NaN persisted)
 * - NaN-stamped rows (bsm_iv = 'NaN') are excluded
 * - rows whose bsm_iv is NULL (not yet solved) are excluded
 * - an empty time → empty array (never null/error)
 *
 * Bounded "latest leg cycle ≤ anchor" resolution (06-06 / CR-01): readSmile's argument is an
 * ANCHOR (upper bound), not an exact-equality match. readSmile(anchor) resolves the latest
 * leg_observations cycle at or before the anchor and returns ONLY that cohort:
 * - two distinct seeded times T1 < T2 (both ≤ anchor) → only the T2 cohort (latest ≤ anchor)
 * - a cohort strictly before the anchor (T < A) → that cohort is returned (proves NOT exact-eq;
 *   this is the assertion that FAILS on the old exact-now() read)
 * - an anchor earlier than every seeded time → [] (no cohort at or before the anchor)
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
    /** spot = underlying_price (points). Omitted → adapter default; explicit "0"/non-finite → null moneyness. */
    readonly spot?: string;
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
      expect(result.value.cycleTime?.getTime()).toBe(snapshotTime.getTime());
      expect(result.value.quotes).toHaveLength(2);
      const byStrike = new Map(result.value.quotes.map((q) => [q.strike, q]));
      expect(byStrike.get(5400000)?.iv).toBeCloseTo(0.18, 9);
      expect(byStrike.get(5400000)?.delta).toBeCloseTo(-0.2, 9);
      expect(byStrike.get(5600000)?.iv).toBeCloseTo(0.15, 9);
      expect(byStrike.get(5600000)?.delta).toBeCloseTo(0.3, 9);
      expect(byStrike.get(5400000)?.underlying).toBe("SPX");
      expect(byStrike.get(5400000)?.expiration).toBe("2026-07-17");
      // No spot seeded here → moneyness falls back to null (computed only when spot is present).
      expect(byStrike.get(5400000)?.moneyness).toBeNull();
    });

    it("computes moneyness = (strike / 1000) / spot from underlying_price (WR-03)", async () => {
      // strike 5400000 → 5400 pts; spot 5500 → moneyness = 5400 / 5500 ≈ 0.98182.
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2", spot: "5500",
      });
      // strike 5600000 → 5600 pts; spot 5500 → moneyness = 5600 / 5500 ≈ 1.01818.
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5600000,
        bsmIv: "0.15", bsmDelta: "0.3", spot: "5500",
      });

      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const byStrike = new Map(result.value.quotes.map((q) => [q.strike, q]));
      expect(byStrike.get(5400000)?.moneyness ?? Number.NaN).toBeCloseTo(0.981818, 5);
      expect(byStrike.get(5600000)?.moneyness ?? Number.NaN).toBeCloseTo(1.018182, 5);
    });

    it("falls back to null moneyness when spot is zero/non-finite (never Infinity/NaN)", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2", spot: "0",
      });
      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.moneyness).toBeNull();
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
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.strike).toBe(5400000);
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
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.strike).toBe(5400000);
    });

    it("preserves a null delta when bsm_delta is NULL but bsm_iv is solved", async () => {
      await repo.seedLeg({
        snapshotTime, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: null,
      });
      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.delta).toBeNull();
    });

    it("returns an empty cohort (null cycleTime, no quotes) when no leg observations exist", async () => {
      const result = await repo.readSmile(snapshotTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cycleTime).toBeNull();
      expect(result.value.quotes).toEqual([]);
    });

    // ─── Bounded "latest leg cycle ≤ anchor" resolution (06-06 / CR-01) ──────────

    it("returns the cohort whose time is STRICTLY BEFORE the anchor (anchor is an upper bound, not exact-eq)", async () => {
      // The leg cohort is stamped at T_obs (broker observedAt); the anchor A is strictly later.
      const tObs = snapshotTime;
      const anchor = new Date(tObs.getTime() + 30 * 60 * 1000); // A = T_obs + 30 min
      await repo.seedLeg({
        snapshotTime: tObs, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });

      const result = await repo.readSmile(anchor);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Exact-equality read returns 0 rows here (A != T_obs); the bounded read returns the cohort.
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.strike).toBe(5400000);
      // cycleTime is the resolved DATA instant (T_obs), NOT the anchor.
      expect(result.value.cycleTime?.getTime()).toBe(tObs.getTime());
      expect(result.value.cycleTime?.getTime()).not.toBe(anchor.getTime());
    });

    it("resolves to the LATEST cohort at or before the anchor when two distinct times exist", async () => {
      const t1 = snapshotTime;
      const t2 = new Date(t1.getTime() + 30 * 60 * 1000); // later cohort, still ≤ anchor
      const anchor = new Date(t2.getTime() + 30 * 60 * 1000);
      // Earlier cohort (T1) — must NOT appear.
      await repo.seedLeg({
        snapshotTime: t1, underlying: "SPX", expiration: "2026-07-17", strike: 5300000,
        bsmIv: "0.22", bsmDelta: "-0.3",
      });
      // Later cohort (T2) — the resolved cycle.
      await repo.seedLeg({
        snapshotTime: t2, underlying: "SPX", expiration: "2026-07-17", strike: 5500000,
        bsmIv: "0.16", bsmDelta: "0.25",
      });

      const result = await repo.readSmile(anchor);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // ONLY the T2 cohort — never a union across times.
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.strike).toBe(5500000);
      expect(result.value.cycleTime?.getTime()).toBe(t2.getTime());
    });

    it("returns an empty cohort when the anchor is earlier than every seeded leg time", async () => {
      const tObs = snapshotTime;
      const anchor = new Date(tObs.getTime() - 30 * 60 * 1000); // A < T_obs
      await repo.seedLeg({
        snapshotTime: tObs, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });

      const result = await repo.readSmile(anchor);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cycleTime).toBeNull();
      expect(result.value.quotes).toEqual([]);
    });

    it("resolves the latest cohort that has a SOLVED smile, skipping a later all-NaN/NULL time", async () => {
      // A later time exists but is entirely NaN/unsolved — it must NOT be chosen as the resolved
      // cycle; the resolver picks the latest time that actually has a BSM-solved smile.
      const tSolved = snapshotTime;
      const tUnsolved = new Date(tSolved.getTime() + 30 * 60 * 1000);
      const anchor = new Date(tUnsolved.getTime() + 30 * 60 * 1000);
      await repo.seedLeg({
        snapshotTime: tSolved, underlying: "SPX", expiration: "2026-07-17", strike: 5400000,
        bsmIv: "0.18", bsmDelta: "-0.2",
      });
      await repo.seedLeg({
        snapshotTime: tUnsolved, underlying: "SPX", expiration: "2026-07-17", strike: 5600000,
        bsmIv: "NaN", bsmDelta: "NaN",
      });

      const result = await repo.readSmile(anchor);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.quotes).toHaveLength(1);
      expect(result.value.quotes[0]?.strike).toBe(5400000);
      // Resolved cycle is the solved time, not the later all-NaN time.
      expect(result.value.cycleTime?.getTime()).toBe(tSolved.getTime());
    });
  });
}
