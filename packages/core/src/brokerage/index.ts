// Brokerage bounded context — ports and pure domain.
// Hexagon law: this module imports @morai/shared only (no adapters, no frameworks).

// Application ports (driven port contracts)
export type {
  AppId,
  SchwabTokenRow,
  AppTokenStatus,
  TokenFreshnessMap,
  AuthExpiredError,
  BrokerPosition,
  BrokerTransaction,
  BrokerOrder,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  ForFetchingPositions,
  ForFetchingTransactions,
  ForFetchingOrders,
  ForResolvingAccountHash,
} from "./application/ports.ts";

// Pure domain functions
export {
  isTokenExpired,
  isTokenStale,
  toAppTokenStatus,
  isNearExpiry,
} from "./domain/token-freshness.ts";

// AUTH-01: on-demand token refresh use-case (makeRefreshTokenUseCase)
export { makeRefreshTokenUseCase } from "./application/refreshToken.ts";
export type {
  SchwabTokens,
  OAuthError,
  ForRefreshingToken,
} from "./application/refreshToken.ts";

// Phase 5: ForRefreshingToken re-exported from ports (for consumers of brokerage index)
export type { ForRefreshingToken as ForRefreshingBrokerageToken } from "./application/ports.ts";

// Phase 5: refreshTokens use-case (JOB-02, D-13/D-14)
export { makeRefreshTokensUseCase } from "./application/refreshTokens.ts";
export type {
  RefreshTokensResult,
  AppRefreshOutcome,
  RefreshTokensDeps,
} from "./application/refreshTokens.ts";

// BRK-01: Schwab-primary / CBOE-fallback chain source selector (D-07/D-08)
export { selectChainSource } from "./application/selectChainSource.ts";

// BRK-02: trader data use-cases (positions, transactions, orders)
export { makeGetPositionsUseCase } from "./application/getPositions.ts";
export type { ForGettingPositions, GetPositionsDeps } from "./application/getPositions.ts";
export { makeGetTransactionsUseCase } from "./application/getTransactions.ts";
export type { ForGettingTransactions, GetTransactionsDeps } from "./application/getTransactions.ts";
export { makeGetOrdersUseCase } from "./application/getOrders.ts";
export type { ForGettingOrders, GetOrdersDeps } from "./application/getOrders.ts";
