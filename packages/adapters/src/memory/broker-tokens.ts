import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  SchwabTokenRow,
  TokenFreshnessMap,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  ForRecordingRefreshOutcome,
  StorageError,
} from "@morai/core";
import { toAppTokenStatus } from "@morai/core";

/**
 * MemoryBrokerTokensRepo — in-memory twin of the Postgres broker-tokens repo.
 *
 * Implements ForReadingTokens, ForWritingTokens, ForReadingTokenFreshness, and
 * ForRecordingRefreshOutcome using a plain Map backed store. Exposes seed() for test setup.
 *
 * Architectural rule: every driven port change ships an in-memory twin
 * (architecture-boundaries.md §8).
 *
 * D-14 (05-05): recordRefreshOutcome writes per-app lastRefreshError so readTokenFreshness
 * surfaces the per-app refresh failure flag at GET /api/status.
 */
export type MemoryBrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly recordRefreshOutcome: ForRecordingRefreshOutcome;
  readonly seed: (appId: AppId, tokens: SchwabTokenRow) => Promise<void>;
};

export function makeMemoryBrokerTokensRepo(
  // Allow injection of a clock for testability; defaults to real clock
  getNow: () => Date = () => new Date(),
): MemoryBrokerTokensRepo {
  const store = new Map<AppId, SchwabTokenRow>();
  // Separate store for the lastRefreshError flag so it survives across writeTokens calls.
  // writeTokens (token rotation) does NOT reset the flag — only recordRefreshOutcome owns it.
  const refreshErrors = new Map<AppId, string | null>();

  const readTokens: ForReadingTokens = async (
    appId: AppId,
  ): Promise<Result<SchwabTokenRow | null, StorageError>> => {
    const row = store.get(appId);
    if (row === undefined) return ok(null);
    // Merge the lastRefreshError from the separate store into the row view
    const lastRefreshError = refreshErrors.get(appId) ?? row.lastRefreshError;
    return ok({ ...row, lastRefreshError: lastRefreshError ?? null });
  };

  const writeTokens: ForWritingTokens = async (
    appId: AppId,
    tokens: SchwabTokenRow,
  ): Promise<Result<void, StorageError>> => {
    store.set(appId, tokens);
    return ok(undefined);
  };

  const recordRefreshOutcome: ForRecordingRefreshOutcome = async (
    appId: AppId,
    error: string | null,
  ): Promise<Result<void, StorageError>> => {
    refreshErrors.set(appId, error);
    return ok(undefined);
  };

  const readTokenFreshness: ForReadingTokenFreshness = async (): Promise<
    Result<TokenFreshnessMap | "none yet", StorageError>
  > => {
    const traderRow = store.get("trader");
    const marketRow = store.get("market");

    // "none yet" only when both stores are empty AND no refresh outcomes recorded
    if (traderRow === undefined && marketRow === undefined && refreshErrors.size === 0) {
      return ok("none yet");
    }

    const now = getNow();

    // Merge lastRefreshError from the errors store into each row (or null-row path)
    const traderLastError = refreshErrors.get("trader") ?? (traderRow?.lastRefreshError ?? null);
    const marketLastError = refreshErrors.get("market") ?? (marketRow?.lastRefreshError ?? null);

    const traderStatusRow: SchwabTokenRow | null =
      traderRow !== undefined
        ? { ...traderRow, lastRefreshError: traderLastError ?? null }
        : null;
    const marketStatusRow: SchwabTokenRow | null =
      marketRow !== undefined
        ? { ...marketRow, lastRefreshError: marketLastError ?? null }
        : null;

    // If no token rows but we have refresh errors recorded, synthesize minimal status rows
    // so the error flag is surfaced (handles the case where recordRefreshOutcome is called
    // without a prior writeTokens — e.g., first-run failure before any token is persisted).
    if (traderStatusRow === null && traderLastError !== null && traderLastError !== undefined) {
      const freshnessMap: TokenFreshnessMap = {
        trader: {
          status: "none_yet",
          expiresAt: null,
          refreshIssuedAt: null,
          lastRefreshError: traderLastError,
          refreshExpiresIn: null,
        },
        market: marketStatusRow !== null
          ? toAppTokenStatus(marketStatusRow, now)
          : {
              status: "none_yet",
              expiresAt: null,
              refreshIssuedAt: null,
              lastRefreshError: marketLastError ?? null,
              refreshExpiresIn: null,
            },
      };
      return ok(freshnessMap);
    }

    if (marketStatusRow === null && marketLastError !== null && marketLastError !== undefined) {
      const freshnessMap: TokenFreshnessMap = {
        trader: traderStatusRow !== null
          ? toAppTokenStatus(traderStatusRow, now)
          : {
              status: "none_yet",
              expiresAt: null,
              refreshIssuedAt: null,
              lastRefreshError: traderLastError ?? null,
              refreshExpiresIn: null,
            },
        market: {
          status: "none_yet",
          expiresAt: null,
          refreshIssuedAt: null,
          lastRefreshError: marketLastError,
          refreshExpiresIn: null,
        },
      };
      return ok(freshnessMap);
    }

    // If both rows are absent (but we reached here because refreshErrors.size > 0)
    if (traderStatusRow === null && marketStatusRow === null) {
      // We have refresh errors but no token rows — return a map with error flags
      const freshnessMap: TokenFreshnessMap = {
        trader: {
          status: "none_yet",
          expiresAt: null,
          refreshIssuedAt: null,
          lastRefreshError: traderLastError ?? null,
          refreshExpiresIn: null,
        },
        market: {
          status: "none_yet",
          expiresAt: null,
          refreshIssuedAt: null,
          lastRefreshError: marketLastError ?? null,
          refreshExpiresIn: null,
        },
      };
      return ok(freshnessMap);
    }

    const freshnessMap: TokenFreshnessMap = {
      trader: toAppTokenStatus(traderStatusRow, now),
      market: toAppTokenStatus(marketStatusRow, now),
    };

    return ok(freshnessMap);
  };

  const seed = async (appId: AppId, tokens: SchwabTokenRow): Promise<void> => {
    store.set(appId, tokens);
  };

  return { readTokens, writeTokens, readTokenFreshness, recordRefreshOutcome, seed };
}
