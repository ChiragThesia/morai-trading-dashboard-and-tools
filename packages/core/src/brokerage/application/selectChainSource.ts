import type { ForFetchingChain } from "../../journal/application/ports.ts";
import type { ForReadingTokenFreshness } from "./ports.ts";

/**
 * selectChainSource — Schwab-primary / CBOE-fallback chain fetcher selector.
 *
 * Implements D-07 (Schwab primary) and D-08 (CBOE fallback on AUTH_EXPIRED):
 *   - market status "fresh" or "stale" → return schwabFetchChain
 *   - market status "AUTH_EXPIRED" or "none_yet" → return cboeFetchChain
 *   - readTokenFreshness returns "none yet" (string) → return cboeFetchChain (safe default)
 *   - readTokenFreshness returns err → return cboeFetchChain (safe default; journal never stalls)
 *
 * Pure-ish application logic: no I/O except via the injected ports.
 *
 * @param deps.readTokenFreshness - Driven port; returns per-app freshness map
 * @param deps.schwabFetchChain   - Schwab chain fetcher (primary when market is fresh/stale)
 * @param deps.cboeFetchChain     - CBOE chain fetcher (fallback; no-auth, always available)
 * @returns ForFetchingChain — the appropriate implementation for this call context
 */
export async function selectChainSource(deps: {
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly schwabFetchChain: ForFetchingChain;
  readonly cboeFetchChain: ForFetchingChain;
}): Promise<ForFetchingChain> {
  let freshnessResult: Awaited<ReturnType<ForReadingTokenFreshness>>;

  try {
    freshnessResult = await deps.readTokenFreshness();
  } catch {
    // readTokenFreshness threw — safe default is CBOE (journal never stalls)
    return deps.cboeFetchChain;
  }

  if (!freshnessResult.ok) {
    // Storage error reading freshness — fall back to CBOE
    return deps.cboeFetchChain;
  }

  const freshness = freshnessResult.value;

  // "none yet" string = no tokens set up for either app → CBOE fallback
  if (freshness === "none yet") {
    return deps.cboeFetchChain;
  }

  // Per-app market status determines which chain source to use
  const marketStatus = freshness.market.status;

  // Schwab primary: use Schwab when market token is fresh or stale (D-07)
  if (marketStatus === "fresh" || marketStatus === "stale") {
    return deps.schwabFetchChain;
  }

  // CBOE fallback: AUTH_EXPIRED or none_yet → CBOE (D-08)
  // AUTH_EXPIRED: market token expired; new snapshots would fail → fall back
  // none_yet: market not yet set up for this app → safe default
  return deps.cboeFetchChain;
}
