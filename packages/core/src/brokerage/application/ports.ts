import type { Result } from "@morai/shared";
import type { OccSymbol } from "@morai/shared";
// Cross-context re-import of application-level error types (not domain/ sub-path) — allowed
import type { StorageError, FetchError } from "../../journal/application/ports.ts";

// ─── Re-export shared error types for brokerage consumers ─────────────────────

export type { StorageError, FetchError };

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * AppId — discriminates between the two independent Schwab OAuth apps (D-05/D-09).
 * Each app has its own access/refresh token pair stored in broker_tokens.
 */
export type AppId = "trader" | "market";

/**
 * SchwabTokenRow — the brokerage domain view of a token row.
 * Adapters translate from the DB schema to this shape at the boundary.
 * Tokens are stored as bytea in the DB; they arrive here as decrypted strings.
 */
export type SchwabTokenRow = {
  readonly appId: AppId;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly issuedAt: Date;
  readonly refreshIssuedAt: Date; // 7-day hard expiry clock starts here
  readonly expiresAt: Date; // issuedAt + 30 min (cached, not authoritative)
};

/**
 * AppTokenStatus — the freshness classification for a single Schwab app.
 * Used by getStatus use-case (AUTH-04) and job-level guards (D-07/D-08).
 */
export type AppTokenStatus = {
  readonly status: "fresh" | "stale" | "AUTH_EXPIRED" | "none_yet";
  readonly expiresAt: Date | null;
  readonly refreshIssuedAt: Date | null;
};

/**
 * TokenFreshnessMap — per-app freshness, one entry per AppId.
 */
export type TokenFreshnessMap = {
  readonly trader: AppTokenStatus;
  readonly market: AppTokenStatus;
};

/**
 * AuthExpiredError — returned when a refresh grant fails (invalid_grant / invalid_client)
 * or when refresh_issued_at > 7 days old. The appId identifies which app expired.
 */
export type AuthExpiredError = {
  readonly kind: "auth-expired";
  readonly appId: AppId;
};

/**
 * BrokerPosition — a single option position as returned by the trader adapter (BRK-02).
 */
export type BrokerPosition = {
  readonly occSymbol: OccSymbol;
  readonly putCall: "C" | "P";
  readonly longQty: number;
  readonly shortQty: number;
  readonly averagePrice: number | null;
  readonly marketValue: number | null;
  readonly underlyingSymbol: string;
};

/**
 * BrokerTransaction — a single trade as returned by the trader adapter (BRK-02).
 */
export type BrokerTransaction = {
  readonly activityId: number;
  readonly tradeDate: string; // YYYY-MM-DD
  readonly netAmount: number;
  readonly orderId: number | null;
  readonly legs: ReadonlyArray<{
    readonly occSymbol: OccSymbol;
    readonly qty: number;
    readonly price: number;
    readonly positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
  }>;
};

// ─── Driven ports (ForVerbingNoun convention) ─────────────────────────────────

/**
 * ForReadingTokens — read the token row for a given app (AUTH-02).
 * Returns null when no row exists for the appId (not yet set up).
 */
export type ForReadingTokens = (
  appId: AppId,
) => Promise<Result<SchwabTokenRow | null, StorageError>>;

/**
 * ForWritingTokens — upsert a full token row for a given app (AUTH-02).
 */
export type ForWritingTokens = (
  appId: AppId,
  tokens: SchwabTokenRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingTokenFreshness — compute freshness for both apps in one call (AUTH-04).
 * Returns "none yet" when neither app has tokens (not yet set up).
 * Composes ForReadingTokens + token-freshness domain functions.
 */
export type ForReadingTokenFreshness = () => Promise<
  Result<TokenFreshnessMap | "none yet", StorageError>
>;

/**
 * ForFetchingPositions — fetch positions from the Schwab trader API (BRK-02).
 */
export type ForFetchingPositions = (
  accountHash: string,
) => Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>>;

/**
 * ForFetchingTransactions — fetch trade transactions from the Schwab trader API (BRK-02).
 */
export type ForFetchingTransactions = (
  accountHash: string,
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
) => Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>>;
