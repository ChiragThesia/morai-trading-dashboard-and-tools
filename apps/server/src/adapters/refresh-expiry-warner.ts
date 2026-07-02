/**
 * refresh-expiry-warner.ts — AUTH-05 T-24h warning-log decorator.
 *
 * Wraps the ForGettingStatus port with a passive, in-process per-app latch:
 * logs exactly once when an app's refreshExpiresIn transitions null ->
 * non-null (crosses the T-24h window), and re-arms once it returns to null
 * (a later re-approach after a re-auth warns again). Wired once in the
 * composition root (main.ts) so both the HTTP status route and the MCP
 * get_status tool inherit the same warning without duplicating the log call
 * (RESEARCH Anti-Pattern: do not duplicate the T-24h threshold log into both
 * status.routes.ts and the MCP tool).
 *
 * Logs ONLY appId + seconds-remaining — never token/refresh-secret material
 * (precedent: broker-tokens.ts / seed_token.py log appId + timestamps only).
 * The warn call is guarded so a throwing sink can never break the status
 * response (T-15-11 — the decorator is a pure passthrough plus a side effect).
 */
import type { ForGettingStatus, AppId } from "@morai/core";

export function withRefreshExpiryWarning(
  getStatus: ForGettingStatus,
  deps?: { readonly warn?: (msg: string) => void },
): ForGettingStatus {
  const warn = deps?.warn ?? console.warn;
  const warned = new Map<AppId, boolean>();

  return async () => {
    const result = await getStatus();
    if (result.ok) {
      const tf = result.value.tokenFreshness;
      if (tf !== "none yet") {
        latchAndWarn("trader", tf.trader.refreshExpiresIn, warned, warn);
        latchAndWarn("market", tf.market.refreshExpiresIn, warned, warn);
      }
    }
    return result;
  };
}

function latchAndWarn(
  appId: AppId,
  refreshExpiresIn: number | null,
  warned: Map<AppId, boolean>,
  warn: (msg: string) => void,
): void {
  if (refreshExpiresIn === null) {
    // Re-arm: the app has moved back outside the T-24h window (e.g. re-auth).
    warned.set(appId, false);
    return;
  }
  if (warned.get(appId) === true) {
    return;
  }
  warned.set(appId, true);
  try {
    // 0 means the 7-day cutoff has already passed — "0s remaining ... before
    // expiry" would mislead an operator grepping logs during an outage.
    warn(
      refreshExpiresIn === 0
        ? `Schwab app "${appId}" refresh token EXPIRED — 7-day re-auth cutoff passed, re-auth now`
        : `Schwab app "${appId}" nearing 7-day re-auth cutoff — ${refreshExpiresIn}s remaining, re-auth required before expiry`,
    );
  } catch {
    // guarded: a throwing warn sink must never break the status response.
  }
}
