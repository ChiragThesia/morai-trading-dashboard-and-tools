/**
 * PayoffChart — visx payoff / risk profile chart with full 9-layer z-order
 *
 * UI-SPEC "Analyzer screen" payoff chart — locked z-order (bottom to top):
 *   1. Profit zone teal fill (where T+0 P&L >= 0)
 *   2. T+0 curve: #a78bfa (violet), 2.6px, teal-above / coral-below gradient fill
 *   3. Dated fan curves (+7/+14/+21d) when toggled
 *   4. Expiration tent dashed when toggled
 *   5. Amber roll overlay when active
 *   6. GEX wall lines when toggled
 *   7. Expiration BE dashed lines (gray, labeled "BE {strike}")
 *   8. T+0 BE dashed lines (violet, labeled "BE·T0 {strike}")
 *   9. Spot vertical blue line + circle dot at T+0 value
 *
 * TOS-stable y-axis: computed once from the expiration profile on position-set change.
 * "fit Y" resets on demand.
 * Crosshair: gray vertical line on pointermove + fixed HTML tooltip.
 *
 * Chart library: visx (LinePath/AreaClosed/LinearGradient/localPoint — locked by UI-SPEC).
 * SVG viewport: 1000×470 logical, preserveAspectRatio none.
 * No any/as/!.
 */

import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { localPoint } from "@visx/event";
import { findZeroCrossings } from "../../lib/scenario-engine.ts";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayoffChartToggles = {
  readonly showFan: boolean;
  readonly showExpiration: boolean;
  readonly showWalls: boolean;
  readonly showProfitZone: boolean;
};

export type PayoffChartGex = {
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly flip: number | null;
};

export interface PayoffChartProps {
  /** T+0 payoff curve (at daysForward slider value) */
  todayCurve: ReadonlyArray<PayoffPoint>;
  /** Fan curves for +7/+14/+21d */
  fanCurves: ReadonlyArray<{ days: number; curve: ReadonlyArray<PayoffPoint> }>;
  /** Expiration tent curve */
  expirationCurve: ReadonlyArray<PayoffPoint>;
  /** Amber roll overlay curve (null = roll not active) */
  rollCurve: ReadonlyArray<PayoffPoint> | null;
  /** GEX walls for reference lines */
  gex: PayoffChartGex | null;
  /**
   * X-domain the x-scale, ticks, GEX wall pinning, and crosshair hover all derive from
   * (D-01, Phase 30). Replaces the old hardcoded 6900/7900 module constants — callers
   * compute this via `computePayoffDomain` (payoff-domain.ts).
   */
  domain: { readonly min: number; readonly max: number };
  /** Current live spot price (blue vertical + dot) */
  spot: number;
  /** Toggle visibility flags */
  toggles: PayoffChartToggles;
  /** Called when "fit Y" button is clicked from parent */
  fitY: boolean;
  /** Callback when fitY is consumed */
  onFitYConsumed: () => void;
  /** Signature of the current position set (for y-axis lock recompute) */
  positionSetSignature: string;
  /** Expiration curve for y-axis lock baseline (0-IV, position-set-only) */
  baseExpirationCurve: ReadonlyArray<PayoffPoint>;
  /**
   * D-05 row-highlight: id of the docked-table row currently hovered/selected.
   * When set, the net-book T+0/@exp curves dim to stroke-opacity 0.3 (chart-layer,
   * distinct from PositionsTable's opacity-40 row-exclusion class) and the single
   * highlighted position's own T+0/@exp curves render at full emphasis.
   */
  highlightedPositionId?: string | null;
  /** Single-position T+0 curve to draw at full emphasis when highlighted. */
  highlightedTodayCurve?: ReadonlyArray<PayoffPoint> | null;
  /** Single-position @exp curve to draw at full emphasis when highlighted. */
  highlightedExpirationCurve?: ReadonlyArray<PayoffPoint> | null;
  /**
   * D-02 net-book self-flag: count of positions excluded from the T+0 aggregate
   * because their front leg's IV did not converge. Renders an amber
   * "T+0 excludes {n} position(s): IV n/a" note; omitted when 0/absent.
   */
  excludedFromT0Count?: number;
  /**
   * D-03 TOS-fidelity override seam: net-book T+0 curve + BE stroke color.
   * Defaults to the Analyzer's violet brand color; the Overview hero injects
   * TOS magenta here without affecting the Analyzer (which passes neither
   * color prop). Does not affect the highlighted single-position overlay.
   */
  todayCurveColor?: string;
  /**
   * D-03 TOS-fidelity override seam: net-book @exp curve + BE stroke color.
   * Defaults to the Analyzer's gray-muted brand color; the Overview hero
   * injects TOS cyan here. Does not affect the highlighted single-position
   * overlay.
   */
  expirationCurveColor?: string;
  /**
   * ANLZ-02 ⊕-compare overlay: single dashed amber front-expiry curve for a
   * second candidate. Defaults to null (absent-safe; Overview.tsx's call
   * site omits this prop entirely and is unaffected).
   */
  compareCurve?: ReadonlyArray<PayoffPoint> | null;
  /** ANLZ-02: stroke color for the compareCurve overlay. Defaults to the AMBER module constant. */
  compareCurveColor?: string;
  /**
   * ANLZ-02 ±1σ expected-move band: two tick marks + a horizontal connector
   * at the zero-P&L line. Defaults to null (absent-safe).
   */
  expectedMoveBand?: { spot: number; em: number } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SVG_W = 1000;
const SVG_H = 470;
const PAD = { left: 56, right: 14, top: 14, bottom: 24 };

const INNER_W = SVG_W - PAD.left - PAD.right;
const INNER_H = SVG_H - PAD.top - PAD.bottom;

const VIOLET = "#a78bfa";
const TEAL = "#26a69a";
const CORAL = "#ef5350";
const AMBER = "#f0b429";
const BLUE = "#5b9cf6";
const GRAY_MUTED = "#7b8696";
const ZERO_LINE = "#46556a";
const GRID_LINE = "#19212e";
const CROSSHAIR_COLOR = "#8a98ad";

const FAN_COLORS = ["#7c6fd6", "#6f86c9", "#5f93b8"] as const;

/**
 * KISS collision fix (31-01, DEFECT-1): fixed vertical lane per wall series
 * for the off-domain single-glyph edge arrow. Three distinct y values means
 * two arrows clamped to the same edge can never share a bounding box —
 * provable by construction, not by measurement (jsdom can't measure SVG text).
 */
export const EDGE_ARROW_LANE_Y: Record<"flip" | "call" | "put", number> = {
  flip: 8,
  call: 16,
  put: 24,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildXScale(innerWidth: number, domain: { readonly min: number; readonly max: number }) {
  return scaleLinear({ domain: [domain.min, domain.max], range: [0, innerWidth] });
}

type PinnedMarker = {
  readonly x: number;
  readonly clampedTo: "min" | "max" | null;
};

/**
 * Edge-pin a GEX wall/flip marker into the x-domain. The chart SVG overflows
 * visibly, so an out-of-domain level (e.g. a call wall above domain.max)
 * would otherwise draw PAST the plot into neighboring layout. Pinned markers
 * clamp to the domain edge; `clampedTo` drives the fixed-lane edge-arrow
 * render (no in-chart text label — KISS collision fix, DEFECT-1).
 */
function pinMarker(
  value: number,
  xScale: (v: number) => number,
  domain: { readonly min: number; readonly max: number },
): PinnedMarker {
  if (value > domain.max) {
    return { x: xScale(domain.max), clampedTo: "max" };
  }
  if (value < domain.min) {
    return { x: xScale(domain.min), clampedTo: "min" };
  }
  return { x: xScale(value), clampedTo: null };
}

function buildYScale(lo: number, hi: number, innerHeight: number) {
  return scaleLinear({ domain: [lo, hi], range: [innerHeight, 0] });
}

/**
 * Compute y-domain from BOTH the today/date curve and the @exp curve
 * (TOS-stable y-axis logic) — combined so a near-flat today curve is never
 * squashed against a tall @exp tent (OVW-04).
 */
function computeYDomain(
  todayCurve: ReadonlyArray<PayoffPoint>,
  expCurve: ReadonlyArray<PayoffPoint>,
): { lo: number; hi: number } {
  if (todayCurve.length === 0 && expCurve.length === 0) return { lo: -500, hi: 500 };

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of todayCurve) {
    if (p.pl < lo) lo = p.pl;
    if (p.pl > hi) hi = p.pl;
  }
  for (const p of expCurve) {
    if (p.pl < lo) lo = p.pl;
    if (p.pl > hi) hi = p.pl;
  }
  if (lo === hi) { lo -= 100; hi += 100; }

  const pad = (hi - lo) * 0.18;
  lo -= pad;
  hi += pad;
  if (lo > 0) lo = 0;
  if (hi < 0) hi = 0;

  return { lo, hi };
}

/**
 * Derive evenly-spaced round-number x-axis ticks from the live domain
 * (OVW-04) — replaces a hardcoded literal tick array that can drift out of
 * sync with the chart's domain prop (D-01, Phase 30).
 */
function buildXTicks(min: number, max: number, targetCount = 5): ReadonlyArray<number> {
  const rawStep = (max - min) / targetCount;
  const roundSteps = [25, 50, 100, 200, 250, 500, 1000];
  const step = roundSteps.find((s) => s >= rawStep) ?? roundSteps[roundSteps.length - 1];
  const snappedStep = step ?? rawStep;
  const first = Math.ceil(min / snappedStep) * snappedStep;
  const ticks: number[] = [];
  for (let v = first; v <= max; v += snappedStep) ticks.push(v);
  return ticks;
}

/** Format a P&L value compactly */
function fmtPl(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PayoffChart — renders the full 9-layer locked z-order visx payoff chart.
 */
export function PayoffChart({
  todayCurve,
  fanCurves,
  expirationCurve,
  rollCurve,
  gex,
  domain,
  spot,
  toggles,
  fitY,
  onFitYConsumed,
  positionSetSignature,
  baseExpirationCurve,
  highlightedPositionId = null,
  highlightedTodayCurve = null,
  highlightedExpirationCurve = null,
  excludedFromT0Count = 0,
  todayCurveColor = VIOLET,
  expirationCurveColor = GRAY_MUTED,
  compareCurve = null,
  compareCurveColor = AMBER,
  expectedMoveBand = null,
}: PayoffChartProps): React.ReactElement {
  // D-05: a highlight is active whenever a row id is supplied. The net-book
  // curves dim (chart-layer stroke-opacity) — never removed, never the
  // PositionsTable opacity-40 row-exclusion class.
  const highlightActive = highlightedPositionId !== null;
  const netBookStrokeOpacity = highlightActive ? 0.3 : 1;

  // D-02: net-book T+0 self-flag note, computed above the return (no IIFE in JSX).
  const exclusionNoteText =
    excludedFromT0Count > 0
      ? `T+0 excludes ${excludedFromT0Count} position${excludedFromT0Count === 1 ? "" : "s"}: IV n/a`
      : null;

  // TOS-stable y-domain: computed once per position-set change
  const [yDomainSig, setYDomainSig] = useState<string>("");
  const [yDomain, setYDomain] = useState<{ lo: number; hi: number }>({ lo: -500, hi: 500 });

  // Recompute y-domain when position set changes (lock-on-signature).
  // WR-03: this is a side effect (setState), so it belongs in useEffect —
  // never in useMemo's render-phase body.
  useEffect(() => {
    if (positionSetSignature !== yDomainSig) {
      setYDomain(computeYDomain(todayCurve, baseExpirationCurve));
      setYDomainSig(positionSetSignature);
    }
  }, [positionSetSignature, yDomainSig, todayCurve, baseExpirationCurve]);

  // Handle "fit Y" request.
  // WR-03: onFitYConsumed is a parent state setter — calling it from useMemo
  // during this component's render triggers React's "Cannot update a
  // component while rendering a different component" error. useEffect runs
  // after commit, so the parent update happens outside PayoffChart's render.
  useEffect(() => {
    if (fitY) {
      setYDomain(computeYDomain(todayCurve, baseExpirationCurve));
      onFitYConsumed();
    }
  }, [fitY, todayCurve, baseExpirationCurve, onFitYConsumed]);

  const xScale = useMemo(() => buildXScale(INNER_W, domain), [domain]);
  const yScale = useMemo(() => buildYScale(yDomain.lo, yDomain.hi, INNER_H), [yDomain]);

  const getX = useCallback((p: PayoffPoint) => xScale(p.spot), [xScale]);
  const getY = useCallback((p: PayoffPoint) => yScale(p.pl), [yScale]);
  const clampY = useCallback(
    (p: PayoffPoint) => Math.max(0, Math.min(INNER_H, yScale(p.pl))),
    [yScale],
  );

  const zeroY = yScale(0);

  // Spot x position
  const spotX = xScale(spot);

  // Find crossings
  const beExp = useMemo(() => findZeroCrossings(expirationCurve), [expirationCurve]);
  const beToday = useMemo(() => findZeroCrossings(todayCurve), [todayCurve]);

  // P&L at current spot (for dot + readout)
  const plAtSpot = useMemo(() => {
    const nearest = todayCurve.reduce<PayoffPoint | null>((best, p) => {
      if (best === null) return p;
      return Math.abs(p.spot - spot) < Math.abs(best.spot - spot) ? p : best;
    }, null);
    return nearest?.pl ?? 0;
  }, [todayCurve, spot]);

  // Crosshair state
  const svgRef = useRef<SVGSVGElement>(null);
  const [crosshair, setCrosshair] = useState<{
    x: number;
    spot: number;
    pl: number;
    renderedWidth: number;
  } | null>(null);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (svg === null) return;
      const point = localPoint(svg, event);
      if (point === null) return;

      // localPoint returns coords relative to the SVG element
      // We need to map from SVG pixel space back to logical coordinate
      const svgRect = svg.getBoundingClientRect();
      const scaleX = SVG_W / svgRect.width;
      const logicalX = point.x * scaleX;
      const innerX = logicalX - PAD.left;
      if (innerX < 0 || innerX > INNER_W) {
        setCrosshair(null);
        return;
      }

      // Invert through the SAME xScale used to plot the curves — one source of truth
      // for the domain↔pixel mapping (D-01, Pitfall 2), not a re-derived interpolation.
      const hoveredSpot = xScale.invert(innerX);
      const nearest = todayCurve.reduce<PayoffPoint | null>((best, p) => {
        if (best === null) return p;
        return Math.abs(p.spot - hoveredSpot) < Math.abs(best.spot - hoveredSpot) ? p : best;
      }, null);
      const pl = nearest?.pl ?? 0;

      setCrosshair({ x: logicalX, spot: hoveredSpot, pl, renderedWidth: svgRect.width });
    },
    [todayCurve, xScale],
  );

  const handlePointerLeave = useCallback(() => setCrosshair(null), []);

  // Grid lines (5 intervals)
  const gridLines = useMemo(() => {
    const lines: Array<{ y: number; value: number }> = [];
    for (let i = 0; i <= 5; i++) {
      const v = yDomain.lo + (yDomain.hi - yDomain.lo) * (i / 5);
      lines.push({ y: yScale(v), value: v });
    }
    return lines;
  }, [yDomain, yScale]);

  // X-axis ticks: derived round numbers from the live domain prop (OVW-04, D-01) —
  // replaces a hardcoded literal array that could drift from the chart's own scale.
  const xTicks = useMemo(() => buildXTicks(domain.min, domain.max), [domain]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", flex: 1, minHeight: 300 }}>
      {/* Breakeven pills — readable readouts above the chart (violet = today, gray = @exp),
          so the values never overlap inside the plot. The in-chart markers are the red bars. */}
      {(beToday.length > 0 || (toggles.showExpiration && beExp.length > 0)) && (
        <div
          data-testid="be-pills"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 10,
          }}
        >
          {beToday.length > 0 && (
            <>
              <span style={{ color: todayCurveColor, opacity: 0.85 }}>BE today</span>
              {beToday.map((x) => (
                <span
                  key={`pill-t0-${x}`}
                  data-testid="be-pill-t0"
                  style={{
                    color: todayCurveColor,
                    border: `1px solid ${todayCurveColor}80`,
                    background: `${todayCurveColor}14`,
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {Math.round(x)}
                </span>
              ))}
            </>
          )}
          {toggles.showExpiration && beExp.length > 0 && (
            <>
              <span style={{ color: expirationCurveColor, opacity: 0.85, marginLeft: beToday.length > 0 ? 4 : 0 }}>
                BE @exp
              </span>
              {beExp.map((x) => (
                <span
                  key={`pill-exp-${x}`}
                  data-testid="be-pill-exp"
                  style={{
                    color: expirationCurveColor,
                    border: `1px solid ${expirationCurveColor}80`,
                    background: `${expirationCurveColor}14`,
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {Math.round(x)}
                </span>
              ))}
            </>
          )}
        </div>
      )}

      <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 0 }}>
      {/* D-02: net-book T+0 self-flag note — placed near the legend row position */}
      {exclusionNoteText !== null && (
        <div
          data-testid="t0-exclusion-note"
          className="pointer-events-none absolute right-2 top-1 text-[10px] text-amber"
        >
          {exclusionNoteText}
        </div>
      )}

      {/* SVG chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        aria-label="Risk profile payoff chart"
        role="img"
      >
        <defs>
          {/* Gradient: teal above zero */}
          <LinearGradient
            id="payoff-teal-fill"
            from={TEAL}
            to={TEAL}
            fromOpacity={0.34}
            toOpacity={0}
            vertical
          />
          {/* Gradient: coral below zero */}
          <LinearGradient
            id="payoff-coral-fill"
            from={CORAL}
            to={CORAL}
            fromOpacity={0}
            toOpacity={0.34}
            vertical
          />
          {/* Glow filter for T+0 curve */}
          <filter id="payoff-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <Group left={PAD.left} top={PAD.top}>
          {/* ── Grid lines ───────────────────────────────────────────────── */}
          {gridLines.map(({ y, value }) => (
            <g key={value}>
              <line
                x1={0}
                y1={y}
                x2={INNER_W}
                y2={y}
                stroke={GRID_LINE}
                strokeWidth={1}
              />
              <text
                x={-6}
                y={y + 3}
                fill="#566273"
                fontSize={10}
                textAnchor="end"
                fontFamily="JetBrains Mono, monospace"
              >
                {fmtPl(value)}
              </text>
            </g>
          ))}

          {/* X-axis strike labels */}
          {xTicks.map((s) => (
            <text
              key={s}
              x={xScale(s)}
              y={INNER_H + 16}
              fill="#566273"
              fontSize={10}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {s}
            </text>
          ))}

          {/* Zero line */}
          <line
            x1={0}
            y1={zeroY}
            x2={INNER_W}
            y2={zeroY}
            stroke={ZERO_LINE}
            strokeWidth={1.1}
          />

          {/* ── ±1σ expected-move band: ticks + connector at the zero-P&L
               line (ANLZ-02) — placed before all curve layers so it never
               occludes the T+0/@exp curves (UI-SPEC z-order). Every x is
               clamped into [0, INNER_W]: tent-fitted domains (Phase 30) are
               often narrower than spot±1σ, and the SVG overflows visibly, so
               an unclamped connector bleeds across the whole page. A tick
               clamped to the edge reads as "band continues past the view". ── */}
          {expectedMoveBand !== null && (
            <g data-testid="em-band">
              <line
                data-testid="em-band-tick-lower"
                x1={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot - expectedMoveBand.em)))}
                y1={zeroY - 6}
                x2={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot - expectedMoveBand.em)))}
                y2={zeroY + 6}
                stroke={BLUE}
                strokeWidth={1.2}
              />
              <line
                data-testid="em-band-tick-upper"
                x1={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot + expectedMoveBand.em)))}
                y1={zeroY - 6}
                x2={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot + expectedMoveBand.em)))}
                y2={zeroY + 6}
                stroke={BLUE}
                strokeWidth={1.2}
              />
              <line
                data-testid="em-band-connector"
                x1={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot - expectedMoveBand.em)))}
                y1={zeroY}
                x2={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot + expectedMoveBand.em)))}
                y2={zeroY}
                stroke={BLUE}
                strokeWidth={1}
              />
              <text
                data-testid="em-band-label"
                x={Math.max(0, Math.min(INNER_W, xScale(expectedMoveBand.spot)))}
                y={zeroY - 9}
                fill={BLUE}
                fontSize={9}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
              >
                {"±1σ EM"}
              </text>
            </g>
          )}

          {/* ── Layer 1: Profit zone fill — the profitable-at-expiration region (teal).
               Uses the @exp curve, not T+0: a calendar's T+0 curve sits at ~$0 so its
               profit band is an invisible sliver near spot; the @exp tent's positive area
               (between the @exp breakevens) is the meaningful "where you make money" zone. ── */}
          {toggles.showProfitZone && expirationCurve.length > 0 && (
            <path
              data-testid="profit-zone"
              d={buildProfitZonePath(expirationCurve, xScale, zeroY, clampY)}
              fill={`rgba(38,166,154,0.13)`}
            />
          )}

          {/* ── Layer 2: T+0 teal gradient fill above zero ───────────────── */}
          {todayCurve.length > 0 && (
            <>
              <path
                d={buildFillPath(todayCurve, xScale, zeroY, "above", clampY)}
                fill="url(#payoff-teal-fill)"
              />
              <path
                d={buildFillPath(todayCurve, xScale, zeroY, "below", clampY)}
                fill="url(#payoff-coral-fill)"
              />
            </>
          )}

          {/* ── Layer 3: Dated fan curves (+7/+14/+21d) ───────────────────── */}
          {toggles.showFan &&
            fanCurves.map(({ days, curve }, i) => (
              <LinePath
                key={days}
                data={[...curve]}
                x={getX}
                y={clampY}
                curve={curveMonotoneX}
                stroke={FAN_COLORS[i] ?? "#6f86c9"}
                strokeWidth={1.3}
                opacity={0.85}
              />
            ))}

          {/* ── Layer 4: Expiration tent dashed ──────────────────────────── */}
          {toggles.showExpiration && expirationCurve.length > 0 && (
            <LinePath
              data-testid="net-book-exp-curve"
              data={[...expirationCurve]}
              x={getX}
              y={clampY}
              curve={curveMonotoneX}
              stroke={expirationCurveColor}
              strokeWidth={1.4}
              strokeDasharray="5 4"
              opacity={0.7}
              strokeOpacity={netBookStrokeOpacity}
            />
          )}

          {/* ── Layer 5: Roll overlay amber ───────────────────────────────── */}
          {rollCurve !== null && rollCurve.length > 0 && (
            <LinePath
              data={[...rollCurve]}
              x={getX}
              y={clampY}
              curve={curveMonotoneX}
              stroke={AMBER}
              strokeWidth={2}
            />
          )}

          {/* ── ⊕-compare overlay: single dashed amber front-expiry curve for a
               second candidate (ANLZ-02) — own layer, distinct from rollCurve ── */}
          {compareCurve !== null && compareCurve.length > 0 && (
            <LinePath
              data-testid="compare-curve"
              data={[...compareCurve]}
              x={getX}
              y={clampY}
              curve={curveMonotoneX}
              stroke={compareCurveColor}
              strokeWidth={1.6}
              strokeDasharray="5 4"
            />
          )}

          {/* ── Layer 6: GEX wall lines — edge-pinned into the x-domain.
              No in-chart text label (KISS collision fix, DEFECT-1): the dashed
              line is the only in-chart signal, so it can never pile up into
              unreadable overlapping text. An off-domain wall renders a single
              glyph arrow in a fixed per-series lane (EDGE_ARROW_LANE_Y) instead
              — the exact numeric value lives in the Key Levels panel /
              ScenarioStrip / crosshair tooltip. ── */}
          {toggles.showWalls && gex !== null && (
            <>
              {(
                [
                  { key: "put", value: gex.putWall, color: CORAL },
                  { key: "call", value: gex.callWall, color: TEAL },
                  { key: "flip", value: gex.flip, color: AMBER },
                ] as const
              ).map(({ key, value, color }) => {
                if (value === null) return null;
                const marker = pinMarker(value, xScale, domain);
                return (
                  <g key={`wall-${key}`}>
                    <line
                      data-testid={`wall-line-${key}`}
                      x1={marker.x}
                      y1={0}
                      x2={marker.x}
                      y2={INNER_H}
                      stroke={color}
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      opacity={0.6}
                    />
                    {marker.clampedTo !== null && (
                      <text
                        x={marker.clampedTo === "max" ? marker.x - 3 : marker.x + 3}
                        y={EDGE_ARROW_LANE_Y[key]}
                        fill={color}
                        fontSize={9}
                        fontFamily="JetBrains Mono, monospace"
                        textAnchor={marker.clampedTo === "max" ? "end" : "start"}
                      >
                        {marker.clampedTo === "max" ? "›" : "‹"}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          )}

          {/* ── Breakeven markers: short red vertical bars at the zero line (TOS-style).
              The values are labeled in the pill row above the chart, so there is no
              in-chart text to overlap when strikes sit close together. ── */}
          {toggles.showExpiration &&
            beExp.map((x) => (
              <line
                key={`be-exp-${x}`}
                data-testid="be-marker-exp"
                x1={xScale(x)}
                y1={zeroY - 9}
                x2={xScale(x)}
                y2={zeroY + 9}
                stroke={CORAL}
                strokeWidth={2}
              />
            ))}
          {beToday.map((x) => (
            <line
              key={`be-t0-${x}`}
              data-testid="be-marker-t0"
              x1={xScale(x)}
              y1={zeroY - 9}
              x2={xScale(x)}
              y2={zeroY + 9}
              stroke={CORAL}
              strokeWidth={2}
              opacity={0.75}
            />
          ))}

          {/* ── Layer 2 (on top): T+0 curve violet #a78bfa ───────────────── */}
          {todayCurve.length > 0 && (
            <LinePath
              data-testid="net-book-t0-curve"
              data={[...todayCurve]}
              x={getX}
              y={clampY}
              curve={curveMonotoneX}
              stroke={todayCurveColor}
              strokeWidth={2.6}
              filter="url(#payoff-glow)"
              strokeOpacity={netBookStrokeOpacity}
            />
          )}

          {/* ── Highlighted single-position curves (D-05) — same stroke tokens
               as the net-book curves above, drawn at full emphasis on top ──── */}
          {highlightActive &&
            highlightedExpirationCurve !== null &&
            highlightedExpirationCurve.length > 0 && (
              <LinePath
                data-testid="highlighted-exp-curve"
                data={[...highlightedExpirationCurve]}
                x={getX}
                y={clampY}
                curve={curveMonotoneX}
                stroke={GRAY_MUTED}
                strokeWidth={1.4}
                strokeDasharray="5 4"
              />
            )}
          {highlightActive &&
            highlightedTodayCurve !== null &&
            highlightedTodayCurve.length > 0 && (
              <LinePath
                data-testid="highlighted-t0-curve"
                data={[...highlightedTodayCurve]}
                x={getX}
                y={clampY}
                curve={curveMonotoneX}
                stroke={VIOLET}
                strokeWidth={2.6}
                filter="url(#payoff-glow)"
              />
            )}

          {/* ── Layer 9: Spot vertical blue line + dot ────────────────────── */}
          <line
            x1={spotX}
            y1={0}
            x2={spotX}
            y2={INNER_H}
            stroke={BLUE}
            strokeWidth={1.1}
          />
          <circle
            cx={spotX}
            cy={Math.max(0, Math.min(INNER_H, yScale(plAtSpot)))}
            r={4.5}
            fill={BLUE}
            stroke="#0a0e14"
            strokeWidth={2}
          />

          {/* ── Crosshair ────────────────────────────────────────────────── */}
          {crosshair !== null && (
            <line
              x1={crosshair.x - PAD.left}
              y1={0}
              x2={crosshair.x - PAD.left}
              y2={INNER_H}
              stroke={CROSSHAIR_COLOR}
              strokeWidth={1}
              opacity={0.3}
              pointerEvents="none"
            />
          )}
        </Group>
      </svg>

      {/* Fixed tooltip (HTML, not SVG) */}
      {crosshair !== null && (
        <div
          data-testid="payoff-tooltip"
          style={{
            position: "absolute",
            top: 8,
            // crosshair.x is in viewBox units [0, SVG_W]; the tooltip is an HTML
            // element positioned in CSS pixels within the container, which fills
            // the rendered SVG width. Map viewBox → rendered px so the tooltip
            // tracks the crosshair line at any SVG render width (WR-03).
            left: Math.min(
              (crosshair.x / SVG_W) * crosshair.renderedWidth + 14,
              crosshair.renderedWidth - 180,
            ),
            pointerEvents: "none",
            background: "rgba(8,11,16,0.97)",
            border: "1px solid #27313f",
            borderRadius: 8,
            padding: "7px 9px",
            fontSize: 10.5,
            fontFamily: "JetBrains Mono, monospace",
            minWidth: 150,
            boxShadow: "0 8px 26px rgba(0,0,0,0.55)",
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 3,
              color: crosshair.pl >= 0 ? TEAL : CORAL,
            }}
          >
            {fmtPl(crosshair.pl)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
            <span>SPX</span>
            <span style={{ color: "#d6dbe4", fontWeight: 500 }}>{Math.round(crosshair.spot)}</span>
          </div>
          {gex !== null && gex.putWall !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
              <span>vs put wall</span>
              <span style={{ color: "#d6dbe4", fontWeight: 500 }}>
                {((crosshair.spot - gex.putWall) >= 0 ? "+" : "") + (crosshair.spot - gex.putWall).toFixed(0)}
              </span>
            </div>
          )}
          {gex !== null && gex.callWall !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
              <span>vs call wall</span>
              <span style={{ color: "#d6dbe4", fontWeight: 500 }}>
                {((crosshair.spot - gex.callWall) >= 0 ? "+" : "") + (crosshair.spot - gex.callWall).toFixed(0)}
              </span>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/** Build the profit zone fill path (where pl >= 0) */
function buildProfitZonePath(
  curve: ReadonlyArray<PayoffPoint>,
  xScale: (v: number) => number,
  zeroY: number,
  clampY: (p: PayoffPoint) => number,
): string {
  if (curve.length === 0) return "";

  // Build the entire curve as a filled region clamped to [zeroY, top]
  let inProfit = false;
  let regionStart = 0;
  let path = "";

  for (let i = 0; i < curve.length; i++) {
    const p = curve[i];
    if (p === undefined) continue;
    const isProfitable = p.pl >= 0;

    if (isProfitable && !inProfit) {
      inProfit = true;
      regionStart = xScale(p.spot);
      path += `M${regionStart} ${zeroY}`;
    }

    if (inProfit) {
      const y = Math.min(clampY(p), zeroY);
      path += `L${xScale(p.spot)} ${y}`;
    }

    if (!isProfitable && inProfit) {
      inProfit = false;
      const prev = curve[i - 1];
      if (prev !== undefined) {
        path += `L${xScale(prev.spot)} ${zeroY}Z `;
      }
    }
  }

  if (inProfit) {
    const last = curve[curve.length - 1];
    if (last !== undefined) {
      path += `L${xScale(last.spot)} ${zeroY}Z`;
    }
  }

  return path;
}

/** Build fill path above or below zero line */
function buildFillPath(
  curve: ReadonlyArray<PayoffPoint>,
  xScale: (v: number) => number,
  zeroY: number,
  side: "above" | "below",
  clampY: (p: PayoffPoint) => number,
): string {
  if (curve.length === 0) return "";
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) return "";

  let d = `M${xScale(first.spot)} ${zeroY}`;
  for (const p of curve) {
    const y =
      side === "above"
        ? Math.min(clampY(p), zeroY) // above = y <= zeroY
        : Math.max(clampY(p), zeroY); // below = y >= zeroY
    d += `L${xScale(p.spot)} ${y}`;
  }
  d += `L${xScale(last.spot)} ${zeroY}Z`;
  return d;
}

// Re-export for testing
export { findZeroCrossings, computeYDomain, buildXTicks, buildXScale, INNER_W };

// AreaClosed/AreaStack imported for potential future gradient-fill usage per visx pattern
// (referenced in the import list above — removing would lose access to these visx APIs)
