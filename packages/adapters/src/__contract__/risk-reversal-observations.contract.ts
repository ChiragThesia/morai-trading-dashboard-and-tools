import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForWritingRiskReversalObservations,
  ForReadingSkewSeries,
  ForReadingRiskReversalHistory,
  RiskReversalObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the risk-reversal-observations persistence port.
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * Asserts (ANLY-01 R2):
 * - storeRiskReversalObservations: write N fresh rows → count N
 * - idempotency: re-writing the SAME (snapshot_time, underlying, expiration) grain → 0 new rows
 * - nullable riskReversal/rrRank round-trip as NULL (never coerced to 0 — R2 prohibition)
 * - readRiskReversalSeries (= ForReadingSkewSeries): ordered by snapshot_time ASC; filterable;
 *   empty array when none
 * - readRiskReversalHistory: trailing window of prior NON-NULL riskReversal values for a
 *   (underlying, expiration) strictly before/at a time, capped at the limit, NULL rows excluded
 */

export type RiskReversalObservationsRepo = {
  readonly storeRiskReversalObservations: ForWritingRiskReversalObservations;
  readonly readRiskReversalSeries: ForReadingSkewSeries;
  readonly readRiskReversalHistory: ForReadingRiskReversalHistory;
  /** Count rows in risk_reversal_observations (optionally for one underlying) */
  readonly countObservations: (underlying?: string) => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UNDERLYING = "SPX";
const EXPIRY = "2026-07-17";

function makeRow(
  snapshotTime: Date,
  overrides: Partial<RiskReversalObservationRow> = {},
): RiskReversalObservationRow {
  // Use `in` so explicit null overrides survive (?? would replace null with the default).
  return {
    snapshotTime,
    underlying: overrides.underlying ?? UNDERLYING,
    expiration: overrides.expiration ?? EXPIRY,
    riskReversal: "riskReversal" in overrides ? (overrides.riskReversal ?? null) : 0.06,
    rrRank: "rrRank" in overrides ? (overrides.rrRank ?? null) : 50,
  };
}

// ─── Seed context (RR rows have no FK; seedNoop keeps parity) ────────────────────

export type RiskReversalSeedContext = {
  seedNoop: () => Promise<void>;
};

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runRiskReversalContractTests(
  makeRepo: (seed: RiskReversalSeedContext) => RiskReversalObservationsRepo,
  getSeedContext: () => RiskReversalSeedContext,
): void {
  describe("risk-reversal-observations persistence contract", () => {
    let repo: RiskReversalObservationsRepo;

    beforeEach(async () => {
      const seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedNoop();
    });

    describe("storeRiskReversalObservations — write + idempotency + nullable round-trip", () => {
      it("writing N fresh rows writes exactly N rows", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const result = await repo.storeRiskReversalObservations([makeRow(t1), makeRow(t2)]);
        expect(result.ok).toBe(true);
        const count = await repo.countObservations();
        expect(count).toBe(2);
      });

      it("re-writing the same grain adds 0 new rows (idempotent)", async () => {
        const t = new Date("2026-07-01T19:30:00Z");
        const rows = [makeRow(t)];
        await repo.storeRiskReversalObservations(rows);
        await repo.storeRiskReversalObservations(rows);
        const count = await repo.countObservations();
        expect(count).toBe(1);
      });

      it("nullable riskReversal/rrRank round-trip as NULL (never coerced to 0 — R2)", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeRiskReversalObservations([
          makeRow(t, { riskReversal: null, rrRank: null }),
        ]);
        const result = await repo.readRiskReversalSeries({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(row.riskReversal).toBeNull();
        expect(row.rrRank).toBeNull();
      });

      it("round-trips a non-null riskReversal exactly", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const rr = 0.0625;
        await repo.storeRiskReversalObservations([makeRow(t, { riskReversal: rr, rrRank: 33.5 })]);
        const result = await repo.readRiskReversalSeries({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value[0]?.riskReversal).toBe(rr);
        expect(result.value[0]?.rrRank).toBe(33.5);
      });
    });

    describe("readRiskReversalSeries — ordering, filter, empty", () => {
      it("returns rows ordered by snapshot_time ASC", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");
        await repo.storeRiskReversalObservations([makeRow(t3)]);
        await repo.storeRiskReversalObservations([makeRow(t1)]);
        await repo.storeRiskReversalObservations([makeRow(t2)]);
        const result = await repo.readRiskReversalSeries({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(3);
        expect(result.value[0]?.snapshotTime.getTime()).toBeLessThan(
          result.value[1]?.snapshotTime.getTime() ?? 0,
        );
        expect(result.value[1]?.snapshotTime.getTime()).toBeLessThan(
          result.value[2]?.snapshotTime.getTime() ?? 0,
        );
      });

      it("filters by underlying + expiration", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeRiskReversalObservations([
          makeRow(t, { underlying: "SPX", expiration: "2026-07-17" }),
          makeRow(t, { underlying: "NDX", expiration: "2026-07-17" }),
        ]);
        const result = await repo.readRiskReversalSeries({ underlying: "NDX" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.underlying).toBe("NDX");
      });

      it("returns an empty array (not null/error) when none", async () => {
        const result = await repo.readRiskReversalSeries({});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });
    });

    describe("readRiskReversalHistory — trailing NON-NULL window for rank", () => {
      it("returns prior non-null riskReversal values for the (underlying, expiration), excluding NULLs", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z"); // NULL RR — must be excluded
        const t4 = new Date("2026-07-01T20:30:00Z");
        await repo.storeRiskReversalObservations([
          makeRow(t1, { riskReversal: 0.01 }),
          makeRow(t2, { riskReversal: 0.02 }),
          makeRow(t3, { riskReversal: null, rrRank: null }),
          makeRow(t4, { riskReversal: 0.04 }),
        ]);

        const result = await repo.readRiskReversalHistory({
          underlying: UNDERLYING,
          expiration: EXPIRY,
          beforeOrAt: t4,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Three non-null values at/before t4 (0.01, 0.02, 0.04); the NULL at t3 excluded.
        expect([...result.value].sort((a, b) => a - b)).toEqual([0.01, 0.02, 0.04]);
      });

      it("excludes rows strictly after beforeOrAt", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");
        await repo.storeRiskReversalObservations([
          makeRow(t1, { riskReversal: 0.01 }),
          makeRow(t2, { riskReversal: 0.02 }),
          makeRow(t3, { riskReversal: 0.03 }),
        ]);
        const result = await repo.readRiskReversalHistory({
          underlying: UNDERLYING,
          expiration: EXPIRY,
          beforeOrAt: t2,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect([...result.value].sort((a, b) => a - b)).toEqual([0.01, 0.02]);
      });

      it("scopes history to the matching (underlying, expiration) only", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        await repo.storeRiskReversalObservations([
          makeRow(t1, { underlying: "SPX", expiration: "2026-07-17", riskReversal: 0.01 }),
          makeRow(t1, { underlying: "NDX", expiration: "2026-07-17", riskReversal: 0.99 }),
          makeRow(t1, { underlying: "SPX", expiration: "2026-08-21", riskReversal: 0.88 }),
        ]);
        const result = await repo.readRiskReversalHistory({
          underlying: "SPX",
          expiration: "2026-07-17",
          beforeOrAt: t1,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([0.01]);
      });
    });
  });
}
