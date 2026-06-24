import { useStatus } from "../hooks/useStatus.ts";

/**
 * AuthExpiredBanner — UI-02: fixed bottom banner when Schwab auth has expired.
 *
 * Renders on all authenticated screens when GET /api/status returns
 * tokenFreshness.trader.status === "AUTH_EXPIRED".
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
 */
export function AuthExpiredBanner() {
  const { data } = useStatus();

  // Determine if AUTH_EXPIRED is active on the trader app.
  // tokenFreshness is either "none yet" (string) or a {trader, market} map.
  // Only render when we have the map AND trader.status is AUTH_EXPIRED.
  const isExpired =
    data !== undefined &&
    data.tokenFreshness !== "none yet" &&
    data.tokenFreshness.trader.status === "AUTH_EXPIRED";

  if (!isExpired) {
    return null;
  }

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
