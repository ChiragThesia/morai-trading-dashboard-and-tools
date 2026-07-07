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

// D-14 (05-05): per-app refresh outcome recording port
export type { ForRecordingRefreshOutcome } from "./application/ports.ts";

// BRK-01: dual-source chain selector (Schwab freshness + CBOE breadth; CBOE-only on auth loss)
export { selectChainSources } from "./application/selectChainSource.ts";

// BRK-02: trader data use-cases (positions, transactions, orders)
export { makeGetPositionsUseCase } from "./application/getPositions.ts";
export type { ForGettingPositions, GetPositionsDeps } from "./application/getPositions.ts";
export { makeGetTransactionsUseCase } from "./application/getTransactions.ts";
export type { ForGettingTransactions, GetTransactionsDeps } from "./application/getTransactions.ts";
export { makeGetOrdersUseCase } from "./application/getOrders.ts";
export type { ForGettingOrders, GetOrdersDeps } from "./application/getOrders.ts";
