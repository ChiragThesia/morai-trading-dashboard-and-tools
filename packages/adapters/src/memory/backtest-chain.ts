import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ChainLegQuoteAsOf, ForReadingChainAsOf, StorageError } from "@morai/core";

/**
 * makeMemoryBacktestChainRepo — in-memory twin of the Postgres backtest-chain adapter
 * (Phase 27, Plan 03).
 *
 * Mirrors the Postgres two-step cohort resolution exactly, over a plain seeded array:
 * (1) the latest observation time with a non-null bsmIv, at or before asOfT (BT-01 bound —
 *     the only difference from the live picker-chain read); (2) the 10-min lookback window,
 *     puts only, newest-per-contract wins.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryBacktestChainRepo = {
  readonly readChainAsOf: ForReadingChainAsOf;
  /** seedLeg — append one raw leg quote (mirrors a legObservations+contracts join row). */
  readonly seedLeg: (leg: ChainLegQuoteAsOf) => void;
};

/** Cohort lookback — matches picker-chain.ts / gex-snapshot.repo.ts. */
const LOOKBACK_MS = 10 * 60 * 1000;

export function makeMemoryBacktestChainRepo(): MemoryBacktestChainRepo {
  const legs: ChainLegQuoteAsOf[] = [];

  const readChainAsOf: ForReadingChainAsOf = async (
    asOfT: Date,
  ): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> => {
    // Step 1: latest BSM-filled observation time at or before asOfT, over ALL contract
    // types (no puts filter yet — matches the Postgres MAX(time) step).
    const eligible = legs.filter(
      (l) => l.bsmIv !== null && l.time.getTime() <= asOfT.getTime(),
    );
    if (eligible.length === 0) return ok([]);
    const latestTime = Math.max(...eligible.map((l) => l.time.getTime()));
    const windowStart = latestTime - LOOKBACK_MS;

    // Step 2: lookback window, puts only, newest-per-contract wins (DISTINCT ON equivalent).
    const inWindow = legs.filter(
      (l) =>
        l.contractType === "P" &&
        l.time.getTime() >= windowStart &&
        l.time.getTime() <= latestTime,
    );
    const newestByContract = new Map<string, ChainLegQuoteAsOf>();
    for (const leg of inWindow) {
      const existing = newestByContract.get(leg.occSymbol);
      if (existing === undefined || leg.time.getTime() > existing.time.getTime()) {
        newestByContract.set(leg.occSymbol, leg);
      }
    }
    return ok([...newestByContract.values()]);
  };

  const seedLeg = (leg: ChainLegQuoteAsOf): void => {
    legs.push(leg);
  };

  return { readChainAsOf, seedLeg };
}
