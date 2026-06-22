import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForWritingSkewObservations,
  ForReadingSkewSmileDetail,
  SkewObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the skew-observations persistence port (per-strike smile).
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * Asserts (ANLY-01 R1):
 * - storeSkewObservations: write N fresh rows → count N
 * - idempotency: re-writing the SAME (snapshot_time, underlying, expiration, strike) grain →
 *   count still N (0 new) — onConflictDoNothing
 * - readSkewSeries: rows ordered by snapshot_time ASC; optional underlying/expiration filter
 * - readSkewSeries: empty array (never null) when no rows
 * - iv/delta/moneyness round-trip; nullable delta/moneyness survive as null
 *
 * The skew table holds per-strike smile detail; the headline read surface uses risk-reversal.
 * readSkewSmileDetail returns SkewObservationRow rows — the per-strike smile points.
 */

export type SkewObservationsRepo = {
  readonly storeSkewObservations: ForWritingSkewObservations;
  readonly readSkewSmileDetail: ForReadingSkewSmileDetail;
  /** Count rows in skew_observations (optionally for one underlying) */
  readonly countObservations: (underlying?: string) => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UNDERLYING = "SPX";
const EXPIRY = "2026-07-17";

function makeRow(
  snapshotTime: Date,
  strike: number,
  overrides: Partial<SkewObservationRow> = {},
): SkewObservationRow {
  // Use `in` so explicit null overrides survive (?? would replace null with the default).
  return {
    snapshotTime,
    underlying: overrides.underlying ?? UNDERLYING,
    expiration: overrides.expiration ?? EXPIRY,
    strike,
    iv: overrides.iv ?? 0.2,
    delta: "delta" in overrides ? (overrides.delta ?? null) : -0.25,
    moneyness: "moneyness" in overrides ? (overrides.moneyness ?? null) : 0.98,
  };
}

// ─── Seed context (skew rows have no FK; seedNoop keeps parity with term-structure) ──

export type SkewSeedContext = {
  seedNoop: () => Promise<void>;
};

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runSkewContractTests(
  makeRepo: (seed: SkewSeedContext) => SkewObservationsRepo,
  getSeedContext: () => SkewSeedContext,
): void {
  describe("skew-observations persistence contract", () => {
    let repo: SkewObservationsRepo;

    beforeEach(async () => {
      const seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedNoop();
    });

    describe("storeSkewObservations — write + idempotency", () => {
      it("writing N fresh rows writes exactly N rows", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const rows = [
          makeRow(t, 5300000, { delta: -0.35 }),
          makeRow(t, 5400000, { delta: -0.2 }),
          makeRow(t, 5600000, { delta: 0.2 }),
        ];

        const result = await repo.storeSkewObservations(rows);
        expect(result.ok).toBe(true);

        const count = await repo.countObservations();
        expect(count).toBe(3);
      });

      it("re-writing the same per-grain rows adds 0 new rows (idempotent)", async () => {
        const t = new Date("2026-07-01T19:30:00Z");
        const rows = [makeRow(t, 5300000), makeRow(t, 5400000)];

        await repo.storeSkewObservations(rows);
        await repo.storeSkewObservations(rows); // identical re-run

        const count = await repo.countObservations();
        expect(count).toBe(2); // idempotent — no duplicates
      });

      it("different strikes at the same snapshot time write distinct rows", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeSkewObservations([makeRow(t, 5300000)]);
        await repo.storeSkewObservations([makeRow(t, 5400000)]);

        const count = await repo.countObservations();
        expect(count).toBe(2);
      });
    });

    describe("readSkewSeries — ordering, filter, nullable round-trip", () => {
      it("returns rows ordered by snapshot_time ASC", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");

        await repo.storeSkewObservations([makeRow(t3, 5400000)]);
        await repo.storeSkewObservations([makeRow(t1, 5400000)]);
        await repo.storeSkewObservations([makeRow(t2, 5400000)]);

        const result = await repo.readSkewSmileDetail({ underlying: UNDERLYING });
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

      it("filters by underlying + expiration when provided", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeSkewObservations([
          makeRow(t, 5400000, { underlying: "SPX", expiration: "2026-07-17" }),
          makeRow(t, 5400000, { underlying: "NDX", expiration: "2026-07-17" }),
          makeRow(t, 5400000, { underlying: "SPX", expiration: "2026-08-21" }),
        ]);

        const result = await repo.readSkewSmileDetail({ underlying: "SPX", expiration: "2026-07-17" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.underlying).toBe("SPX");
        expect(result.value[0]?.expiration).toBe("2026-07-17");
      });

      it("returns an empty array (not null/error) when no rows exist", async () => {
        const result = await repo.readSkewSmileDetail({});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("round-trips iv exactly and preserves null delta/moneyness as null", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const iv = 0.1875;
        await repo.storeSkewObservations([
          makeRow(t, 5400000, { iv, delta: null, moneyness: null }),
        ]);

        const result = await repo.readSkewSmileDetail({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(row.iv).toBe(iv);
        expect(row.delta).toBeNull();
        expect(row.moneyness).toBeNull();
      });
    });
  });
}
