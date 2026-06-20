/**
 * oauth-client.ts — Schwab OAuth 2.0 client (vendored, no SDK dependency).
 *
 * Implements authorization-code grant (exchangeCode) and refresh grant (refreshTokens).
 * Both use Basic auth: Authorization: Basic base64(appKey:appSecret).
 *
 * Security constraints (T-04-06, T-04-07):
 *   - Basic auth header value NEVER logged
 *   - Token values NEVER logged
 *   - Error body mapped to typed code; only kind/code/message surfaced
 *
 * Hexagonal rule: this file is an adapter — imports shared + zod only.
 * No process.env, no drizzle, no hono.
 */
import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * SchwabTokens — the parsed, camelCase token response from Schwab.
 * Exposes only the fields core logic needs (expiresIn in seconds).
 */
export type SchwabTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number; // seconds — 1800 for access tokens
};

/**
 * OAuthError — typed error returned (never thrown) from OAuth calls.
 *
 * code values:
 *   invalid_grant   — refresh token / auth code expired (treat as AUTH_EXPIRED)
 *   invalid_client  — wrong credentials or refresh token invalid (treat as AUTH_EXPIRED)
 *   network         — fetch threw (network unreachable, DNS failure)
 *   parse           — response body is not valid JSON or missing required fields
 */
export type OAuthError = {
  readonly kind: "oauth-error";
  readonly code: "invalid_grant" | "invalid_client" | "network" | "parse";
  readonly message: string;
};

/**
 * SchwabOAuthClient — the three-function surface exposed to adapters and use-cases.
 */
export type SchwabOAuthClient = {
  /** Build the Schwab authorization URL to redirect/open in the browser. */
  readonly buildAuthUrl: (state: string) => string;
  /** Exchange an authorization code (30s TTL) for a token pair. */
  readonly exchangeCode: (
    code: string,
  ) => Promise<Result<SchwabTokens, OAuthError>>;
  /** Refresh the access token using the stored refresh token. */
  readonly refreshTokens: (
    refreshToken: string,
  ) => Promise<Result<SchwabTokens, OAuthError>>;
};

// ─── Schwab token response Zod schema ─────────────────────────────────────────
// passthrough() avoids breaking on new Schwab response fields.
const SchwabTokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

// Error body schema — used for non-2xx responses.
const SchwabErrorBodySchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .passthrough();

// ─── Schwab API endpoints ──────────────────────────────────────────────────────
const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_AUTHORIZE_URL = "https://api.schwabapi.com/v1/oauth/authorize";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeSchwabOAuthClient — builds the OAuth client with injected config.
 *
 * @param config.appKey      Schwab app key (client ID)
 * @param config.appSecret   Schwab app secret (client secret)
 * @param config.callbackUrl Registered Schwab callback URL (must match exactly)
 * @param config.fetch       Injected fetch — never globalThis.fetch directly
 */
export function makeSchwabOAuthClient(config: {
  readonly appKey: string;
  readonly appSecret: string;
  readonly callbackUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): SchwabOAuthClient {
  // Precompute the Basic auth credential string once (T-04-06: never log this value)
  const basicAuthValue = `Basic ${Buffer.from(
    `${config.appKey}:${config.appSecret}`,
  ).toString("base64")}`;

  // ─── buildAuthUrl ──────────────────────────────────────────────────────────
  const buildAuthUrl = (state: string): string => {
    const params = new URLSearchParams({
      client_id: config.appKey,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      state,
    });
    return `${SCHWAB_AUTHORIZE_URL}?${params.toString()}`;
  };

  // ─── Internal helper: POST to token endpoint ───────────────────────────────
  async function postTokenRequest(
    body: URLSearchParams,
  ): Promise<Result<SchwabTokens, OAuthError>> {
    let rawBody: unknown;

    try {
      const response = await config.fetch(SCHWAB_TOKEN_URL, {
        method: "POST",
        headers: {
          // T-04-06: Basic auth is required for all token endpoint calls
          Authorization: basicAuthValue,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      let jsonBody: unknown;
      try {
        jsonBody = await response.json();
      } catch {
        return err<OAuthError>({
          kind: "oauth-error",
          code: "parse",
          message: "Failed to parse Schwab token response as JSON",
        });
      }

      // Non-2xx: parse error body to extract typed code (T-04-07: only code, never echo tokens)
      if (!response.ok) {
        const errParsed = SchwabErrorBodySchema.safeParse(jsonBody);
        if (errParsed.success) {
          const errorCode = errParsed.data.error;
          if (errorCode === "invalid_grant" || errorCode === "invalid_client") {
            return err<OAuthError>({
              kind: "oauth-error",
              code: errorCode,
              message: errParsed.data.error_description ?? errorCode,
            });
          }
        }
        return err<OAuthError>({
          kind: "oauth-error",
          code: "network",
          message: `Schwab token endpoint returned HTTP ${response.status}`,
        });
      }

      rawBody = jsonBody;
    } catch (e) {
      // Network-level error (DNS, ECONNREFUSED, etc.)
      const message = e instanceof Error ? e.message : String(e);
      return err<OAuthError>({
        kind: "oauth-error",
        code: "network",
        message,
      });
    }

    // Parse + map snake_case → camelCase
    const parsed = SchwabTokenResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return err<OAuthError>({
        kind: "oauth-error",
        code: "parse",
        message: `Schwab token parse error: ${parsed.error.message}`,
      });
    }

    const tokens: SchwabTokens = {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresIn: parsed.data.expires_in,
    };

    return ok(tokens);
  }

  // ─── exchangeCode ──────────────────────────────────────────────────────────
  const exchangeCode = (code: string): Promise<Result<SchwabTokens, OAuthError>> => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.callbackUrl,
    });
    return postTokenRequest(body);
  };

  // ─── refreshTokens ─────────────────────────────────────────────────────────
  const refreshTokens = (
    refreshToken: string,
  ): Promise<Result<SchwabTokens, OAuthError>> => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return postTokenRequest(body);
  };

  return { buildAuthUrl, exchangeCode, refreshTokens };
}
