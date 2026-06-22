/**
 * refreshToken.ts — on-demand token refresh use-case (AUTH-01).
 *
 * Reads the stored refresh token, calls the OAuth client, persists the
 * rotated tokens on success, and returns err({kind:'auth-expired'}) on
 * invalid_grant/invalid_client — never writing half-state (T-04-08).
 *
 * Hexagonal rules:
 *   - Imports @morai/shared and intra-context ports only — no adapters
 *   - Never throws across the port — all errors mapped to typed Result
 *   - Never logs token values — only appId in error messages
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  SchwabTokenRow,
  AuthExpiredError,
  StorageError,
  ForReadingTokens,
  ForWritingTokens,
} from "./ports.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * SchwabTokens — the OAuth response shape the refreshTokens function returns.
 * Defined here so core does not import from the adapter layer.
 */
export type SchwabTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number; // seconds
};

/**
 * OAuthError — typed error from the OAuth client (mirrors oauth-client.ts).
 * Defined here for use in the port signature without importing from adapters.
 */
export type OAuthError = {
  readonly kind: "oauth-error";
  readonly code: "invalid_grant" | "invalid_client" | "network" | "parse";
  readonly message: string;
};

/**
 * ForRefreshingToken — the driver port for the on-demand refresh use-case.
 * Returns:
 *   ok(SchwabTokens)       — successful rotation; tokens are persisted
 *   err(AuthExpiredError)  — invalid_grant / invalid_client / no stored tokens
 *   err(StorageError)      — DB failure reading or writing tokens
 */
export type ForRefreshingToken = (
  appId: AppId,
) => Promise<Result<SchwabTokens, AuthExpiredError | StorageError>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeRefreshTokenUseCase — builds the on-demand refresh use-case.
 *
 * Dependencies (injected — no direct adapter imports):
 *   readTokens     — ForReadingTokens (Postgres or in-memory)
 *   writeTokens    — ForWritingTokens (Postgres or in-memory)
 *   refreshTokens  — OAuth refreshTokens function (from SchwabOAuthClient)
 */
export function makeRefreshTokenUseCase(deps: {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly refreshTokens: (
    refreshToken: string,
  ) => Promise<Result<SchwabTokens, OAuthError>>;
}): ForRefreshingToken {
  return async (appId: AppId) => {
    // Step 1: Read the currently stored tokens
    let currentTokens: SchwabTokenRow | null;
    try {
      const readResult = await deps.readTokens(appId);
      if (!readResult.ok) {
        // Storage error reading tokens
        return err<StorageError>(readResult.error);
      }
      currentTokens = readResult.value;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }

    // Step 2: No tokens stored → cannot refresh
    if (currentTokens === null) {
      return err<AuthExpiredError>({ kind: "auth-expired", appId });
    }

    // Step 3: Call the OAuth client to exchange the refresh token
    let newTokens: SchwabTokens;
    try {
      const refreshResult = await deps.refreshTokens(currentTokens.refreshToken);
      if (!refreshResult.ok) {
        const oauthErr = refreshResult.error;
        // invalid_grant/invalid_client → AUTH_EXPIRED; never write half-state (T-04-08)
        if (
          oauthErr.code === "invalid_grant" ||
          oauthErr.code === "invalid_client"
        ) {
          return err<AuthExpiredError>({ kind: "auth-expired", appId });
        }
        // CR-02: network / parse are TRANSIENT — surface a retryable storage-error
        // so pg-boss retries and the status flag does NOT falsely claim expiry.
        return err<StorageError>({
          kind: "storage-error",
          message: `${appId}: ${oauthErr.code}`,
        });
      }
      newTokens = refreshResult.value;
    } catch (e) {
      // CR-02: an unexpected throw is transient, not terminal — retryable storage-error.
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }

    // Step 4: Persist the rotated tokens (upsert)
    const now = new Date();
    const rotatedRow: SchwabTokenRow = {
      appId,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      issuedAt: now,
      // Refresh token TTL clock: preserve the ORIGINAL refreshIssuedAt so the
      // 7-day hard window is anchored to when the refresh token was FIRST issued.
      // Only re-auth (authorization_code grant) resets the 7-day clock.
      refreshIssuedAt: currentTokens.refreshIssuedAt,
      expiresAt: new Date(now.getTime() + newTokens.expiresIn * 1000),
      // Preserve the existing error state — writeTokens is not responsible for
      // clearing lastRefreshError; recordRefreshOutcome owns that (D-14, JOB-02).
      lastRefreshError: currentTokens.lastRefreshError,
    };

    try {
      const writeResult = await deps.writeTokens(appId, rotatedRow);
      if (!writeResult.ok) {
        return err<StorageError>(writeResult.error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }

    return ok(newTokens);
  };
}
