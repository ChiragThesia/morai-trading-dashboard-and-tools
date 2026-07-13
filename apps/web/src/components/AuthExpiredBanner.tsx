import { useStatus } from "../hooks/useStatus.ts";
import type { ReauthApp } from "../hooks/useReauth.ts";
import { ReauthWizard } from "./ReauthWizard.tsx";

/**
 * AuthExpiredBanner — UI-02: fixed bottom banner when Schwab auth has expired.
 * AUTH-05: also renders an amber sibling banner inside the T-24h pre-expiry window.
 *
 * Renders on all authenticated screens based on GET /api/status tokenFreshness:
 * - RED when trader.status === "AUTH_EXPIRED" (red takes precedence).
 * - AMBER when trader is not AUTH_EXPIRED and either:
 *   - market.status === "AUTH_EXPIRED" (market-expiry copy — chain pulls have
 *     fallen back to CBOE; review WR-02), or
 *   - at least one app (trader OR market) has a non-null refreshExpiresIn
 *     (inside the T-24h warning window).
 * - Nothing otherwise.
 *
 * Residual gap (surgical-changes rule, 15-05 plan note): the red gate stays
 * trader-only, matching the pre-existing behavior — a market-only AUTH_EXPIRED
 * shows the amber banner (WR-02), not the red one. Extending red to both apps was
 * out of scope (not a one-or-two-line change without touching the locked red copy path).
 *
 * Visual spec (09-UI-SPEC.md AUTH_EXPIRED status banner section):
 * - position: fixed; bottom: 0; left: 0; right: 0; z-index: 100
 * - background: #180f10 (blood-dark)
 * - border-top: 1px solid #5a2b2e
 * - padding: 8px 16px (bottom padding clears the iOS home-indicator safe area via
 *   `max(8px, env(safe-area-inset-bottom))`, 35-UI-SPEC.md "Safe-area insets")
 * - text: body token (12px JetBrains Mono), color: #ef5350 (coral)
 * - NO separate dismiss button — banner persists until AUTH_EXPIRED clears; the
 *   Reconnect button (37-UI-SPEC.md) is the CTA, not a dismiss control
 *
 * Copy (locked by 37-UI-SPEC.md copywriting contract, supersedes the old CLI-runbook
 * copy — see docs/operations/schwab-reauth-runbook.md for the CLI fallback):
 * "Schwab auth expired. Live data may be stale." + Reconnect
 *
 * Amber copy/styling (Claude's Discretion, CONTEXT.md D-03): follows the same
 * role="alert" + fixed-bottom + JetBrains Mono precedent with an amber palette,
 * distinct from the red tones above, with the same Reconnect entry point.
 */
export function AuthExpiredBanner() {
  const { data } = useStatus();

  // tokenFreshness is either "none yet" (string, pre-setup) or a {trader, market} map.
  if (data === undefined || data.tokenFreshness === "none yet") {
    return null;
  }

  const { trader, market } = data.tokenFreshness;

  // WR-03: the live set of AUTH_EXPIRED apps, handed to the wizard so its initial step is seeded
  // from real freshness (never a stale sessionStorage completed-set alone).
  const expiredApps: ReadonlyArray<ReauthApp> = [
    ...(trader.status === "AUTH_EXPIRED" ? (["trader"] as const) : []),
    ...(market.status === "AUTH_EXPIRED" ? (["market"] as const) : []),
  ];

  // Red gate: trader-only, unchanged from the pre-existing behavior (see doc comment above).
  const isExpired = trader.status === "AUTH_EXPIRED";

  // Market-expired gate (review WR-02): a market-only expiry must not go silent —
  // the amber banner stays up with accurate copy (chain pulls have fallen back to CBOE).
  const isMarketExpired = !isExpired && market.status === "AUTH_EXPIRED";

  // Amber gate: BOTH apps considered (worst-case) — neither app AUTH_EXPIRED, and at
  // least one app's refreshExpiresIn is non-null (inside the T-24h warning window).
  const isNearExpiry =
    !isExpired &&
    !isMarketExpired &&
    (trader.refreshExpiresIn !== null || market.refreshExpiresIn !== null);

  if (isExpired) {
    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          backgroundColor: "#180f10",
          borderTop: "1px solid #5a2b2e",
          paddingTop: "8px",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: "12px",
          lineHeight: 1.45,
          color: "#ef5350",
        }}
      >
        Schwab auth expired. Live data may be stale.
        <ReauthWizard />
      </div>
    );
  }

  if (isMarketExpired || isNearExpiry) {
    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          backgroundColor: "#231a08",
          borderTop: "1px solid #5a4a1f",
          paddingTop: "8px",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: "12px",
          lineHeight: 1.45,
          color: "#ffb74d",
        }}
      >
        {isMarketExpired
          ? "Schwab market app auth expired — chain data fell back to CBOE."
          : "Schwab auth expires soon. Reconnect within 24 hours to avoid an outage."}
        <ReauthWizard />
      </div>
    );
  }

  return null;
}
