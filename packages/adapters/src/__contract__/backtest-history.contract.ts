/**
 * Shared contract-test suite for the backtest point-in-time history reads (Phase 27, Plan 03).
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - readDailySpotClosesAsOf(nDays, asOfT): at most nDays distinct daily closes, ALL dated at
 *   or before asOfT — a close dated after asOfT is never included (RV20's as-of-T input,
 *   PITFALLS.md Pitfall 2's `vrp` leakage vector).
 * - readPickerSnapshotsInRange(from, to): every stored picker_snapshot cohort with
 *   observedAt in [from, to], ordered ASC — the cohort ledger for the leakage-oracle /
 *   hypothetical-entry walk-forward loops.
 * - Both degrade to ok([]) when no rows match.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForReadingDailySpotClosesAsOf,
  ForReadingPickerSnapshotsInRange,
} from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type BacktestHistoryRepo = {
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  readonly readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange;
};

// ─── Seed helpers (provided by each contract test file) ────────────────────────

export type SeedContext = {
  /** Seed one daily-close observation (mirrors a leg_observations row). */
  readonly seedDailyClose: (time: Date, underlyingPrice: number) => Promise<void>;
  /** Seed one picker_snapshot row. */
  readonly seedSnapshot: (observedAt: Date, snapshot: Record<string, unknown>) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSnapshotBlob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asOf: "2026-07-01",
    observedAt: "2026-07-01T14:00:00.000Z",
    spot: 7381,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [{ dte: 30, iv: 0.14 }],
    gex: {
      flip: 7488,
      callWall: 7600,
      putWall: 7400,
      netGammaAtSpot: -47.3,
      absGammaStrike: 7500,
    },
    events: [{ date: "2026-07-29", name: "FOMC" }],
    candidates: [],
    ...overrides,
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runBacktestHistoryContractTests(
  makeRepo: () => BacktestHistoryRepo,
  getSeedContext: () => SeedContext,
): void {
  describe("backtest-history point-in-time reads contract", () => {
    let repo: BacktestHistoryRepo;
    let seed: SeedContext;

    beforeEach(() => {
      repo = makeRepo();
      seed = getSeedContext();
    });

    describe("readDailySpotClosesAsOf — RV20 no-lookahead", () => {
      it("returns ok([]) when no closes exist", async () => {
        const result = await repo.readDailySpotClosesAsOf(20, new Date("2026-07-01T14:00:00Z"));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("excludes a close dated after asOfT", async () => {
        await seed.seedDailyClose(new Date("2026-06-29T20:00:00Z"), 7300);
        await seed.seedDailyClose(new Date("2026-06-30T20:00:00Z"), 7350);
        const asOfT = new Date("2026-06-30T21:00:00Z");
        await seed.seedDailyClose(new Date("2026-07-01T20:00:00Z"), 7999); // future — excluded

        const result = await repo.readDailySpotClosesAsOf(20, asOfT);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([7300, 7350]); // ASC by day, future close absent
      });

      it("returns at most nDays distinct days, the newest N kept, ASC order", async () => {
        const asOfT = new Date("2026-07-05T21:00:00Z");
        await seed.seedDailyClose(new Date("2026-06-29T20:00:00Z"), 7100);
        await seed.seedDailyClose(new Date("2026-06-30T20:00:00Z"), 7200);
        await seed.seedDailyClose(new Date("2026-07-01T20:00:00Z"), 7300);

        const result = await repo.readDailySpotClosesAsOf(2, asOfT);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([7200, 7300]);
      });
    });

    describe("readPickerSnapshotsInRange — cohort ledger", () => {
      it("returns ok([]) when no snapshots exist", async () => {
        const result = await repo.readPickerSnapshotsInRange(
          new Date("2026-06-12T00:00:00Z"),
          new Date("2026-07-09T00:00:00Z"),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("returns cohorts in [from, to] ASC by observedAt, excluding out-of-range rows", async () => {
        const t1 = new Date("2026-07-01T14:00:00Z");
        const t2 = new Date("2026-07-01T14:30:00Z");
        const outOfRange = new Date("2026-07-10T14:00:00Z");
        // Seed out of chronological order — proves the ASC sort, not insertion order.
        await seed.seedSnapshot(t2, makeSnapshotBlob({ observedAt: t2.toISOString(), spot: 7420 }));
        await seed.seedSnapshot(t1, makeSnapshotBlob({ observedAt: t1.toISOString(), spot: 7381 }));
        await seed.seedSnapshot(outOfRange, makeSnapshotBlob({ observedAt: outOfRange.toISOString() }));

        const result = await repo.readPickerSnapshotsInRange(
          new Date("2026-07-01T00:00:00Z"),
          new Date("2026-07-02T00:00:00Z"),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.observedAt.getTime()).toBe(t1.getTime());
        expect(result.value[1]?.observedAt.getTime()).toBe(t2.getTime());
        expect(result.value[0]?.snapshot["spot"]).toBe(7381);
        expect(result.value[1]?.snapshot["spot"]).toBe(7420);
      });
    });
  });
}
