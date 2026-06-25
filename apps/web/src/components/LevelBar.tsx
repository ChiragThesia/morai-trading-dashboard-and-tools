/**
 * LevelBar — Call wall / γ flip / your strike / spot / put wall level bar
 *
 * UI-SPEC "Strike structure": level bar + key distances in text + callout.
 * Shows the relative position of the trader's strike vs key structural levels.
 *
 * Color-coded markers:
 *   - Call wall:  teal #26a69a
 *   - γ flip:     amber #f0b429
 *   - Strike:     violet #a78bfa
 *   - Spot:       blue #5b9cf6
 *   - Put wall:   coral #ef5350
 *
 * Reused by Plan 10 Analyzer.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type LevelBarData = {
  /** Put wall price level (leftmost — lower price) */
  readonly putWall: number;
  /** Call wall price level (rightmost — higher price) */
  readonly callWall: number;
  /** Gamma flip level (zero-gamma) */
  readonly gammaFlip: number;
  /** Trader's strike price */
  readonly strike: number;
  /** Current live spot price */
  readonly spot: number;
};

interface LevelBarProps {
  data: LevelBarData;
  /** Bar width in pixels (default 100%) */
  width?: number | string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_COLORS = {
  callWall: "#26a69a",
  gammaFlip: "#f0b429",
  strike: "#a78bfa",
  spot: "#5b9cf6",
  putWall: "#ef5350",
} as const;

const LEVEL_LABELS = {
  callWall: "Call Wall",
  gammaFlip: "γ flip",
  strike: "Strike",
  spot: "Spot",
  putWall: "Put Wall",
} as const;

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Map a price value to a [0, 100] percentage within [lo, hi] range */
function toPct(value: number, lo: number, hi: number): number {
  if (hi === lo) return 50;
  return Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
}

/** Format a distance (e.g., "+120 pts") */
function fmtDistance(from: number, to: number): string {
  const diff = Math.round(to - from);
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff} pts`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LevelMarker({
  pct,
  color,
  label,
  dashed = false,
  size = 8,
}: {
  pct: number;
  color: string;
  label: string;
  dashed?: boolean;
  size?: number;
}): React.ReactElement {
  return (
    <div
      style={{ position: "absolute", left: `${pct}%`, top: 0, bottom: 0, transform: "translateX(-50%)" }}
      aria-label={label}
    >
      {/* Vertical tick */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 2,
          background: color,
          transform: "translateX(-50%)",
          ...(dashed
            ? {
                backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0px, ${color} 4px, transparent 4px, transparent 7px)`,
                background: "transparent",
              }
            : {}),
        }}
      />
      {/* Marker dot */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          transform: "translate(-50%, -50%)",
          zIndex: 2,
        }}
      />
      {/* Label below */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -20,
          transform: "translateX(-50%)",
          fontSize: 8,
          color,
          fontFamily: "JetBrains Mono, monospace",
          fontWeight: 600,
          whiteSpace: "nowrap",
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * LevelBar — renders a horizontal price bar with color-coded level markers.
 *
 * Used on:
 *   - Positions screen Row 2 (span 4): strike-vs-structure with distances
 *   - Analyzer right panel: key levels summary
 */
export function LevelBar({ data, width = "100%" }: LevelBarProps): React.ReactElement {
  const { putWall, callWall, gammaFlip, strike, spot } = data;

  // Range: extend slightly beyond the min/max to give markers visual breathing room
  const lo = Math.min(putWall, callWall, gammaFlip, strike, spot);
  const hi = Math.max(putWall, callWall, gammaFlip, strike, spot);
  const pad = (hi - lo) * 0.08;
  const rangeL = lo - pad;
  const rangeH = hi + pad;

  const pctOf = (v: number): number => toPct(v, rangeL, rangeH);

  const levels = [
    { key: "putWall" as const, value: putWall, color: LEVEL_COLORS.putWall, label: LEVEL_LABELS.putWall, dashed: false },
    { key: "gammaFlip" as const, value: gammaFlip, color: LEVEL_COLORS.gammaFlip, label: LEVEL_LABELS.gammaFlip, dashed: true },
    { key: "strike" as const, value: strike, color: LEVEL_COLORS.strike, label: LEVEL_LABELS.strike, dashed: false },
    { key: "spot" as const, value: spot, color: LEVEL_COLORS.spot, label: LEVEL_LABELS.spot, dashed: false },
    { key: "callWall" as const, value: callWall, color: LEVEL_COLORS.callWall, label: LEVEL_LABELS.callWall, dashed: false },
  ] as const;

  return (
    <div
      data-testid="level-bar"
      style={{ width, padding: "0 8px" }}
    >
      {/* The horizontal bar */}
      <div
        style={{
          position: "relative",
          height: 24,
          background: "#0c111a",
          borderRadius: 4,
          border: "1px solid #1b2433",
          marginBottom: 28, // room for labels below
        }}
      >
        {levels.map((lvl) => (
          <LevelMarker
            key={lvl.key}
            pct={pctOf(lvl.value)}
            color={lvl.color}
            label={lvl.label}
            dashed={lvl.dashed}
          />
        ))}
      </div>

      {/* Key distances table */}
      <div
        style={{ marginTop: 4 }}
        data-testid="level-bar-distances"
      >
        {levels.map((lvl) => {
          const dist = fmtDistance(spot, lvl.value);
          return (
            <div
              key={lvl.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                marginBottom: 2,
                fontFamily: "JetBrains Mono, monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: lvl.color }}>{lvl.label}</span>
              <span style={{ color: "#566273" }}>{dist}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
