/**
 * getOrders.ts — BRK-02 use-case: resolve account hash then fetch orders (read-only).
 *
 * Hexagonal rules:
 *   - Imports @morai/shared and intra-context ports only — no adapters
 *   - Never throws across the port — all errors mapped to typed Result (D-12)
 *   - getAccessToken err (trader AUTH_EXPIRED) → returns err passthrough (D-09)
 *   - T-04-22: Read-only — no order placement; only GET
 */
import type { Result } from "@morai/shared";
import type {
  BrokerOrder,
  FetchError,
  AuthExpiredError,
  ForFetchingOrders,
  ForResolvingAccountHash,
} from "./ports.ts";

// ─── Driver port ──────────────────────────────────────────────────────────────

/** ForGettingOrders — driver port returned by makeGetOrdersUseCase. */
export type ForGettingOrders = () => Promise<
  Result<ReadonlyArray<BrokerOrder>, FetchError | AuthExpiredError>
>;

// ─── Use-case deps ────────────────────────────────────────────────────────────

export type GetOrdersDeps = {
  readonly resolveAccountHash: ForResolvingAccountHash;
  readonly fetchOrders: ForFetchingOrders;
};

/**
 * makeGetOrdersUseCase — resolves the account hash then fetches orders (read-only).
 *
 * Resolves hashValue once per call; errors (auth-expired, fetch-error) are
 * passed through as typed Result.err (never thrown).
 *
 * D-09: AUTH_EXPIRED from resolveAccountHash short-circuits without calling
 * fetchOrders — orders paused while market flows remain unaffected.
 * T-04-22: No write operations — only GET endpoints.
 */
export function makeGetOrdersUseCase(deps: GetOrdersDeps): ForGettingOrders {
  return async (): Promise<
    Result<ReadonlyArray<BrokerOrder>, FetchError | AuthExpiredError>
  > => {
    // Step 1: Resolve account hash first (T-04-20: always use hashValue)
    const hashResult = await deps.resolveAccountHash();
    if (!hashResult.ok) {
      // D-09: AUTH_EXPIRED pauses orders; passthrough typed error
      return hashResult;
    }

    // Step 2: Fetch orders with the resolved hash (read-only GET — T-04-22)
    return deps.fetchOrders(hashResult.value);
  };
}
