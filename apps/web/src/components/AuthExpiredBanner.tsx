import { useStatus } from "../hooks/useStatus.ts";

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
 * - padding: 8px 16px
 * - text: body token (12px JetBrains Mono), color: #ef5350 (coral)
 * - `auth setup` in a <code> element: bg #3e1f23, padding 1px 4px, border-radius 3px
 * - NO dismiss button — banner persists until AUTH_EXPIRED clears
 *
 * Copy (locked by UI-SPEC copywriting contract):
 * "Schwab auth expired. Run `auth setup` to reconnect. Live data may be stale."
 *
 * Amber copy/styling (Claude's Discretion, CONTEXT.md D-03): follows the same
 * role="alert" + fixed-bottom + JetBrains Mono precedent with an amber palette,
 * distinct from the red tones above. References the operator re-auth runbook.
 */
export function AuthExpiredBanner() {
  const { data } = useStatus();

  // tokenFreshness is either "none yet" (string, pre-setup) or a {trader, market} map.
  if (data === undefined || data.tokenFreshness === "none yet") {
    return null;
  }

  const { trader, market } = data.tokenFreshness;

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
          padding: "8px 16px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: "12px",
          lineHeight: 1.45,
          color: "#ef5350",
        }}
      >
        Schwab auth expired. Run{" "}
        <code
          role="code"
          style={{
            fontFamily: "inherit",
            backgroundColor: "#3e1f23",
            padding: "1px 4px",
            borderRadius: "3px",
          }}
        >
          auth setup
        </code>{" "}
        to reconnect. Live data may be stale.
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
          padding: "8px 16px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: "12px",
          lineHeight: 1.45,
          color: "#ffb74d",
        }}
      >
        {isMarketExpired
          ? "Schwab market app auth expired — chain data fell back to CBOE. Re-auth per "
          : "Schwab auth expires soon. Re-auth within 24 hours to avoid an outage. See "}
        <code
          role="code"
          style={{
            fontFamily: "inherit",
            backgroundColor: "#3e2f0f",
            padding: "1px 4px",
            borderRadius: "3px",
          }}
        >
          docs/operations/schwab-reauth-runbook.md
        </code>
        .
      </div>
    );
  }

  return null;
}
