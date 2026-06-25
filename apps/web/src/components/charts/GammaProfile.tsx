import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GammaProfile — Net dealer gamma profile chart.
 *
 * UI-SPEC "Market screen" anchor: 720×230px (full) or 300×130px (compact for Analyzer right panel).
 *
 * Renders the net-gamma-profile curve from gexSnapshotEntry.profile[{spot, gamma}]:
 *   - Teal fill above zero (positive gamma, DAMPEN regime)
 *   - Coral fill below zero (negative gamma, AMPLIFY regime)
 *   - Amber vertical dashed line at γ-flip level (flip)
 *   - Blue vertical solid line at current spot
 *
 * Chart library: visx (AreaClosed + LinePath + LinearGradient — locked by UI-SPEC).
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

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GammaProfile — visx net gamma profile (compact + full sizes).
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
  if (profile.length < 2) return null;

  const svgWidth = width ?? (compact ? COMPACT_WIDTH : FULL_WIDTH);
  const svgHeight = height ?? (compact ? COMPACT_HEIGHT : FULL_HEIGHT);

  const innerWidth = svgWidth - MARGIN.left - MARGIN.right;
  const innerHeight = svgHeight - MARGIN.top - MARGIN.bottom;

  // Scales
  const spotValues = profile.map((p) => p.spot);
  const gammaValues = profile.map((p) => p.gamma);

  const minSpot = Math.min(...spotValues);
  const maxSpot = Math.max(...spotValues);
  const minGamma = Math.min(0, ...gammaValues);
  const maxGamma = Math.max(0, ...gammaValues);
  const gammaPad = Math.max(Math.abs(maxGamma - minGamma) * 0.05, 1);

  const xScale = scaleLinear({
    domain: [minSpot, maxSpot],
    range: [0, innerWidth],
  });

  const yScale = scaleLinear({
    domain: [minGamma - gammaPad, maxGamma + gammaPad],
    range: [innerHeight, 0],
  });

  const getX = (p: { spot: number; gamma: number }): number => xScale(p.spot);
  const getY = (p: { spot: number; gamma: number }): number => yScale(p.gamma);

  const zeroY = yScale(0);

  // Split profile into above-zero and below-zero regions for separate fills
  // We use two AreaClosed charts clipped to the above/below zero halves.
  // Upper region: gamma > 0 (teal)
  // Lower region: gamma < 0 (coral)

  // Spot x position
  const spotX = xScale(spot);

  // Flip x position (when non-null)
  const flipX = flip !== null ? xScale(flip) : null;

  const lineStroke = compact ? 1 : 1.5;
  const dashedStroke = compact ? "4,3" : "6,4";

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      aria-label="Net dealer gamma profile"
      role="img"
      style={{ overflow: "visible", background: "transparent" }}
    >
      {/* Gradient definitions */}
      <LinearGradient
        id="gamma-teal-fill"
        from={TEAL}
        to={TEAL}
        fromOpacity={0.3}
        toOpacity={0.05}
        vertical
      />
      <LinearGradient
        id="gamma-coral-fill"
        from={CORAL}
        to={CORAL}
        fromOpacity={0.05}
        toOpacity={0.3}
        vertical
      />

      <Group left={MARGIN.left} top={MARGIN.top}>
        {/* Zero baseline */}
        <line
          x1={0}
          x2={innerWidth}
          y1={zeroY}
          y2={zeroY}
          stroke={ZERO_LINE}
          strokeWidth={1}
        />

        {/* Teal area fill above zero (positive gamma — DAMPEN) */}
        <AreaClosed
          data={profile}
          x={getX}
          y={(p) => Math.min(getY(p), zeroY)}
          y0={zeroY}
          yScale={yScale}
          curve={curveMonotoneX}
          fill="url(#gamma-teal-fill)"
        />

        {/* Coral area fill below zero (negative gamma — AMPLIFY) */}
        <AreaClosed
          data={profile}
          x={getX}
          y={(p) => Math.max(getY(p), zeroY)}
          y0={zeroY}
          yScale={yScale}
          curve={curveMonotoneX}
          fill="url(#gamma-coral-fill)"
        />

        {/* The gamma profile line */}
        <LinePath
          data={profile}
          x={getX}
          y={getY}
          curve={curveMonotoneX}
          stroke={TEAL}
          strokeWidth={lineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Above zero → teal, below zero → coral via gradient trick
        />

        {/* Gamma flip vertical dashed line (amber) */}
        {flipX !== null && (
          <line
            x1={flipX}
            x2={flipX}
            y1={0}
            y2={innerHeight}
            stroke={AMBER}
            strokeWidth={1}
            strokeDasharray={dashedStroke}
          />
        )}

        {/* Spot vertical solid line (blue) */}
        <line
          x1={spotX}
          x2={spotX}
          y1={0}
          y2={innerHeight}
          stroke={BLUE}
          strokeWidth={compact ? 1 : 1.5}
        />

        {/* Spot dot at zero line */}
        <circle
          cx={spotX}
          cy={zeroY}
          r={compact ? 3 : 4}
          fill={BLUE}
        />

        {/* Axis labels (compact skips them for space) */}
        {!compact && (
          <>
            {/* X-axis min/max labels */}
            <text
              x={0}
              y={innerHeight + 16}
              fill="#566273"
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="start"
            >
              {minSpot.toFixed(0)}
            </text>
            <text
              x={innerWidth}
              y={innerHeight + 16}
              fill="#566273"
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="end"
            >
              {maxSpot.toFixed(0)}
            </text>
            {/* Zero label */}
            <text
              x={-4}
              y={zeroY + 4}
              fill={ZERO_LINE}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="end"
            >
              0
            </text>
          </>
        )}
      </Group>
    </svg>
  );
}
