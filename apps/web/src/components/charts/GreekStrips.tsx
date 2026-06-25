/**
 * GreekStrips — 4-panel synced uPlot small-multiple strips (Net Δ / Net Γ / Net Θ/d / Net Vega vs spot)
 *
 * UI-SPEC "Greek strips":
 *   - 4 panels: Net Δ / Net Γ / Net Θ/d / Net Vega
 *   - Per strip: label token uppercase top-left, current value top-right
 *   - Zero line #283342, spot vertical #5b9cf6 opacity 45%
 *   - Curve colors: Δ=#5b9cf6, Γ=#22d3ee, Θ=#f0b429, Vega=#26a69a
 *   - Shared cursor.sync.key across all four panels (RESEARCH Pattern 8)
 *   - Optional strike vertical line prop (Positions adds #46556a dashed)
 *
 * Pitfall 8 (RESEARCH): must import uPlot.min.css
 */

import "uplot/dist/uPlot.min.css";
import UplotReact from "uplot-react";
import { useMemo } from "react";
import type uPlot from "uplot";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GreekStripData = {
  /** Spot price axis (x values) */
  readonly spots: ReadonlyArray<number>;
  /** Net delta at each spot */
  readonly delta: ReadonlyArray<number>;
  /** Net gamma at each spot */
  readonly gamma: ReadonlyArray<number>;
  /** Net theta per day at each spot */
  readonly theta: ReadonlyArray<number>;
  /** Net vega per vol point at each spot */
  readonly vega: ReadonlyArray<number>;
  /** Current live spot price (marks the vertical cursor line) */
  readonly currentSpot: number;
  /** Optional strike price for the Positions dashed strike vertical line */
  readonly strikeSpot?: number;
};

interface GreekStripsProps {
  data: GreekStripData;
  /** Panel width in pixels (default 200) */
  panelWidth?: number;
  /** Panel height in pixels (default 104) */
  panelHeight?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Locked curve colors per UI-SPEC */
const COLORS = {
  delta: "#5b9cf6",
  gamma: "#22d3ee",
  theta: "#f0b429",
  vega: "#26a69a",
  zeroLine: "#283342",
  spotLine: "#5b9cf6",
  strikeLine: "#46556a",
} as const;

/** Shared cursor sync key for all four panels */
const CURSOR_SYNC_KEY = "greek-strips-sync";

/** Panel definitions: label / greek key / color */
const PANELS: ReadonlyArray<{
  label: string;
  key: keyof Pick<GreekStripData, "delta" | "gamma" | "theta" | "vega">;
  color: string;
}> = [
  { label: "Net Δ", key: "delta", color: COLORS.delta },
  { label: "Net Γ", key: "gamma", color: COLORS.gamma },
  { label: "Net Θ/d", key: "theta", color: COLORS.theta },
  { label: "Net Vega", key: "vega", color: COLORS.vega },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SingleStrip — one uPlot panel. Kept pure so GreekStrips can map over PANELS.
 */
function SingleStrip({
  label,
  color,
  spots,
  values,
  currentSpot,
  strikeSpot,
  width,
  height,
}: {
  label: string;
  color: string;
  spots: ReadonlyArray<number>;
  values: ReadonlyArray<number>;
  currentSpot: number;
  strikeSpot?: number;
  width: number;
  height: number;
}): React.ReactElement {
  // ReadonlyArray<number> → Float64Array without `as` cast
  const uData: uPlot.AlignedData = useMemo(
    () => [
      Float64Array.from(spots),
      Float64Array.from(values),
    ],
    [spots, values],
  );

  const opts: uPlot.Options = useMemo(() => {
    const plugins: uPlot.Plugin[] = [
      // Zero horizontal line plugin
      {
        hooks: {
          draw: (u: uPlot) => {
            const ctx = u.ctx;
            const { left, top, width: w, height: h } = u.bbox;
            const yZero = u.valToPos(0, "y", true);
            if (yZero !== undefined && yZero >= top && yZero <= top + h) {
              ctx.save();
              ctx.strokeStyle = COLORS.zeroLine;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(left, yZero);
              ctx.lineTo(left + w, yZero);
              ctx.stroke();
              ctx.restore();
            }
          },
        },
      },
      // Spot vertical line plugin (+ optional strike line)
      {
        hooks: {
          draw: (u: uPlot) => {
            const ctx = u.ctx;
            const { top, height: h } = u.bbox;
            const xSpot = u.valToPos(currentSpot, "x", true);
            if (xSpot !== undefined) {
              ctx.save();
              ctx.strokeStyle = COLORS.spotLine;
              ctx.globalAlpha = 0.45;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(xSpot, top);
              ctx.lineTo(xSpot, top + h);
              ctx.stroke();

              // Dot at current value — no `as` casts; use indexed access with fallback
              const nearestIdx = spots.reduce((best, s, i) => {
                const bestSpot = spots[best] ?? currentSpot;
                return Math.abs(s - currentSpot) < Math.abs(bestSpot - currentSpot) ? i : best;
              }, 0);
              const valAtSpot = values[nearestIdx] ?? 0;
              const yDot = u.valToPos(valAtSpot, "y", true);
              if (yDot !== undefined) {
                ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(xSpot, yDot, 3, 0, 2 * Math.PI);
                ctx.fill();
              }
              ctx.restore();
            }

            // Optional strike vertical line
            if (strikeSpot !== undefined) {
              const xStrike = u.valToPos(strikeSpot, "x", true);
              if (xStrike !== undefined) {
                ctx.save();
                ctx.strokeStyle = COLORS.strikeLine;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(xStrike, top);
                ctx.lineTo(xStrike, top + h);
                ctx.stroke();
                ctx.restore();
              }
            }
          },
        },
      },
    ];

    return {
      width,
      height,
      plugins,
      cursor: {
        sync: { key: CURSOR_SYNC_KEY },
        drag: { x: false, y: false },
        points: { show: false },
      },
      legend: { show: false },
      axes: [
        { show: false },
        { show: false },
      ],
      scales: {
        x: { time: false },
      },
      series: [
        {},
        {
          stroke: color,
          width: 1.5,
          fill: "transparent",
        },
      ],
    };
  }, [width, height, color, currentSpot, strikeSpot, spots, values]);

  const currentValue = useMemo(() => {
    // No `as` casts — use indexed access with ?? fallback (noUncheckedIndexedAccess)
    const nearestIdx = spots.reduce((best, s, i) => {
      const bestSpot = spots[best] ?? currentSpot;
      return Math.abs(s - currentSpot) < Math.abs(bestSpot - currentSpot) ? i : best;
    }, 0);
    return values[nearestIdx] ?? 0;
  }, [spots, values, currentSpot]);

  return (
    <div style={{ position: "relative", width, height }}>
      {/* Panel label (top-left) */}
      <div
        style={{
          position: "absolute",
          top: 2,
          left: 4,
          zIndex: 1,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.9px",
          textTransform: "uppercase",
          color: "#7b8696",
          pointerEvents: "none",
          fontFamily: "Space Grotesk, sans-serif",
        }}
        aria-label={`${label} panel`}
      >
        {label}
      </div>
      {/* Current value (top-right) */}
      <div
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          zIndex: 1,
          fontSize: 10,
          fontWeight: 600,
          color,
          pointerEvents: "none",
          fontFamily: "Space Grotesk, sans-serif",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {currentValue.toFixed(4)}
      </div>
      <UplotReact options={opts} data={uData} />
    </div>
  );
}

/**
 * GreekStrips — 4-panel synced uPlot small-multiples for the Positions and Analyzer screens.
 *
 * Props:
 *   - data: spot axis + all four greek curves + currentSpot + optional strikeSpot
 *   - panelWidth/panelHeight: dimensions of each panel
 *
 * Reused by Plan 10 Analyzer (without strikeSpot).
 */
export function GreekStrips({
  data,
  panelWidth = 200,
  panelHeight = 104,
}: GreekStripsProps): React.ReactElement {
  return (
    <div
      style={{ display: "flex", flexDirection: "row", gap: 8 }}
      data-testid="greek-strips"
    >
      {PANELS.map((panel) => (
        <SingleStrip
          key={panel.key}
          label={panel.label}
          color={panel.color}
          spots={data.spots}
          values={data[panel.key]}
          currentSpot={data.currentSpot}
          {...(data.strikeSpot !== undefined ? { strikeSpot: data.strikeSpot } : {})}
          width={panelWidth}
          height={panelHeight}
        />
      ))}
    </div>
  );
}
