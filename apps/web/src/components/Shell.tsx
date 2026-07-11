import { useState } from "react";
import { cn } from "@/lib/utils";
import { AuthExpiredBanner } from "./AuthExpiredBanner.tsx";
import { RuleSettingsModal } from "../screens/RuleSettingsModal.tsx";

// ─── Screen registry ─────────────────────────────────────────────────────────

/**
 * ScreenName — the three nav tab identifiers. Positions + Market fold into Overview
 * (Overview composes both), so the home tab carries the book + market structure.
 */
export type ScreenName = "Overview" | "Analyzer" | "Journal";

const NAV_TABS: ReadonlyArray<ScreenName> = [
  "Overview",
  "Analyzer",
  "Journal",
] as const;

// ─── Shell ───────────────────────────────────────────────────────────────────

interface ShellProps {
  /** The content to render below the sticky header (the active screen). */
  children: React.ReactNode;
  /** The active screen name — if omitted, Shell manages its own state internally. */
  activeScreen?: ScreenName;
  /** Callback when a nav tab is clicked — if omitted, Shell manages its own state. */
  onNavigate?: (screen: ScreenName) => void;
}

/**
 * Shell — the top-level layout shell for the authenticated Morai dashboard.
 *
 *   - Sticky frosted-glass header (~48px) with the MORAI brand logotype and three
 *     locked nav tabs (Overview · Analyzer · Journal). Market metrics live ONLY in
 *     the Overview pill header — a second renderer here drifted in rounding/format
 *     and read as inaccurate (one source of truth).
 *   - The active screen in its content area (via `children` or internal switcher).
 *   - The fixed-bottom <AuthExpiredBanner> (always mounted when authenticated).
 *
 * Styling is design-system only (tokens + Tailwind), no inline color/font.
 */
export function Shell({
  children,
  activeScreen,
  onNavigate,
}: ShellProps): React.ReactElement {
  const [internalScreen, setInternalScreen] = useState<ScreenName>("Overview");

  const currentScreen = activeScreen ?? internalScreen;
  const handleNavigate = onNavigate ?? setInternalScreen;

  return (
    <>
      {/* Sticky frosted-glass header */}
      <header className="sticky top-0 right-0 left-0 z-50 box-border flex h-12 items-center justify-between border-b border-line bg-gradient-to-b from-raise/55 to-transparent px-4 backdrop-blur-md">
        {/* Left: Brand logotype + Nav tabs */}
        <div className="flex items-center gap-6">
          {/* MOR-AI logotype (violet "AI") */}
          <div className="shrink-0 font-display text-base font-bold tracking-[-0.01em] text-txt select-none">
            MOR<strong className="text-violet">AI</strong>
          </div>

          {/* Nav tabs — locked order: Overview · Analyzer · Journal */}
          <nav
            role="tablist"
            aria-label="Dashboard navigation"
            className="flex items-center gap-0.5"
          >
            {NAV_TABS.map((tab) => {
              const isActive = tab === currentScreen;
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    handleNavigate(tab);
                  }}
                  className={cn(
                    "min-h-11 min-w-11 lg:min-h-8 cursor-pointer rounded-md border-b-2 px-3 py-1.5 font-display text-[10px] font-semibold tracking-[0.09em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet",
                    isActive
                      ? "border-violet bg-violet/10 text-violet"
                      : "border-transparent text-dim hover:text-txt",
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: settings gear (Phase 29-14) */}
        <RuleSettingsModal />
      </header>

      {/* Active screen content area */}
      <main className="min-h-[calc(100vh-48px)] min-h-[calc(100dvh-48px)]">{children}</main>

      {/* AUTH_EXPIRED banner — always mounted when authenticated, self-shows/hides */}
      <AuthExpiredBanner />
    </>
  );
}

// ─── ShellWithRouter ─────────────────────────────────────────────────────────

/**
 * ShellWithRouter — wraps Shell with its own internal screen state and renders
 * the active screen from the provided `screens` map.
 */
interface ShellWithRouterProps {
  screens: Record<ScreenName, React.ReactNode>;
}

export function ShellWithRouter({
  screens,
}: ShellWithRouterProps): React.ReactElement {
  const [activeScreen, setActiveScreen] = useState<ScreenName>("Overview");

  return (
    <Shell activeScreen={activeScreen} onNavigate={setActiveScreen}>
      {screens[activeScreen]}
    </Shell>
  );
}
