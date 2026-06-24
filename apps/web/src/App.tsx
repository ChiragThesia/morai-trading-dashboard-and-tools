import { useAuthSession } from "./hooks/useAuthSession.ts";
import { Login } from "./screens/Login.tsx";
import { AuthExpiredBanner } from "./components/AuthExpiredBanner.tsx";

/**
 * App — the auth gate component.
 *
 * Three states (from useAuthSession):
 *   - `undefined` (loading): blank splash — show nothing while checking localStorage
 *   - `null` (no session): render <Login>
 *   - Session (authenticated): render the app shell + <AuthExpiredBanner>
 *
 * The authenticated shell placeholder will be replaced by the real Shell component
 * in Plan 05 (layout shell + sticky header + market strip + routing).
 *
 * Security (T-09-03): client-side gate is defense-in-depth only.
 * Phase 8 server enforces 401 on every read endpoint — bypassing the SPA gate yields no data.
 */
export function App() {
  const session = useAuthSession();

  // Loading splash — undefined means getSession() is still in flight
  if (session === undefined) {
    return null;
  }

  // No session — render Login screen
  if (session === null) {
    return <Login />;
  }

  // Authenticated — render app shell (Plan 05 will replace this placeholder)
  // AuthExpiredBanner is always mounted in the authenticated view (polls /api/status)
  return (
    <>
      <div
        data-testid="app-shell"
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10,14,20,0) 58%), #0a0e14",
          color: "#d6dbe4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: "16px",
          fontWeight: 700,
        }}
      >
        {/* Placeholder: real Shell with nav, market strip, and routing lands in Plan 05 */}
        MOR<strong style={{ color: "#a78bfa" }}>AI</strong>
      </div>
      <AuthExpiredBanner />
    </>
  );
}
