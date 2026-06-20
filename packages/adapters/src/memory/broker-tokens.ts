import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  SchwabTokenRow,
  TokenFreshnessMap,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  StorageError,
} from "@morai/core";
import { toAppTokenStatus } from "@morai/core";

/**
 * MemoryBrokerTokensRepo — in-memory twin of the Postgres broker-tokens repo.
 *
 * Implements ForReadingTokens, ForWritingTokens, and ForReadingTokenFreshness
 * using a plain Map backed store. Exposes seed() for test setup.
 *
 * Architectural rule: every driven port change ships an in-memory twin
 * (architecture-boundaries.md §8).
 */
export type MemoryBrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly seed: (appId: AppId, tokens: SchwabTokenRow) => Promise<void>;
};

export function makeMemoryBrokerTokensRepo(
  // Allow injection of a clock for testability; defaults to real clock
  getNow: () => Date = () => new Date(),
): MemoryBrokerTokensRepo {
  const store = new Map<AppId, SchwabTokenRow>();

  const readTokens: ForReadingTokens = async (
    appId: AppId,
  ): Promise<Result<SchwabTokenRow | null, StorageError>> => {
    const row = store.get(appId);
    if (row === undefined) return ok(null);
    return ok(row);
  };

  const writeTokens: ForWritingTokens = async (
    appId: AppId,
    tokens: SchwabTokenRow,
  ): Promise<Result<void, StorageError>> => {
    store.set(appId, tokens);
    return ok(undefined);
  };

  const readTokenFreshness: ForReadingTokenFreshness = async (): Promise<
    Result<TokenFreshnessMap | "none yet", StorageError>
  > => {
    const traderRow = store.get("trader");
    const marketRow = store.get("market");

    if (traderRow === undefined && marketRow === undefined) {
      return ok("none yet");
    }

    const now = getNow();

    const freshnessMap: TokenFreshnessMap = {
      trader: toAppTokenStatus(traderRow ?? null, now),
      market: toAppTokenStatus(marketRow ?? null, now),
    };

    return ok(freshnessMap);
  };

  const seed = async (appId: AppId, tokens: SchwabTokenRow): Promise<void> => {
    store.set(appId, tokens);
  };

  return { readTokens, writeTokens, readTokenFreshness, seed };
}
