import { useState } from "react";
import { useAuthSession } from "./hooks/useAuthSession.ts";
import { Login } from "./screens/Login.tsx";
import { Shell } from "./components/Shell.tsx";
import type { ScreenName } from "./components/Shell.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

import { Overview } from "./screens/Overview.tsx";
import { Analyzer } from "./screens/Analyzer.tsx";
import { JournalContainer } from "./screens/JournalContainer.tsx";

/**
 * App — the auth gate component.
 *
 * Three states (from useAuthSession):
 *   - `undefined` (loading): blank splash — show nothing while checking localStorage
 *   - `null` (no session): render <Login>
 *   - Session (authenticated): render <Shell> (controlled) with the three nav screens
 *     (Overview composes Positions + Market; Analyzer; Journal)
 *
 * Nav + the Overview→Journal deep-link are lifted here: the open-calendar glance strip on
 * Overview switches to the Journal tab and pre-selects the clicked calendar via `openJournal`.
 *
 * Security (T-09-03): client-side gate is defense-in-depth only.
 * Phase 8 server enforces 401 on every read endpoint — bypassing the SPA gate yields no data.
 *
 * Each screen is wrapped in an <ErrorBoundary> so a crash in one screen never blanks the app.
 */
export function App(): React.ReactElement | null {
  const session = useAuthSession();

  // Nav state + the calendar a deep-link targets. Lifted above the shell so Overview can
  // drive it; Shell runs in controlled mode (activeScreen + onNavigate).
  const [screen, setScreen] = useState<ScreenName>("Overview");
  const [journalCalendarId, setJournalCalendarId] = useState<string | undefined>(undefined);

  // Loading splash — undefined means getSession() is still in flight
  if (session === undefined) {
    return null;
  }

  // No session — render Login screen
  if (session === null) {
    return <Login />;
  }

  const openJournal = (calendarId: string): void => {
    setJournalCalendarId(calendarId);
    setScreen("Journal");
  };

  const screens: Record<ScreenName, React.ReactNode> = {
    Overview: (
      <ErrorBoundary>
        <Overview onOpenJournal={openJournal} />
      </ErrorBoundary>
    ),
    Analyzer: (
      <ErrorBoundary>
        <Analyzer />
      </ErrorBoundary>
    ),
    Journal: (
      <ErrorBoundary>
        <JournalContainer initialCalendarId={journalCalendarId} />
      </ErrorBoundary>
    ),
  };

  // Authenticated — render full Shell with nav + market strip + content area
  // AuthExpiredBanner is mounted inside Shell (polls /api/status automatically)
  return (
    <div data-testid="app-shell">
      <Shell activeScreen={screen} onNavigate={setScreen}>
        {screens[screen]}
      </Shell>
    </div>
  );
}
