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
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  ForFetchingPositions,
  ForFetchingTransactions,
} from "./application/ports.ts";

// Pure domain functions
export {
  isTokenExpired,
  isTokenStale,
  toAppTokenStatus,
} from "./domain/token-freshness.ts";

// AUTH-01: on-demand token refresh use-case (makeRefreshTokenUseCase)
export { makeRefreshTokenUseCase } from "./application/refreshToken.ts";
export type {
  SchwabTokens,
  OAuthError,
  ForRefreshingToken,
} from "./application/refreshToken.ts";
