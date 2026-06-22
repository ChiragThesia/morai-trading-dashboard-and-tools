/**
 * refresh-tokens handler — refreshes both Schwab apps at 04:00 ET daily (JOB-02).
 *
 * No RTH gate — runs at 04:00 ET outside market hours by design (D-13, Pitfall 5).
 * No holiday gate — token refresh runs every day regardless of market calendar.
 *
 * Per-app isolation (D-13): handler NEVER throws on a per-app failure.
 * A failure is logged via console.warn (appId only — never token values) and
 * persisted via recordRefreshOutcome so GET /api/status surfaces it (D-14).
 * A recovery clears the flag (recordRefreshOutcome(appId, null)).
 */

import type { Job } from "pg-boss";
import type { RefreshTokensResult, ForRecordingRefreshOutcome } from "@morai/core";
import type { Result } from "@morai/shared";
import type { AppId } from "@morai/core";

export type RefreshTokensHandlerDeps = {
  readonly refreshTokensUseCase: () => Promise<Result<RefreshTokensResult, never>>;
  // D-14: per-app outcome writer — wires into the broker-tokens repo recordRefreshOutcome
  readonly recordRefreshOutcome?: ForRecordingRefreshOutcome;
  readonly now: () => Date;
};

export function makeRefreshTokensHandler(
  deps: RefreshTokensHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined (T-02-18 / Pitfall 2)
    if (job === undefined) return;

    // No RTH gate — runs at 04:00 ET outside market hours by design (D-13, Pitfall 5)
    // No holiday gate — token refresh must run daily regardless of NYSE calendar

    const result = await deps.refreshTokensUseCase();

    // The use-case always returns ok() — per-app outcomes are in result.value
    if (!result.ok) return; // defensive: never happens with Result<T, never>

    const { trader, market } = result.value;

    // Record per-app outcomes (D-14 flag — persisted for GET /api/status)
    // Non-null → failure persisted; null → success clears prior failure flag.
    // NEVER throw on recordRefreshOutcome failure — the flag is advisory (log only).
    if (deps.recordRefreshOutcome !== undefined) {
      void deps.recordRefreshOutcome(
        "trader",
        trader.ok ? null : (trader.error ?? "unknown error"),
      ).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`refresh-tokens: failed to record trader outcome: ${msg}`);
      });
      void deps.recordRefreshOutcome(
        "market",
        market.ok ? null : (market.error ?? "unknown error"),
      ).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`refresh-tokens: failed to record market outcome: ${msg}`);
      });
    }

    // Log per-app failures (appId only — NEVER token values, T-05-11)
    if (!trader.ok) {
      console.warn(`refresh-tokens: trader refresh failed — ${trader.error ?? "unknown error"} (re-auth may be needed)`);
    }
    if (!market.ok) {
      console.warn(`refresh-tokens: market refresh failed — ${market.error ?? "unknown error"} (re-auth may be needed)`);
    }

    // D-14: warn when refresh token is within the proactive 1-day expiry window
    if (trader.warnExpirySoon) {
      console.warn("refresh-tokens: trader refresh token is near expiry (≤1 day remaining) — re-auth required before next scheduled refresh");
    }
    if (market.warnExpirySoon) {
      console.warn("refresh-tokens: market refresh token is near expiry (≤1 day remaining) — re-auth required before next scheduled refresh");
    }
  };
}
