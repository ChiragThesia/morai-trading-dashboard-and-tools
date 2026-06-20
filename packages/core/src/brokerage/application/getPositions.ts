/**
 * getPositions.ts — BRK-02 use-case: resolve account hash then fetch positions.
 *
 * Hexagonal rules:
 *   - Imports @morai/shared and intra-context ports only — no adapters
 *   - Never throws across the port — all errors mapped to typed Result (D-12)
 *   - getAccessToken err (trader AUTH_EXPIRED) → returns err passthrough (D-09)
 */
import type { Result } from "@morai/shared";
import type {
  BrokerPosition,
  FetchError,
  AuthExpiredError,
  ForFetchingPositions,
  ForResolvingAccountHash,
} from "./ports.ts";

// ─── Driver port ──────────────────────────────────────────────────────────────

/** ForGettingPositions — driver port returned by makeGetPositionsUseCase. */
export type ForGettingPositions = () => Promise<
  Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>
>;

// ─── Use-case deps ────────────────────────────────────────────────────────────

export type GetPositionsDeps = {
  readonly resolveAccountHash: ForResolvingAccountHash;
  readonly fetchPositions: ForFetchingPositions;
};

/**
 * makeGetPositionsUseCase — resolves the account hash then fetches positions.
 *
 * Resolves hashValue once per call; errors (auth-expired, fetch-error) are
 * passed through as typed Result.err (never thrown).
 *
 * D-09: AUTH_EXPIRED from resolveAccountHash short-circuits without calling
 * fetchPositions — positions paused while market flows remain unaffected.
 */
export function makeGetPositionsUseCase(
  deps: GetPositionsDeps,
): ForGettingPositions {
  return async (): Promise<
    Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>
  > => {
    // Step 1: Resolve account hash first (T-04-20: always use hashValue)
    const hashResult = await deps.resolveAccountHash();
    if (!hashResult.ok) {
      // D-09: AUTH_EXPIRED pauses positions; passthrough typed error
      return hashResult;
    }

    // Step 2: Fetch positions with the resolved hash
    return deps.fetchPositions(hashResult.value);
  };
}
