import { useState } from "react";
import { useGex } from "../hooks/useGex.ts";
import { usePositions } from "../hooks/usePositions.ts";
import { bookUnrealizedPnl } from "../lib/pair-calendars.ts";
import { MetricChip } from "./system/index.tsx";
import { cn } from "@/lib/utils";
import { AuthExpiredBanner } from "./AuthExpiredBanner.tsx";

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

// ─── Compact number formatting ────────────────────────────────────────────────

/** Formats a numeric value with optional sign prefix and compact suffixes ($1.2M etc.) */
function fmtCompact(value: number, prefix = ""): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  const p = prefix;
  if (abs >= 1_000_000_000) {
    return `${sign}${p}${(abs / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${p}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${p}${(abs / 1_000).toFixed(1)}k`;
  }
  return `${sign}${p}${abs.toFixed(0)}`;
}

/** Formats a spot price without sign (SPX level — always positive) */
function fmtSpot(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Formats gamma flip / netGamma values to 2 decimal places */
function fmtGamma(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(value).toFixed(2)}B`;
}

/** Tailwind sign-color class for a signed value (null → muted). */
function signClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value >= 0 ? "text-up" : "text-down";
}

// ─── MarketStrip ─────────────────────────────────────────────────────────────

function MarketStrip(): React.ReactElement {
  const { data: gex } = useGex();
  const { data: positions } = usePositions();

  // Book P&L: total unrealized P&L across the book (Σ legUnreal). NOT marketValue·netQty
  // — that flips short signs and sums notional magnitude (the bug this replaces).
  const bookPnl = positions ? bookUnrealizedPnl(positions.positions) : null;

  const isNegativeGamma = gex !== undefined && gex.netGammaAtSpot < 0;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <MetricChip
        label="SPX"
        value={gex !== undefined ? fmtSpot(gex.spot) : "—"}
        valueClassName="text-blue"
      />
      <MetricChip
        label="net γ /1%"
        value={gex !== undefined ? fmtGamma(gex.netGammaAtSpot) : "—"}
        alert={isNegativeGamma}
        valueClassName={
          gex !== undefined
            ? gex.netGammaAtSpot >= 0
              ? "text-up"
              : "text-down"
            : "text-muted-foreground"
        }
      />
      <MetricChip
        label="γ flip"
        value={gex !== undefined && gex.flip !== null ? fmtSpot(gex.flip) : "—"}
        valueClassName="text-amber"
      />
      <MetricChip
        label="book P&L"
        value={bookPnl !== null ? fmtCompact(bookPnl, "$") : "—"}
        valueClassName={signClass(bookPnl)}
      />
    </div>
  );
}

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
 *   - Sticky frosted-glass header (~48px) with the MORAI brand logotype, three
 *     locked nav tabs (Overview · Analyzer · Journal), and a right-aligned live
 *     market strip (SPX spot, net γ /1%, γ flip, book P&L).
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
                    "min-h-8 min-w-11 cursor-pointer rounded-md border-b-2 px-3 py-1.5 font-display text-[10px] font-semibold tracking-[0.09em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet",
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

        {/* Right: Live market strip */}
        <MarketStrip />
      </header>

      {/* Active screen content area */}
      <main className="min-h-[calc(100vh-48px)]">{children}</main>

      {/* AUTH_EXPIRED banner — always mounted when authenticated, self-shows/hides */}
      <AuthExpiredBanner />
    </>
  );
}
