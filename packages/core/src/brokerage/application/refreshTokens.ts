/**
 * refreshTokens.ts — refresh both Schwab apps independently (JOB-02, D-13/D-14).
 *
 * Uses Promise.allSettled so one app failing does not block the other (D-13).
 * After refresh, computes a proactive 7-day expiry warning per app (D-14).
 *
 * SIGNATURE ONLY — function body throws "not implemented".
 * Plan 05-05 provides the implementation.
 */

import type { Result } from "@morai/shared";
import type { ForRefreshingToken, ForReadingTokenFreshness } from "./ports.ts";

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
 * The returned function always resolves with ok(RefreshTokensResult) — it never rejects.
 * Per-app errors are captured in result.value.{trader,market}.ok = false.
 */
export function makeRefreshTokensUseCase(
  deps: RefreshTokensDeps,
): () => Promise<Result<RefreshTokensResult, never>> {
  return async (): Promise<Result<RefreshTokensResult, never>> => {
    throw new Error("not implemented");
  };
}
