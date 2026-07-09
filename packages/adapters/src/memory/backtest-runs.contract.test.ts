import { describe } from "vitest";
import { runBacktestRunsContractTests } from "../__contract__/backtest-runs.contract.ts";
import { makeMemoryBacktestRunsRepo } from "./backtest-runs.ts";

/**
 * Contract test for the in-memory backtest-runs adapter (Phase 27, Plan 01).
 * No Docker required — runs always. Verifies twin parity with the Postgres adapter
 * per architecture-boundaries §8.
 */
describe("in-memory backtest-runs adapter", () => {
  runBacktestRunsContractTests(() => {
    const repo = makeMemoryBacktestRunsRepo();
    return {
      insertBacktestRun: repo.insertBacktestRun,
      countRuns: repo.countRuns,
    };
  });
});
