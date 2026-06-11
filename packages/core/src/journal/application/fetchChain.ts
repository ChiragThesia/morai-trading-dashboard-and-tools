// fetchChain use-case — placeholder; full implementation in Task 2.
// Exported here so journal/index.ts re-export compiles in Task 1.
import type { Result } from "@morai/shared";
import type {
  ForFetchingChain,
  ForPersistingObservations,
  ForUpsertingContracts,
  FetchError,
  StorageError,
} from "./ports.ts";

export type FetchChainDeps = {
  readonly fetchChain: ForFetchingChain;
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly now: () => Date;
  readonly maxDte: number;
  readonly strikeBandPct: number;
};

export type ForRunningFetchChain = () => Promise<
  Result<void, FetchError | StorageError>
>;

/**
 * makeFetchChainUseCase — fetch SPX + SPXW chains, filter, persist.
 * See Task 2 for full implementation.
 */
export function makeFetchChainUseCase(
  _deps: FetchChainDeps,
): ForRunningFetchChain {
  // Full implementation added in Task 2.
  throw new Error("makeFetchChainUseCase: not yet implemented");
}
