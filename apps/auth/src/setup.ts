/**
 * setup.ts — `auth setup` loopback HTTPS OAuth dance (AUTH-03).
 *
 * validateAndExchange is the PURE security-critical decision function (TDD Task 2).
 * runSetup is the imperative shell (browser launch + loopback listener + persist).
 *
 * T-04-09: state CSRF check happens BEFORE any token exchange.
 * T-04-13: exchangeCode is called immediately after capture (30s TTL).
 * T-04-11: only appId + timestamps printed — never tokens or keys.
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  SchwabTokenRow,
  ForWritingTokens,
} from "@morai/core";
import type { SchwabTokens, OAuthError } from "@morai/adapters";
import { makeSchwabOAuthClient } from "@morai/adapters";
import type { AuthConfig } from "./config.ts";
import { getAuthCode } from "oauth-callback";
import open from "open";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The parsed loopback callback result (code + state from the redirect). */
export type CallbackResult = {
  readonly code: string;
  readonly state: string;
};

/**
 * AuthError — the typed error union for validateAndExchange.
 * state-mismatch: CSRF defense (state param did not match expectedState)
 * exchange-failure: exchangeCode returned an OAuthError
 */
export type AuthError =
  | { readonly kind: "state-mismatch" }
  | { readonly kind: "exchange-failure"; readonly cause: OAuthError };

/** OAuthClient surface needed by validateAndExchange (only exchangeCode). */
export type OAuthClientPort = {
  readonly exchangeCode: (
    code: string,
  ) => Promise<Result<SchwabTokens, OAuthError>>;
};

// ─── validateAndExchange (pure, TDD-tested) ───────────────────────────────────

/**
 * validateAndExchange — PURE function: CSRF state check + code exchange.
 *
 * Security invariants (T-04-09, T-04-13):
 *   1. State mismatch → return err({kind:"state-mismatch"}) AND client.exchangeCode
 *      is NEVER called (ordering guarantee).
 *   2. State match → call client.exchangeCode(result.code) exactly once.
 *   3. Exchange failure → return err({kind:"exchange-failure"}).
 *   4. Exchange success → return ok(tokens).
 *
 * No I/O: no browser, no loopback, no DB.
 */
export async function validateAndExchange(
  result: CallbackResult,
  expectedState: string,
  client: OAuthClientPort,
): Promise<Result<SchwabTokens, AuthError>> {
  // T-04-09: CSRF defense — check state BEFORE any exchange attempt
  if (result.state !== expectedState) {
    return err<AuthError>({ kind: "state-mismatch" });
  }

  // T-04-13: exchange immediately (30s TTL honored by immediate call)
  const exchangeResult = await client.exchangeCode(result.code);
  if (!exchangeResult.ok) {
    return err<AuthError>({
      kind: "exchange-failure",
      cause: exchangeResult.error,
    });
  }

  return ok(exchangeResult.value);
}

// ─── runSetup (imperative shell) ─────────────────────────────────────────────

/**
 * runSetup — drives the full loopback HTTPS OAuth dance for one app.
 *
 * 1. Build the OAuth client for the selected app.
 * 2. Generate a cryptographic state param (CSRF — Don't Hand-Roll).
 * 3. Build the authorization URL.
 * 4. Derive the listener port from the registered callback URL.
 * 5. Open the browser and capture the callback via oauth-callback.
 * 6. Pass the result + expectedState + client into validateAndExchange (pure).
 * 7. On ok: build a SchwabTokenRow and write to repo.
 * 8. Print success with appId + timestamps only — never the tokens (T-04-11).
 */
export async function runSetup(
  config: AuthConfig,
  repo: {
    readonly writeTokens: ForWritingTokens;
  },
  appId: AppId,
): Promise<void> {
  // Select the config for the chosen app
  const appConfig =
    appId === "trader"
      ? {
          appKey: config.SCHWAB_TRADER_APP_KEY,
          appSecret: config.SCHWAB_TRADER_APP_SECRET,
          callbackUrl: config.SCHWAB_TRADER_CALLBACK_URL,
        }
      : {
          appKey: config.SCHWAB_MARKET_APP_KEY,
          appSecret: config.SCHWAB_MARKET_APP_SECRET,
          callbackUrl: config.SCHWAB_MARKET_CALLBACK_URL,
        };

  const client = makeSchwabOAuthClient({
    ...appConfig,
    fetch: globalThis.fetch,
  });

  // Generate CSRF state (crypto.randomUUID — Don't Hand-Roll, RESEARCH §Don't Hand-Roll)
  const state = crypto.randomUUID();

  // Build the Schwab authorization URL
  const authUrl = client.buildAuthUrl(state);

  // Derive the listener port from the registered callback URL (Open Question 1 resolved)
  const callbackUrl = new URL(appConfig.callbackUrl);
  const portStr = callbackUrl.port;
  if (portStr === "") {
    console.error(
      `[setup] SCHWAB_${appId.toUpperCase()}_CALLBACK_URL has no port — cannot bind loopback listener. ` +
        "Register a callback URL with an explicit port (e.g. https://127.0.0.1:8182).",
    );
    process.exit(1);
  }
  const port = parseInt(portStr, 10);

  console.warn(`[setup] Opening browser for ${appId} app OAuth flow...`);
  console.warn(`[setup] Listening on ${appConfig.callbackUrl} for callback`);

  // oauth-callback: opens browser + captures the redirect (Loopback OAuth Capture Pattern)
  // The library returns CallbackResult with optional code/state — guard both before use.
  let rawCode: string;
  let rawState: string;
  try {
    const captured = await getAuthCode({
      authorizationUrl: authUrl,
      launch: (url: string) => open(url),
      port,
      hostname: "127.0.0.1",
      timeout: 120_000,
    });
    // Guard: code must be present
    if (captured.code === undefined || captured.code === "") {
      console.error("[setup] OAuth callback did not include an authorization code");
      process.exit(1);
    }
    rawCode = captured.code;
    rawState = captured.state ?? "";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[setup] Failed to capture OAuth callback: ${message}`);
    process.exit(1);
  }

  const capturedResult: CallbackResult = { code: rawCode, state: rawState };

  // Validate state + exchange code (pure function, T-04-09/T-04-13)
  const exchangeResult = await validateAndExchange(capturedResult, state, client);
  if (!exchangeResult.ok) {
    const authErr = exchangeResult.error;
    if (authErr.kind === "state-mismatch") {
      console.error("[setup] CSRF error: state mismatch — possible replay attack. Aborting.");
    } else {
      console.error(
        `[setup] Token exchange failed (${authErr.cause.code}): ${authErr.cause.message}`,
      );
    }
    process.exit(1);
  }

  const tokens = exchangeResult.value;
  const now = new Date();
  const tokenRow: SchwabTokenRow = {
    appId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    issuedAt: now,
    refreshIssuedAt: now, // Fresh auth-code exchange resets the 7-day refresh TTL clock
    expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
  };

  const writeResult = await repo.writeTokens(appId, tokenRow);
  if (!writeResult.ok) {
    console.error(
      `[setup] Failed to persist tokens for ${appId}: ${writeResult.error.message}`,
    );
    process.exit(1);
  }

  // T-04-11: print only appId + timestamps — never the tokens
  console.warn(`[setup] ${appId} authenticated successfully`);
  console.warn(`[setup]   issuedAt:        ${tokenRow.issuedAt.toISOString()}`);
  console.warn(`[setup]   expiresAt:       ${tokenRow.expiresAt.toISOString()}`);
  console.warn(`[setup]   refreshIssuedAt: ${tokenRow.refreshIssuedAt.toISOString()}`);
}
