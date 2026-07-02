import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  AppTokenStatus,
  SchwabTokenRow,
  TokenFreshnessMap,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  ForRecordingRefreshOutcome,
  StorageError,
} from "@morai/core";
import { toAppTokenStatus } from "@morai/core";

// Synthesized status for an app with no token row — carries the recorded
// lastRefreshError so the flag is surfaced even before any token is persisted
// (e.g. recordRefreshOutcome called on a first-run failure before writeTokens).
function noneYetStatus(lastRefreshError: string | null): AppTokenStatus {
  return {
    status: "none_yet",
    expiresAt: null,
    refreshIssuedAt: null,
    lastRefreshError,
    refreshExpiresIn: null,
  };
}

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
    // Merge the lastRefreshError from the separate store into the row view.
    // has()-based merge (WR-04): a recorded explicit null means "last refresh
    // succeeded — clear the flag" and must win over the row's stale value; a
    // plain `??` would treat the stored null as absent.
    const lastRefreshError = refreshErrors.has(appId)
      ? (refreshErrors.get(appId) ?? null)
      : row.lastRefreshError;
    return ok({ ...row, lastRefreshError });
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

    // Merge lastRefreshError from the errors store into each row (or null-row path).
    // has()-based merge (WR-04): an explicit recorded null clears the flag and must
    // win over the row's stale value — `??` would swallow it.
    const traderLastError = refreshErrors.has("trader")
      ? (refreshErrors.get("trader") ?? null)
      : (traderRow?.lastRefreshError ?? null);
    const marketLastError = refreshErrors.has("market")
      ? (refreshErrors.get("market") ?? null)
      : (marketRow?.lastRefreshError ?? null);

    const traderStatusRow: SchwabTokenRow | null =
      traderRow !== undefined
        ? { ...traderRow, lastRefreshError: traderLastError }
        : null;
    const marketStatusRow: SchwabTokenRow | null =
      marketRow !== undefined
        ? { ...marketRow, lastRefreshError: marketLastError }
        : null;

    const freshnessMap: TokenFreshnessMap = {
      trader:
        traderStatusRow !== null
          ? toAppTokenStatus(traderStatusRow, now)
          : noneYetStatus(traderLastError),
      market:
        marketStatusRow !== null
          ? toAppTokenStatus(marketStatusRow, now)
          : noneYetStatus(marketLastError),
    };

    return ok(freshnessMap);
  };

  const seed = async (appId: AppId, tokens: SchwabTokenRow): Promise<void> => {
    store.set(appId, tokens);
  };

  return { readTokens, writeTokens, readTokenFreshness, recordRefreshOutcome, seed };
}
