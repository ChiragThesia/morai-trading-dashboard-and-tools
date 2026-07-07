import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningFetchChain } from "@morai/core";
import type { ForReadingTokenFreshness } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

// FetchSchwabChainHandlerDeps — extends the CBOE chain handler shape with:
//  - readTokenFreshness: optional; used to detect and log AUTH_EXPIRED fallback (T-04-26)
//  - logAuthExpiredFallback: optional; when true, checks freshness before calling use-case
//    and logs the documented warning if market is AUTH_EXPIRED (D-08, T-04-26)
//
// The fetchChainUseCase is pre-wired via selectChainSources in the worker composition root
// (main.ts), so the handler itself stays thin (architecture-boundaries.md §3):
//   market fresh/stale → [schwabFetchChain, cboeFetchChain] (dual-source)
//   market AUTH_EXPIRED/none_yet/err → [cboeFetchChain] (D-08)
// The handler only calls readTokenFreshness to emit the operator-visible warning (T-04-26).

type FetchSchwabChainHandlerDeps = {
  /** The wired fetchChain use-case (composition root provides this via selectChainSources). */
  readonly fetchChainUseCase: ForRunningFetchChain;
  /** pg-boss instance — used only to enqueue compute on success (D-07). */
  readonly boss: BossForChainHandler;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
  /**
   * Optional — when present, used to detect and log AUTH_EXPIRED fallback warning (T-04-26).
   * The composition root should inject brokerTokensRepo.readTokenFreshness here.
   */
  readonly readTokenFreshness?: ForReadingTokenFreshness;
  /**
   * Optional — when true, freshness is checked before calling the use-case and a warning
   * is emitted if the market app is AUTH_EXPIRED (D-08, T-04-26).
   * Defaults to false for backward compat / tests that don't inject readTokenFreshness.
   */
  readonly logAuthExpiredFallback?: boolean;
};

/**
 * makeFetchSchwabChainHandler — Schwab-primary chain job handler with CBOE fallback logging.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH self-check → AUTH_EXPIRED warning check → call use-case → boss.send.
 *
 * Chain selection (D-07/D-08) is handled in the composition root (main.ts) by building
 * the fetchChainUseCase via selectChainSources:
 *   market fresh/stale → [schwabFetchChain, cboeFetchChain] (dual-source cycle)
 *   market AUTH_EXPIRED/none_yet/err → [cboeFetchChain] (CBOE only)
 *
 * This handler adds T-04-26 logging: when readTokenFreshness + logAuthExpiredFallback are
 * provided, it checks freshness before calling the use-case and emits the documented
 * operator-visible warning when market is AUTH_EXPIRED.
 *
 * D-06: RTH self-check (same as fetch-cboe-chain).
 * D-07: On success, enqueue compute-bsm-greeks with singletonKey.
 * D-09: market AUTH_EXPIRED → CBOE path continues; use-case still called, journal alive.
 * T-02-18 / Pitfall 2: array-guard prevents undefined job.
 * T-04-26: Fallback warning names the app + reason for operator visibility.
 */
export function makeFetchSchwabChainHandler(
  deps: FetchSchwabChainHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // D-06 / CAL-05: RTH + NYSE holiday self-check — no-op outside market hours or on holidays
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("fetch-schwab-chain: skipping — outside RTH or NYSE holiday");
      return;
    }

    // T-04-26: Emit operator-visible warning when market is AUTH_EXPIRED (D-08, D-09).
    // The use-case (pre-wired via selectChainSources) will still be called — it runs
    // CBOE-only transparently. The warning tells the operator why Schwab is paused.
    if (deps.logAuthExpiredFallback === true && deps.readTokenFreshness !== undefined) {
      try {
        const freshnessResult = await deps.readTokenFreshness();
        if (freshnessResult.ok) {
          const freshness = freshnessResult.value;
          if (
            freshness !== "none yet" &&
            freshness.market.status === "AUTH_EXPIRED"
          ) {
            console.warn(
              "fetch-schwab-chain: market AUTH_EXPIRED — falling back to CBOE (D-08); re-auth required",
            );
          }
        }
      } catch {
        // absorb — do not block the use-case call on a failed freshness read
      }
    }

    const result = await deps.fetchChainUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }

    // D-07: enqueue compute-bsm-greeks on success; singletonKey prevents duplicate enqueues
    // void: pg-boss send is fire-and-forget here; failure does not fail the chain job (WR-02)
    void deps.boss.send("compute-bsm-greeks", {}, {
      singletonKey: "triggered-by-chain",
    }).catch((e: unknown) => {
      console.warn("fetch-schwab-chain: failed to enqueue compute-bsm-greeks", e);
    });
  };
}
