import { useId } from "react";
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ReferenceDot } from "recharts";
import { ChartContainer } from "../ui/chart.tsx";
import type { ChartConfig } from "../ui/chart.tsx";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GammaProfile — Net dealer gamma profile chart.
 *
 * UI-SPEC "Market screen" anchor: 720×230px (full) or 300×130px (compact for Analyzer right panel).
 *
 * Renders the net-gamma-profile curve from gexSnapshotEntry.profile[{spot, gamma}]:
 *   - Teal fill above zero (positive gamma, DAMPEN regime), coral fill below zero (AMPLIFY
 *     regime) — a single Area with a split-gradient offset at the zero-gamma crossing.
 *   - Amber vertical dashed ReferenceLine at γ-flip level (flip), only when non-null.
 *   - Blue vertical solid ReferenceLine at current spot + a ReferenceDot at the zero baseline.
 *
 * Chart library: Recharts (shadcn ChartContainer), migrated off @visx — Phase 33.
 * No any/as/! — all types from GexSnapshotEntry.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface GammaProfileProps {
  /** Profile data from GexSnapshotEntry.profile */
  profile: GexSnapshotEntry["profile"];
  /** Current spot price (blue vertical line) */
  spot: number;
  /** Gamma flip level (amber vertical dashed line); null if no flip */
  flip: GexSnapshotEntry["flip"];
  /** Chart width in pixels; default 720 (full-size Market screen) */
  width?: number;
  /** Chart height in pixels; default 230 (full-size Market screen) */
  height?: number;
  /** Compact mode: 300×130px for Analyzer right panel */
  compact?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL = "#26a69a";
const CORAL = "#ef5350";
const AMBER = "#f0b429";
const BLUE = "#5b9cf6";
const ZERO_LINE = "#27313f";

const FULL_WIDTH = 720;
const FULL_HEIGHT = 230;
const COMPACT_WIDTH = 300;
const COMPACT_HEIGHT = 130;

const MARGIN = { top: 16, right: 16, bottom: 24, left: 16 };

const chartConfig = {
  gamma: { label: "Net γ", color: TEAL },
} satisfies ChartConfig;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GammaProfile — Recharts net gamma profile (compact + full sizes).
 *
 * compact=true → 300×130px (Analyzer right panel)
 * compact=false (default) → 720×230px (Market screen anchor)
 */
export function GammaProfile({
  profile,
  spot,
  flip,
  width,
  height,
  compact = false,
}: GammaProfileProps): React.ReactElement | null {
  // useId must run unconditionally before the null-guard early return (rules of hooks).
  const gradientId = `gamma-fill-${useId().replace(/:/g, "")}`;

  if (profile.length < 2) return null;

  const svgWidth = width ?? (compact ? COMPACT_WIDTH : FULL_WIDTH);
  const svgHeight = height ?? (compact ? COMPACT_HEIGHT : FULL_HEIGHT);

  const spotValues = profile.map((p) => p.spot);
  const gammaValues = profile.map((p) => p.gamma);

  const minSpot = Math.min(...spotValues);
  const maxSpot = Math.max(...spotValues);
  const minGamma = Math.min(0, ...gammaValues);
  const maxGamma = Math.max(0, ...gammaValues);
  const gammaPad = Math.max(Math.abs(maxGamma - minGamma) * 0.05, 1);
  const yLo = minGamma - gammaPad;
  const yHi = maxGamma + gammaPad;

  // Split-gradient offset: fraction of the y-domain (top=0%) that is >= 0 (RESEARCH Pattern 2 / D-05).
  const splitOffset = yHi <= 0 ? 0 : yLo >= 0 ? 1 : yHi / (yHi - yLo);

  const dashedStroke = compact ? "4 3" : "6 4";
  const lineStroke = compact ? 1 : 1.5;

  return (
    <ChartContainer config={chartConfig} style={{ width: svgWidth, height: svgHeight }}>
      {/* Explicit width/height: ChartContainer's ResponsiveContainer takes priority when
          it measures a real size (browser), but falls back to these under jsdom where
          ResizeObserver/context sizing isn't available (matches 33-01's zorder-spike
          precedent) — required for GammaProfile's fixed-pixel compact/full sizes anyway. */}
      <AreaChart data={profile} width={svgWidth} height={svgHeight} margin={MARGIN}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset={splitOffset} stopColor={TEAL} stopOpacity={0.3} />
            <stop offset={splitOffset} stopColor={CORAL} stopOpacity={0.3} />
          </linearGradient>
        </defs>

        <XAxis
          type="number"
          dataKey="spot"
          domain={[minSpot, maxSpot]}
          allowDataOverflow
          hide={compact}
          ticks={[minSpot, maxSpot]}
          tickFormatter={(v: number): string => v.toFixed(0)}
          tick={{ fill: "#566273", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis type="number" domain={[yLo, yHi]} allowDataOverflow hide />

        <ReferenceLine y={0} stroke={ZERO_LINE} className="gamma-zero-line" />

        <Area
          type="monotone"
          dataKey="gamma"
          className="gamma-area"
          stroke={TEAL}
          strokeWidth={lineStroke}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />

        {flip !== null && (
          <ReferenceLine
            x={flip}
            className="gamma-flip-line"
            stroke={AMBER}
            strokeDasharray={dashedStroke}
          />
        )}

        <ReferenceLine x={spot} className="gamma-spot-line" stroke={BLUE} strokeWidth={lineStroke} />
        <ReferenceDot
          x={spot}
          y={0}
          r={compact ? 3 : 4}
          className="gamma-spot-dot"
          fill={BLUE}
          stroke="none"
        />
      </AreaChart>
    </ChartContainer>
  );
}
