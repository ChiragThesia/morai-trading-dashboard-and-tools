import type { ForFetchingChain } from "../../journal/application/ports.ts";
import type { ForReadingTokenFreshness } from "./ports.ts";

/**
 * selectChainSources — the list of chain fetchers to run this cycle.
 *
 * chain-window-narrow-regression: Schwab alone is too narrow (the gateway caps the
 * response, so the sidecar requests a bounded strike/DTE window — far-OTM put mass
 * and long-dated position legs never arrive) and CBOE alone is delayed. A healthy
 * market token therefore means BOTH sources run every cycle:
 *   - market status "fresh" or "stale" → [schwabFetchChain, cboeFetchChain]
 *   - market status "AUTH_EXPIRED" or "none_yet" → [cboeFetchChain]
 *   - readTokenFreshness returns "none yet" (string) → [cboeFetchChain] (safe default)
 *   - readTokenFreshness returns err or throws → [cboeFetchChain] (journal never stalls)
 *
 * The old single-fetcher runtime fallback (chain-frozen-schwab-symbol BUG 3) is
 * subsumed: CBOE is always fetched, and the fetchChain use-case tolerates partial
 * failure — a Schwab call failure can no longer darken the pipeline.
 *
 * Pure-ish application logic: no I/O except via the injected ports.
 *
 * @param deps.readTokenFreshness - Driven port; returns per-app freshness map
 * @param deps.schwabFetchChain   - Schwab chain fetcher (freshness; runs when market token is healthy)
 * @param deps.cboeFetchChain     - CBOE chain fetcher (breadth; no-auth, runs every cycle)
 * @returns the fetchers to run this cycle, in [schwab?, cboe] order
 */
export async function selectChainSources(deps: {
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly schwabFetchChain: ForFetchingChain;
  readonly cboeFetchChain: ForFetchingChain;
}): Promise<ReadonlyArray<ForFetchingChain>> {
  let freshnessResult: Awaited<ReturnType<ForReadingTokenFreshness>>;

  try {
    freshnessResult = await deps.readTokenFreshness();
  } catch {
    // readTokenFreshness threw — safe default is CBOE only (journal never stalls)
    return [deps.cboeFetchChain];
  }

  if (!freshnessResult.ok) {
    // Storage error reading freshness — CBOE only
    return [deps.cboeFetchChain];
  }

  const freshness = freshnessResult.value;

  // "none yet" string = no tokens set up for either app → CBOE only
  if (freshness === "none yet") {
    return [deps.cboeFetchChain];
  }

  // Healthy market token (fresh or stale) → dual-source cycle.
  const marketStatus = freshness.market.status;
  if (marketStatus === "fresh" || marketStatus === "stale") {
    return [deps.schwabFetchChain, deps.cboeFetchChain];
  }

  // AUTH_EXPIRED or none_yet → CBOE only (D-08)
  return [deps.cboeFetchChain];
}
