import { useAuthSession } from "./hooks/useAuthSession.ts";
import { Login } from "./screens/Login.tsx";
import { ShellWithRouter } from "./components/Shell.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

import { Overview } from "./screens/Overview.tsx";
import { Analyzer } from "./screens/Analyzer.tsx";
import { Journal } from "./screens/Journal.tsx";

/**
 * App — the auth gate component.
 *
 * Three states (from useAuthSession):
 *   - `undefined` (loading): blank splash — show nothing while checking localStorage
 *   - `null` (no session): render <Login>
 *   - Session (authenticated): render <ShellWithRouter> with the three nav screens
 *     (Overview composes Positions + Market; Analyzer; Journal)
 *
 * Security (T-09-03): client-side gate is defense-in-depth only.
 * Phase 8 server enforces 401 on every read endpoint — bypassing the SPA gate yields no data.
 *
 * Each screen is wrapped in an <ErrorBoundary> so a crash in one screen never blanks the app.
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
          Overview: (
            <ErrorBoundary>
              <Overview />
            </ErrorBoundary>
          ),
          Analyzer: (
            <ErrorBoundary>
              <Analyzer />
            </ErrorBoundary>
          ),
          Journal: (
            <ErrorBoundary>
              <Journal />
            </ErrorBoundary>
          ),
        }}
      />
    </div>
  );
}
