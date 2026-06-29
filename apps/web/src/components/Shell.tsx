import { useState } from "react";
import { useGex } from "../hooks/useGex.ts";
import { usePositions } from "../hooks/usePositions.ts";
import { bookUnrealizedPnl } from "../lib/pair-calendars.ts";
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

// ─── MarketStrip ─────────────────────────────────────────────────────────────

function MarketStrip(): React.ReactElement {
  const { data: gex } = useGex();
  const { data: positions } = usePositions();

  // Book P&L: total unrealized P&L across the book (Σ legUnreal). NOT marketValue·netQty
  // — that flips short signs and sums notional magnitude (the bug this replaces).
  const bookPnl = positions ? bookUnrealizedPnl(positions.positions) : null;

  const isNegativeGamma =
    gex !== undefined && gex.netGammaAtSpot < 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
      }}
    >
      {/* SPX spot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          background: "rgba(22,29,43,0.6)",
          border: "1px solid #1b2433",
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.9px",
            color: "#7b8696",
          }}
        >
          SPX
        </span>
        <span
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "16px",
            color: "#5b9cf6",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {gex !== undefined ? fmtSpot(gex.spot) : "—"}
        </span>
      </div>

      {/* net γ /1% */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          background: isNegativeGamma ? "#180f10" : "rgba(22,29,43,0.6)",
          border: `1px solid ${isNegativeGamma ? "#5a2b2e" : "#1b2433"}`,
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.9px",
            color: "#7b8696",
          }}
        >
          net γ /1%
        </span>
        <span
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "16px",
            color:
              gex !== undefined
                ? gex.netGammaAtSpot >= 0
                  ? "#26a69a"
                  : "#ef5350"
                : "#7b8696",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {gex !== undefined ? fmtGamma(gex.netGammaAtSpot) : "—"}
        </span>
      </div>

      {/* γ flip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          background: "rgba(22,29,43,0.6)",
          border: "1px solid #1b2433",
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.9px",
            color: "#7b8696",
          }}
        >
          γ flip
        </span>
        <span
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "16px",
            color: "#f0b429",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {gex !== undefined && gex.flip !== null
            ? fmtSpot(gex.flip)
            : "—"}
        </span>
      </div>

      {/* book P&L */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          background: "rgba(22,29,43,0.6)",
          border: "1px solid #1b2433",
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.9px",
            color: "#7b8696",
          }}
        >
          book P&amp;L
        </span>
        <span
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "16px",
            color:
              bookPnl !== null
                ? bookPnl >= 0
                  ? "#26a69a"
                  : "#ef5350"
                : "#7b8696",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {bookPnl !== null ? fmtCompact(bookPnl, "$") : "—"}
        </span>
      </div>
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
 * Renders:
 *   - Sticky frosted-glass header (~48px) with the MORAI brand logotype, three
 *     locked nav tabs (Overview · Analyzer · Journal), and a right-aligned live
 *     market strip (SPX spot, net γ /1%, γ flip, book P&L).
 *   - The active screen in its content area (via `children` or internal switcher).
 *   - The fixed-bottom <AuthExpiredBanner> (always mounted when authenticated).
 *
 * Nav is implemented via `useState<ScreenName>` (lightweight screen switcher, no
 * router dependency at this stage). The Shell can be controlled (activeScreen +
 * onNavigate props) or uncontrolled (manages its own state). Vercel SPA rewrites
 * (vercel.json) support direct URL access; React Router can be added later without
 * changing this component's API.
 *
 * UI-SPEC: "Global — all screens" sticky header + market strip.
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
      <header
        style={{
          position: "sticky",
          top: 0,
          left: 0,
          right: 0,
          height: "48px",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background:
            "linear-gradient(180deg, rgba(22,29,43,0.55), rgba(10,14,20,0))",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid #1b2433",
          boxSizing: "border-box",
        }}
      >
        {/* Left: Brand logotype + Nav tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          {/* MOR-AI logotype (violet "AI") — Copywriting Contract: "MORAI" bold "AI" in violet */}
          <div
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: "16px",
              color: "#d6dbe4",
              letterSpacing: "-0.01em",
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            MOR<strong style={{ color: "#a78bfa" }}>AI</strong>
          </div>

          {/* Nav tabs — locked order: Overview · Analyzer · Journal */}
          <nav
            role="tablist"
            aria-label="Dashboard navigation"
            style={{ display: "flex", alignItems: "center", gap: "2px" }}
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
                  style={{
                    background: isActive ? "#161d2b" : "transparent",
                    border: "none",
                    borderRadius: "6px",
                    color: isActive ? "#d6dbe4" : "#7b8696",
                    cursor: "pointer",
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.9px",
                    padding: "6px 12px",
                    textTransform: "uppercase",
                    transition: "color 0.15s, background 0.15s",
                    outline: "none",
                    minHeight: "32px",
                    minWidth: "44px",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.outline =
                      "2px solid #a78bfa";
                    e.currentTarget.style.outlineOffset = "2px";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.outline = "none";
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "#d6dbe4";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = "#7b8696";
                    }
                  }}
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
      <main style={{ minHeight: "calc(100vh - 48px)" }}>{children}</main>

      {/* AUTH_EXPIRED banner — always mounted when authenticated, self-shows/hides */}
      <AuthExpiredBanner />
    </>
  );
}

// ─── ShellWithRouter ─────────────────────────────────────────────────────────

/**
 * ShellWithRouter — wraps Shell with its own internal screen state and renders
 * the active screen from the provided `screens` map.
 *
 * This is the primary export used by App.tsx to render the full authenticated layout.
 * The screen map is built in App.tsx so that lazy imports can be added later without
 * modifying this component.
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
