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
 *
 * lastRefreshError (D-14 flag-only, 05-05): the most recent per-app refresh failure
 * message, or null when the last refresh succeeded. Stored as broker_tokens.last_refresh_error.
 */
export type SchwabTokenRow = {
  readonly appId: AppId;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly issuedAt: Date;
  readonly refreshIssuedAt: Date; // 7-day hard expiry clock starts here
  readonly expiresAt: Date; // issuedAt + 30 min (cached, not authoritative)
  readonly lastRefreshError: string | null; // null = last refresh succeeded
};

/**
 * AppTokenStatus — the freshness classification for a single Schwab app.
 * Used by getStatus use-case (AUTH-04) and job-level guards (D-07/D-08).
 *
 * lastRefreshError (D-14 flag-only): non-null when the most recent refresh attempt
 * for this app failed. Cleared to null on a successful refresh. Surfaced by
 * GET /api/status so operators can see per-app refresh failures without a new table.
 */
export type AppTokenStatus = {
  readonly status: "fresh" | "stale" | "AUTH_EXPIRED" | "none_yet";
  readonly expiresAt: Date | null;
  readonly refreshIssuedAt: Date | null;
  readonly lastRefreshError: string | null;
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

/**
 * BrokerOrder — a single read-only order (BRK-02, read phase only — no placement).
 */
export type BrokerOrder = {
  readonly orderId: number;
  readonly status: string;
  readonly legs: ReadonlyArray<{
    readonly occSymbol: OccSymbol;
    readonly qty: number;
    readonly side: "BUY" | "SELL" | "UNKNOWN";
  }>;
};

/**
 * ForFetchingOrders — fetch orders from the Schwab trader API (BRK-02, read-only).
 */
export type ForFetchingOrders = (
  accountHash: string,
) => Promise<Result<ReadonlyArray<BrokerOrder>, FetchError | AuthExpiredError>>;

/**
 * ForResolvingAccountHash — resolve the Schwab account hash from /accounts/accountNumbers.
 * Must be called before any trader data call (Pitfall 5 — never use the raw account number).
 */
export type ForResolvingAccountHash = () => Promise<
  Result<string, FetchError | AuthExpiredError>
>;

// ─── Phase 5 brokerage ports (JOB-02) ────────────────────────────────────────

// Re-export ForRefreshingToken from refreshToken.ts so consumers import from this boundary
export type { ForRefreshingToken } from "./refreshToken.ts";

/**
 * ForRecordingRefreshOutcome — persist the per-app refresh result on the broker_tokens row.
 *
 * error = non-null string → last_refresh_error persisted (failure; appId + reason only, never token)
 * error = null            → last_refresh_error cleared (successful refresh)
 *
 * Enables the GET /api/status per-app refresh-failure flag (D-14, flag + log only, no new table).
 * The worker writes this after each refresh attempt; the server reads it via readTokenFreshness.
 * Architecture: worker and server are separate processes — an in-memory map would not be readable.
 */
export type ForRecordingRefreshOutcome = (
  appId: AppId,
  error: string | null,
) => Promise<Result<void, StorageError>>;
