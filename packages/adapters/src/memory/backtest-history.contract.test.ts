import { describe } from "vitest";
import { runBacktestHistoryContractTests } from "../__contract__/backtest-history.contract.ts";
import { makeMemoryBacktestHistoryRepo } from "./backtest-history.ts";
import type { MemoryBacktestHistoryRepo } from "./backtest-history.ts";

/**
 * Contract test for the in-memory backtest-history twin (Phase 27, Plan 03).
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared
 * contract suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */
describe("in-memory backtest-history adapter", () => {
  const holder: { current: MemoryBacktestHistoryRepo | null } = { current: null };

  runBacktestHistoryContractTests(
    () => {
      const repo = makeMemoryBacktestHistoryRepo();
      holder.current = repo;
      return {
        readDailySpotClosesAsOf: repo.readDailySpotClosesAsOf,
        readPickerSnapshotsInRange: repo.readPickerSnapshotsInRange,
      };
    },
    () => ({
      seedDailyClose: async (time: Date, underlyingPrice: number): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedDailyClose called before makeRepo — holder not populated");
        }
        holder.current.seedDailyClose(time, underlyingPrice);
      },
      seedSnapshot: async (observedAt: Date, snapshot: Record<string, unknown>): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedSnapshot called before makeRepo — holder not populated");
        }
        holder.current.seedSnapshot({ observedAt, snapshot });
      },
    }),
  );
});
