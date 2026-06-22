/**
 * getTransactions.ts — BRK-02 use-case: resolve account hash then fetch transactions.
 *
 * Hexagonal rules:
 *   - Imports @morai/shared and intra-context ports only — no adapters
 *   - Never throws across the port — all errors mapped to typed Result (D-12)
 *   - getAccessToken err (trader AUTH_EXPIRED) → returns err passthrough (D-09)
 */
import type { Result } from "@morai/shared";
import type {
  BrokerTransaction,
  FetchError,
  AuthExpiredError,
  ForFetchingTransactions,
  ForResolvingAccountHash,
} from "./ports.ts";

// ─── Driver port ──────────────────────────────────────────────────────────────

/** ForGettingTransactions — driver port returned by makeGetTransactionsUseCase. */
export type ForGettingTransactions = (
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
) => Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>>;

// ─── Use-case deps ────────────────────────────────────────────────────────────

export type GetTransactionsDeps = {
  readonly resolveAccountHash: ForResolvingAccountHash;
  readonly fetchTransactions: ForFetchingTransactions;
};

/**
 * makeGetTransactionsUseCase — resolves the account hash then fetches transactions.
 *
 * Resolves hashValue once per call; errors (auth-expired, fetch-error) are
 * passed through as typed Result.err (never thrown).
 *
 * D-09: AUTH_EXPIRED from resolveAccountHash short-circuits without calling
 * fetchTransactions — transactions paused while market flows remain unaffected.
 */
export function makeGetTransactionsUseCase(
  deps: GetTransactionsDeps,
): ForGettingTransactions {
  return async (
    from: string,
    to: string,
  ): Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>> => {
    // Step 1: Resolve account hash first (T-04-20: always use hashValue)
    const hashResult = await deps.resolveAccountHash();
    if (!hashResult.ok) {
      // D-09: AUTH_EXPIRED pauses transactions; passthrough typed error
      return hashResult;
    }

    // Step 2: Fetch transactions with the resolved hash + date range
    return deps.fetchTransactions(hashResult.value, from, to);
  };
}
