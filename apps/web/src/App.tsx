import { useAuthSession } from "./hooks/useAuthSession.ts";
import { Login } from "./screens/Login.tsx";
import { ShellWithRouter } from "./components/Shell.tsx";

// Screens — imported lazily here as placeholders; each plan (05-10) fills them in.
// Plan 05 provides Overview; Plans 06-10 fill in the remaining screens.
// The placeholder `<div>` for screens not yet built prevents empty renders.
import { Overview } from "./screens/Overview.tsx";
import { Market } from "./screens/Market.tsx";
import { Analyzer } from "./screens/Analyzer.tsx";

const COMING_SOON_SCREEN = (name: string): React.ReactNode => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      color: "#7b8696",
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      fontSize: "16px",
      fontWeight: 700,
    }}
  >
    {name} — coming in the next plan
  </div>
);

/**
 * App — the auth gate component.
 *
 * Three states (from useAuthSession):
 *   - `undefined` (loading): blank splash — show nothing while checking localStorage
 *   - `null` (no session): render <Login>
 *   - Session (authenticated): render <ShellWithRouter> with all five nav screens
 *
 * Security (T-09-03): client-side gate is defense-in-depth only.
 * Phase 8 server enforces 401 on every read endpoint — bypassing the SPA gate yields no data.
 */
export function App(): React.ReactElement | null {
  const session = useAuthSession();

  // Loading splash — undefined means getSession() is still in flight
  if (session === undefined) {
    return null;
  }

  // No session — render Login screen
  if (session === null) {
    return <Login />;
  }

  // Authenticated — render full Shell with nav + market strip + content area
  // AuthExpiredBanner is mounted inside Shell (polls /api/status automatically)
  return (
    <div data-testid="app-shell">
      <ShellWithRouter
        screens={{
          Overview: <Overview />,
          Analyzer: <Analyzer />,
          Positions: COMING_SOON_SCREEN("Positions"),
          Journal: COMING_SOON_SCREEN("Journal"),
          Market: <Market />,
        }}
      />
    </div>
  );
}
