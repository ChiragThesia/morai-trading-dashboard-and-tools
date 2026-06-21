/**
 * refreshTokens.ts — refresh both Schwab apps independently (JOB-02, D-13/D-14).
 *
 * Uses Promise.allSettled so one app failing does not block the other (D-13).
 * After refresh, computes a proactive 7-day expiry warning per app (D-14).
 *
 * Security rules (T-05-11):
 *   - NEVER log accessToken, refreshToken, or TOKEN_ENCRYPTION_KEY values
 *   - Error strings include only appId and reason text — never token values
 *   - The result always returns ok() — per-app errors live in result.value
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForRefreshingToken, ForReadingTokenFreshness } from "./ports.ts";
import { isNearExpiry } from "../domain/token-freshness.ts";

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * AppRefreshOutcome — per-app result from a refresh attempt.
 *
 * ok = true  → token refreshed successfully
 * ok = false → error contains the failure reason (error message, NOT the token)
 * warnExpirySoon → refresh token is within 1 day of its 7-day hard expiry (D-14)
 */
export type AppRefreshOutcome = {
  readonly ok: boolean;
  readonly error?: string; // error message only, never the token value
  readonly warnExpirySoon: boolean;
};

/**
 * RefreshTokensResult — combined outcome for both Schwab apps.
 * The use-case always returns ok(result) — per-app failures are surfaced in result.value.
 */
export type RefreshTokensResult = {
  readonly trader: AppRefreshOutcome;
  readonly market: AppRefreshOutcome;
};

// ─── Deps type ────────────────────────────────────────────────────────────────

export type RefreshTokensDeps = {
  /** Per-app token refresh (calls Schwab OAuth refresh endpoint) */
  readonly refreshTraderToken: ForRefreshingToken;
  readonly refreshMarketToken: ForRefreshingToken;
  /** Read freshness for both apps — used to compute proactive expiry warning (D-14) */
  readonly readTokenFreshness: ForReadingTokenFreshness;
  /** Injectable clock for testability */
  readonly now: () => Date;
};

// ─── Use-case factory ─────────────────────────────────────────────────────────

/**
 * makeRefreshTokensUseCase — factory returning a use-case that refreshes both apps.
 *
 * Both apps are refreshed via Promise.allSettled — one failure NEVER blocks the other (D-13).
 * The returned function always resolves with ok(RefreshTokensResult) — it never rejects.
 * Per-app errors are captured in result.value.{trader,market}.ok = false.
 */
export function makeRefreshTokensUseCase(
  deps: RefreshTokensDeps,
): () => Promise<Result<RefreshTokensResult, never>> {
  return async (): Promise<Result<RefreshTokensResult, never>> => {
    const now = deps.now();

    // D-13 / T-05-12: Promise.allSettled guarantees both apps are attempted regardless
    // of the other's outcome. NEVER use sequential awaits that short-circuit on the first failure.
    const [traderSettled, marketSettled] = await Promise.allSettled([
      deps.refreshTraderToken("trader"),
      deps.refreshMarketToken("market"),
    ]);

    // Read freshness for proactive expiry warning (D-14).
    // If freshness read fails, default to no warning (do not block the result).
    let traderRefreshIssuedAt: Date | null = null;
    let marketRefreshIssuedAt: Date | null = null;
    try {
      const freshnessResult = await deps.readTokenFreshness();
      if (freshnessResult.ok && freshnessResult.value !== "none yet") {
        traderRefreshIssuedAt = freshnessResult.value.trader.refreshIssuedAt;
        marketRefreshIssuedAt = freshnessResult.value.market.refreshIssuedAt;
      }
    } catch {
      // absorb — expiry warning is advisory; do not block the refresh result
    }

    // Map settled results to per-app outcomes
    const traderOutcome: AppRefreshOutcome = mapSettledToOutcome(
      traderSettled,
      "trader",
      traderRefreshIssuedAt,
      now,
    );
    const marketOutcome: AppRefreshOutcome = mapSettledToOutcome(
      marketSettled,
      "market",
      marketRefreshIssuedAt,
      now,
    );

    return ok({ trader: traderOutcome, market: marketOutcome });
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapSettledToOutcome(
  settled: PromiseSettledResult<Result<unknown, { readonly kind: string; readonly appId?: string; readonly message?: string }>>,
  appId: string,
  refreshIssuedAt: Date | null,
  now: Date,
): AppRefreshOutcome {
  const warnExpirySoon =
    refreshIssuedAt !== null ? isNearExpiry(refreshIssuedAt, now) : false;

  if (settled.status === "fulfilled") {
    const result = settled.value;
    if (result.ok) {
      return { ok: true, warnExpirySoon };
    }
    // result.ok === false — extract error message; NEVER include token values (T-05-11)
    const error = result.error;
    const errorMsg = "message" in error && error.message
      ? `${appId}: ${error.message}`
      : `${appId}: ${error.kind}`;
    return { ok: false, error: errorMsg, warnExpirySoon };
  }

  // status === "rejected" — unexpected throw from the use-case
  const reason = settled.reason instanceof Error
    ? settled.reason.message
    : String(settled.reason);
  return { ok: false, error: `${appId}: ${reason}`, warnExpirySoon };
}
