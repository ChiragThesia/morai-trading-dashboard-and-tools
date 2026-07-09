/**
 * Shared contract-test suite for the backtest_runs persistence port (Phase 27, Plan 01).
 * Run this suite against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts (BT-04/BT-05):
 * - Persisting a report inserts one backtest_runs row and returns ok(void).
 * - Two persists (distinct auto-generated ids) both survive — the second never
 *   overwrites/updates the first (append-only): after two persists the table holds two rows.
 * - The repo surface exposes ONLY a write method named insertBacktestRun — no update, no
 *   delete, no weight-write method (BT-05 storage discipline).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ForPersistingBacktestRun, BacktestReport, BacktestRunRow } from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type BacktestRunsRepo = {
  readonly insertBacktestRun: ForPersistingBacktestRun;
  /** countRuns — test helper: count rows in backtest_runs (proves append-only retains prior rows). */
  readonly countRuns: () => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    generatedAt: "2026-07-09T14:00:00.000Z",
    fromDate: "2026-06-12",
    toDate: "2026-07-09",
    n: 13,
    mismatches: [],
    tradeReproductions: [],
    attribution: [],
    ablation: [],
    coverage: [],
    caveats: ["late-solved-bsm-optimism"],
    ...overrides,
  };
}

function makeRow(overrides: Partial<BacktestReport> = {}): BacktestRunRow {
  return {
    params: { from: "2026-06-12", to: "2026-07-09" },
    report: makeReport(overrides),
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runBacktestRunsContractTests(makeRepo: () => BacktestRunsRepo): void {
  describe("backtest-runs persistence contract", () => {
    let repo: BacktestRunsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("persisting a report inserts one row and returns ok(void)", async () => {
      const result = await repo.insertBacktestRun(makeRow());
      expect(result.ok).toBe(true);

      const count = await repo.countRuns();
      expect(count).toBe(1);
    });

    it("append-only: two persists both survive — the second never overwrites the first", async () => {
      const first = await repo.insertBacktestRun(makeRow({ n: 13 }));
      const second = await repo.insertBacktestRun(makeRow({ n: 13, fromDate: "2026-07-01" }));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const count = await repo.countRuns();
      expect(count).toBe(2);
    });

    it("BT-05: the repo surface exposes ONLY insertBacktestRun as a write — no update/delete/weight-write method", () => {
      const keys = Object.keys(repo);
      expect(keys).toContain("insertBacktestRun");
      const forbidden = keys.filter((k) => /update|delete|upsert|weight/i.test(k));
      expect(forbidden).toEqual([]);
    });
  });
}
