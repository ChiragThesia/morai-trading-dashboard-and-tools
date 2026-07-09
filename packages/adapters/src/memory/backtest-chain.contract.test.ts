import { describe } from "vitest";
import { runBacktestChainContractTests } from "../__contract__/backtest-chain.contract.ts";
import { makeMemoryBacktestChainRepo } from "./backtest-chain.ts";
import type { MemoryBacktestChainRepo } from "./backtest-chain.ts";
import type { ChainLegQuoteAsOf } from "@morai/core";

/**
 * Contract test for the in-memory backtest-chain twin (Phase 27, Plan 03).
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared
 * contract suite the Postgres adapter must satisfy (architecture-boundaries §8), including
 * BT-01's no-lookahead required check.
 */
describe("in-memory backtest-chain adapter", () => {
  const holder: { current: MemoryBacktestChainRepo | null } = { current: null };

  runBacktestChainContractTests(
    () => {
      const repo = makeMemoryBacktestChainRepo();
      holder.current = repo;
      return { readChainAsOf: repo.readChainAsOf };
    },
    () => ({
      seedLeg: async (leg: ChainLegQuoteAsOf): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedLeg called before makeRepo — holder not populated");
        }
        holder.current.seedLeg(leg);
      },
    }),
  );
});
