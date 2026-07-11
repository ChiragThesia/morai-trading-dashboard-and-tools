/**
 * PayoffChart — Recharts payoff / risk profile chart with full 9-layer z-order
 *
 * UI-SPEC "Analyzer screen" payoff chart — locked z-order (bottom to top, proven
 * empirically in 33-01: Recharts renders by per-type zIndex band, JSX order only
 * breaks ties WITHIN a band — Area=100, Line/ReferenceLine=400, ReferenceDot=600):
 *   1. Profit zone teal fill (where @exp P&L >= 0)
 *   2. T+0 curve: #a78bfa (violet), 2.6px, teal-above / coral-below gradient fill
 *   3. Dated fan curves (+7/+14/+21d) when toggled
 *   4. Expiration tent dashed when toggled
 *   5. Amber roll overlay / ANLZ-02 compare overlay when active
 *   6. GEX wall lines when toggled (structurally clipped, not hand-pinned)
 *   7. PayoffChartMarks split in two (CR-01, 33-REVIEW): the EM band stays in a
 *      <Customized> layer, which paints before every zIndex band by construction —
 *      correct, it was already under every curve pre-migration. The BE-marker bars
 *      and edge-arrow glyphs paint ON TOP of layers 1-6 in the pre-migration
 *      component (only the final T+0 stroke painted over them), so they're wired
 *      through a <ZIndexLayer zIndex={DefaultZIndexes.line}> placed after the wall
 *      lines in JSX — same shared zIndex-400 band as Line/ReferenceLine, JSX order
 *      is the tiebreak (33-01), landing them above walls/fills/fan/tent/roll/compare
 *      and below only the final T+0 curve.
 *   8. T+0 curve (on top of walls/highlighted overlays within the shared zIndex-400 band)
 *   9. Spot vertical blue line + circle dot at T+0 value
 *
 * TOS-stable y-axis: computed once from the expiration profile on position-set change.
 * "fit Y" resets on demand.
 * Crosshair: native Recharts <Tooltip> + typed content component reading the payload.
 *
 * Chart library: Recharts (shadcn ChartContainer) — migrated off @visx, Phase 33 (33-06).
 * No any/as/!.
 */

import { useMemo, useEffect, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  ReferenceLine,
  ReferenceDot,
  XAxis,
  YAxis,
  Tooltip,
  Customized,
  ZIndexLayer,
  DefaultZIndexes,
  useXAxisScale,
  useYAxisScale,
  usePlotArea,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { ChartContainer } from "../ui/chart.tsx";
import type { ChartConfig } from "../ui/chart.tsx";
import { findZeroCrossings } from "../../lib/scenario-engine.ts";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";
import { PayoffChartMarks, EDGE_ARROW_LANE_Y } from "./PayoffChartMarks.tsx";
import type { PayoffChartMarksGex, PayoffChartMarksProps } from "./PayoffChartMarks.tsx";

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
const AXIS_LABEL = "#566273";
const MONO = "JetBrains Mono, monospace";

const FAN_COLORS = ["#7c6fd6", "#6f86c9", "#5f93b8"] as const;

const chartConfig = {} satisfies ChartConfig;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pure 0-based linear scale, [domain.min, domain.max] -> [0, innerWidth]. No @visx/scale
 * (Pitfall 7 excludes @visx from the removed set, but this migration retires it from
 * PayoffChart specifically). Contract UNCHANGED: PayoffChartMarks.test.tsx (33-02) imports
 * this directly and depends on the 0-based (not margin-offset) output.
 */
function buildXScale(innerWidth: number, domain: { readonly min: number; readonly max: number }) {
  const span = domain.max - domain.min;
  return (value: number): number => ((value - domain.min) / span) * innerWidth;
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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ─── Hook-driven plot geometry (single source of truth, catch #20) ─────────────

interface PlotScales {
  xScale: (v: number) => number;
  yScale: (v: number) => number;
  innerWidth: number;
  innerHeight: number;
  zeroY: number;
  plotX: number;
  plotY: number;
}

/**
 * Custom-layer geometry read from recharts' OWN axis scales + plot area via hooks
 * inside the chart tree (TermStructureChart's GuardTag pattern) — never
 * buildXScale/buildYScale over the SVG_W/SVG_H constants. In the real browser
 * ResponsiveContainer resizes the chart away from those constants, so every
 * constant-space mark (grid labels, BE bars, EM band, edge arrows) drifted off the
 * recharts-rendered curves while jsdom (always exactly SVG_W x SVG_H) stayed green
 * (live-UAT catch #20, 2026-07-10). Returns 0-based scales matching
 * PayoffChartMarks' contract; callers wrap output in translate(plotX, plotY).
 */
function usePlotScales(): PlotScales | null {
  const xAxisScale = useXAxisScale();
  const yAxisScale = useYAxisScale();
  const plotArea = usePlotArea();
  if (xAxisScale === undefined || yAxisScale === undefined || plotArea === undefined) return null;
  const xScale = (v: number): number => (xAxisScale(v) ?? 0) - plotArea.x;
  const yScale = (v: number): number => (yAxisScale(v) ?? 0) - plotArea.y;
  return {
    xScale,
    yScale,
    innerWidth: plotArea.width,
    innerHeight: plotArea.height,
    zeroY: yScale(0),
    plotX: plotArea.x,
    plotY: plotArea.y,
  };
}

/** In-tree adapter feeding PayoffChartMarks its 0-based scales from usePlotScales. */
function PayoffMarksLayer({
  domain,
  expectedMoveBand,
  beTodayStrikes,
  beExpStrikes,
  gex,
}: Omit<PayoffChartMarksProps, "xScale" | "innerWidth" | "zeroY">): React.ReactElement | null {
  const scales = usePlotScales();
  if (scales === null) return null;
  return (
    <g transform={`translate(${scales.plotX},${scales.plotY})`}>
      <PayoffChartMarks
        xScale={scales.xScale}
        innerWidth={scales.innerWidth}
        zeroY={scales.zeroY}
        domain={domain}
        expectedMoveBand={expectedMoveBand}
        beTodayStrikes={beTodayStrikes}
        beExpStrikes={beExpStrikes}
        gex={gex}
      />
    </g>
  );
}

// ─── Grid chrome (hand-rendered, D-01/Pitfall-driven) ──────────────────────────

interface PayoffChartGridProps {
  gridTickValues: ReadonlyArray<number>;
  xTicks: ReadonlyArray<number>;
  /** Breakeven spots rendered as colored numbers in the x-axis tick lane. */
  beToday: ReadonlyArray<number>;
  beExp: ReadonlyArray<number>;
  beTodayColor: string;
  beExpColor: string;
}

/** Grid tick labels within this many px of a BE number are dropped (BE wins the lane). */
const BE_LABEL_CLEARANCE_PX = 30;

/**
 * Grid lines + axis tick labels, hand-rendered (not native Recharts XAxis/YAxis tick
 * chrome): native tick LABEL text renders through a zIndex portal (the "label" band,
 * DefaultZIndexes.label=2000) that is not registered/populated synchronously on first
 * render under jsdom, and the axis's own auto-computed label width silently expands the
 * margin beyond the declared PAD (breaks the "plot area = SVG dims minus PAD" contract
 * Phase 30/this migration relies on). XAxis/YAxis stay in the tree fully hidden
 * (tick/tickLine/axisLine all off, width/height 0) purely to give Area/Line/ReferenceLine
 * their numeric scale + domain + the auto clipPath — this component draws the SAME visual
 * grid the pre-migration component drew, positioned by usePlotScales (catch #20).
 */
function PayoffChartGrid({
  gridTickValues,
  xTicks,
  beToday,
  beExp,
  beTodayColor,
  beExpColor,
}: PayoffChartGridProps): React.ReactElement | null {
  const scales = usePlotScales();
  if (scales === null) return null;
  const beLabels = [
    ...beToday.map((v) => ({ v, color: beTodayColor, tid: "be-axis-label-t0" })),
    ...beExp.map((v) => ({ v, color: beExpColor, tid: "be-axis-label-exp" })),
  ].filter(({ v }) => {
    const px = scales.xScale(v);
    return px >= 0 && px <= scales.innerWidth;
  });
  const bePx = beLabels.map(({ v }) => scales.xScale(v));
  const keptXTicks = xTicks.filter((s) =>
    bePx.every((px) => Math.abs(px - scales.xScale(s)) > BE_LABEL_CLEARANCE_PX),
  );
  return (
    <g transform={`translate(${scales.plotX},${scales.plotY})`}>
      {gridTickValues.map((value) => {
        const y = scales.yScale(value);
        return (
          <g key={value}>
            <line x1={0} y1={y} x2={scales.innerWidth} y2={y} stroke={GRID_LINE} strokeWidth={1} />
            <text x={-6} y={y + 3} fill={AXIS_LABEL} fontSize={10} textAnchor="end" fontFamily={MONO}>
              {value === 0 ? "$0" : fmtPl(value)}
            </text>
          </g>
        );
      })}
      {keptXTicks.map((s) => (
        <text
          key={s}
          x={scales.xScale(s)}
          y={scales.innerHeight + 16}
          fill={AXIS_LABEL}
          fontSize={10}
          textAnchor="middle"
          fontFamily={MONO}
        >
          {s}
        </text>
      ))}
      {beLabels.map(({ v, color, tid }) => (
        <text
          key={`${tid}-${v}`}
          data-testid={tid}
          x={scales.xScale(v)}
          y={scales.innerHeight + 16}
          fill={color}
          fontSize={10}
          fontWeight={600}
          textAnchor="middle"
          fontFamily={MONO}
        >
          {Math.round(v)}
        </text>
      ))}
    </g>
  );
}

// ─── Tooltip content (D-10, D-12: native Tooltip + typed content, no manual crosshair) ──

interface PayoffTooltipContentProps extends TooltipContentProps<number, "today"> {
  gex: PayoffChartGex | null;
}

/**
 * Typed Tooltip content (D-12: concrete generics, no any/as). Reads the hovered spot
 * straight from `label` (the numeric x-axis value under the cursor) and the P&L from
 * the "today" curve's payload entry — the direct replacement for the ~50-line manual
 * localPoint/getBoundingClientRect/scale-invert block (D-10).
 */
export function PayoffTooltipContent({
  active,
  payload,
  label,
  gex,
}: PayoffTooltipContentProps): React.ReactElement | null {
  if (!active || payload.length === 0) return null;
  const entry = payload.find((p) => p.name === "today") ?? payload[0];
  if (entry === undefined || !isFiniteNumber(entry.value) || !isFiniteNumber(label)) return null;

  const pl = entry.value;
  const hoveredSpot = label;

  return (
    <div
      data-testid="payoff-tooltip"
      style={{
        background: "rgba(8,11,16,0.97)",
        border: "1px solid #27313f",
        borderRadius: 8,
        padding: "7px 9px",
        fontSize: 10.5,
        fontFamily: MONO,
        minWidth: 150,
        boxShadow: "0 8px 26px rgba(0,0,0,0.55)",
      }}
    >
      <div
        style={{
          fontFamily: "Space Grotesk, sans-serif",
          fontWeight: 700,
          fontSize: 13,
          marginBottom: 3,
          color: pl >= 0 ? TEAL : CORAL,
        }}
      >
        {fmtPl(pl)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
        <span>SPX</span>
        <span style={{ color: "#d6dbe4", fontWeight: 500 }}>{Math.round(hoveredSpot)}</span>
      </div>
      {gex !== null && gex.putWall !== null && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
          <span>vs put wall</span>
          <span style={{ color: "#d6dbe4", fontWeight: 500 }}>
            {((hoveredSpot - gex.putWall) >= 0 ? "+" : "") + (hoveredSpot - gex.putWall).toFixed(0)}
          </span>
        </div>
      )}
      {gex !== null && gex.callWall !== null && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#7b8696" }}>
          <span>vs call wall</span>
          <span style={{ color: "#d6dbe4", fontWeight: 500 }}>
            {((hoveredSpot - gex.callWall) >= 0 ? "+" : "") + (hoveredSpot - gex.callWall).toFixed(0)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PayoffChart — renders the full 9-layer locked z-order Recharts payoff chart.
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

  // Find crossings
  const beExp = useMemo(() => findZeroCrossings(expirationCurve), [expirationCurve]);
  const beToday = useMemo(() => findZeroCrossings(todayCurve), [todayCurve]);

  // P&L at current spot (for the spot dot's y position)
  const plAtSpot = useMemo(() => {
    const nearest = todayCurve.reduce<PayoffPoint | null>((best, p) => {
      if (best === null) return p;
      return Math.abs(p.spot - spot) < Math.abs(best.spot - spot) ? p : best;
    }, null);
    return nearest?.pl ?? 0;
  }, [todayCurve, spot]);

  // Y-axis grid ticks: round-step multiples anchored at $0 (2026-07-10 request) —
  // replaces 6 evenly-spaced arbitrary values (e.g. "-$362") that never labeled the
  // zero line. Ticks are multiples of a round step, so 0 is always a tick whenever
  // the domain straddles it.
  const gridTickValues = useMemo(() => {
    const rawStep = (yDomain.hi - yDomain.lo) / 6;
    const roundSteps = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const step = roundSteps.find((s) => s >= rawStep) ?? roundSteps[roundSteps.length - 1] ?? rawStep;
    const values: number[] = [];
    for (let v = Math.ceil(yDomain.lo / step) * step; v <= yDomain.hi; v += step) values.push(v);
    return values;
  }, [yDomain]);

  // X-axis ticks: derived round numbers from the live domain prop (OVW-04, D-01) —
  // replaces a hardcoded literal array that could drift from the chart's own scale.
  const xTicks = useMemo(() => buildXTicks(domain.min, domain.max), [domain]);

  // PayoffChartMarks (33-02) keeps its plain-closure xScale contract, but the closures
  // now come from usePlotScales() INSIDE the chart tree (PayoffMarksLayer adapter) —
  // recharts' own axis scales + plot area, alive to ResponsiveContainer resizes
  // (catch #20). Paint order unchanged: <Customized> for the EM band (before every
  // zIndex band), ZIndexLayer for BE bars/edge arrows (CR-01).
  const marksGex: PayoffChartMarksGex | null = toggles.showWalls ? gex : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", flex: 1, minHeight: 300 }}>
      {/* Breakeven pills — readable readouts above the chart (violet = today, gray = @exp),
          so the values never overlap inside the plot. The in-chart markers are the red bars
          rendered by PayoffChartMarks. */}
      {(beToday.length > 0 || (toggles.showExpiration && beExp.length > 0)) && (
        <div
          data-testid="be-pills"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
            fontFamily: MONO,
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

        <ChartContainer
          config={chartConfig}
          style={{ width: "100%", aspectRatio: `${SVG_W} / ${SVG_H}` }}
          className="aspect-auto"
        >
          {/* Definite aspect-ratio, never height:100%: the old <svg viewBox> sized itself
              by intrinsic ratio when the percentage-height chain broke; a div has no such
              fallback, so height:100% collapsed to 0 in the real browser and the chart
              never mounted (live-UAT regression 2026-07-10). Explicit width/height on
              ComposedChart below: required under jsdom (mockResponsiveContainer strips
              ResponsiveContainerContext, per 33-03); the real browser's ResponsiveContainer
              measures this container and takes priority, so the chart stays fluid. */}
          <ComposedChart
            width={SVG_W}
            height={SVG_H}
            margin={PAD}
            accessibilityLayer
            role="img"
            aria-label="Risk profile payoff chart"
          >
            <defs>
              <linearGradient id="payoff-teal-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={TEAL} stopOpacity={0.34} />
                <stop offset="1" stopColor={TEAL} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="payoff-coral-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={CORAL} stopOpacity={0} />
                <stop offset="1" stopColor={CORAL} stopOpacity={0.34} />
              </linearGradient>
              <linearGradient id="payoff-profit-zone-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={TEAL} stopOpacity={0.13} />
                <stop offset="1" stopColor={TEAL} stopOpacity={0} />
              </linearGradient>
              <filter id="payoff-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Fully hidden: establishes the numeric scale + domain + auto clipPath that
                Area/Line/ReferenceLine consume. width=0/height=0 keeps the plot area
                exactly SVG dims minus PAD (no auto-expansion for label measurement) —
                visible grid lines + tick text are hand-rendered by PayoffChartGrid below. */}
            <XAxis
              type="number"
              dataKey="spot"
              domain={[domain.min, domain.max]}
              allowDataOverflow
              height={0}
              tick={false}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              domain={[yDomain.lo, yDomain.hi]}
              allowDataOverflow
              width={0}
              tick={false}
              tickLine={false}
              axisLine={false}
            />

            <PayoffChartGrid
              gridTickValues={gridTickValues}
              xTicks={xTicks}
              beToday={beToday}
              beExp={toggles.showExpiration ? beExp : []}
              beTodayColor={todayCurveColor}
              beExpColor={expirationCurveColor}
            />

            <ReferenceLine y={0} stroke={ZERO_LINE} strokeWidth={1.1} />

            {/* EM band only — before every curve layer by construction (Customized paints
                before every zIndex band regardless of JSX position), matching the
                pre-migration component's under-everything EM-band position (33-06). BE bars
                and edge arrows are suppressed here (empty strikes / null gex) — they render
                further below in a ZIndexLayer (CR-01, see top-of-file comment). */}
            <Customized
              component={
                <PayoffMarksLayer
                  domain={domain}
                  expectedMoveBand={expectedMoveBand}
                  beTodayStrikes={[]}
                  beExpStrikes={[]}
                  gex={null}
                />
              }
            />

            {/* ── Layer 1: Profit zone fill — the profitable-at-expiration region (teal).
                 Uses the @exp curve, not T+0: a calendar's T+0 curve sits at ~$0 so its
                 profit band is an invisible sliver near spot; the @exp tent's positive area
                 is the meaningful "where you make money" zone. ── */}
            {toggles.showProfitZone && expirationCurve.length > 0 && (
              <Area
                data-testid="profit-zone"
                data={[...expirationCurve]}
                dataKey="pl"
                type="monotone"
                baseValue={0}
                stroke="none"
                fill="url(#payoff-profit-zone-fill)"
                isAnimationActive={false}
              />
            )}

            {/* ── Layer 2: T+0 teal/coral gradient fill above/below zero ────────────── */}
            {todayCurve.length > 0 && (
              <>
                <Area
                  data={[...todayCurve]}
                  dataKey="pl"
                  type="monotone"
                  baseValue={0}
                  stroke="none"
                  fill="url(#payoff-teal-fill)"
                  isAnimationActive={false}
                />
                <Area
                  data={[...todayCurve]}
                  dataKey="pl"
                  type="monotone"
                  baseValue={0}
                  stroke="none"
                  fill="url(#payoff-coral-fill)"
                  isAnimationActive={false}
                />
              </>
            )}

            {/* ── Layer 3: Dated fan curves (+7/+14/+21d) ────────────────────────────── */}
            {toggles.showFan &&
              fanCurves.map(({ days, curve }, i) => (
                <Line
                  key={days}
                  data={[...curve]}
                  dataKey="pl"
                  type="monotone"
                  dot={false}
                  stroke={FAN_COLORS[i] ?? "#6f86c9"}
                  strokeWidth={1.3}
                  strokeOpacity={0.85}
                  isAnimationActive={false}
                />
              ))}

            {/* ── Layer 4: Expiration tent dashed ────────────────────────────────────── */}
            {toggles.showExpiration && expirationCurve.length > 0 && (
              <Line
                data-testid="net-book-exp-curve"
                data={[...expirationCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={expirationCurveColor}
                strokeWidth={1.4}
                strokeDasharray="5 4"
                strokeOpacity={netBookStrokeOpacity}
                isAnimationActive={false}
              />
            )}

            {/* ── Layer 5: Roll overlay amber ────────────────────────────────────────── */}
            {rollCurve !== null && rollCurve.length > 0 && (
              <Line
                data={[...rollCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={AMBER}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}

            {/* ── ⊕-compare overlay: single dashed amber front-expiry curve for a
                 second candidate (ANLZ-02) — own layer, distinct from rollCurve ── */}
            {compareCurve !== null && compareCurve.length > 0 && (
              <Line
                data-testid="compare-curve"
                data={[...compareCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={compareCurveColor}
                strokeWidth={1.6}
                strokeDasharray="5 4"
                isAnimationActive={false}
              />
            )}

            {/* ── Layer 6: GEX wall lines — structurally clipped to the plot area
                 (ifOverflow="hidden" + the axis's own allowDataOverflow clipPath),
                 replacing the hand pinMarker clamp. No in-chart text label (KISS
                 collision fix, DEFECT-1) — PayoffChartMarks renders the off-domain
                 edge-arrow glyph instead. ── */}
            {toggles.showWalls &&
              gex !== null &&
              (
                [
                  { key: "put", value: gex.putWall, color: CORAL },
                  { key: "call", value: gex.callWall, color: TEAL },
                  { key: "flip", value: gex.flip, color: AMBER },
                ] as const
              ).map(({ key, value, color }) => {
                if (value === null) return null;
                return (
                  <ReferenceLine
                    key={`wall-${key}`}
                    data-testid={`wall-line-${key}`}
                    x={value}
                    ifOverflow="hidden"
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    opacity={0.6}
                  />
                );
              })}

            {/* CR-01 (33-REVIEW): BE-marker bars + edge-arrow glyphs, placed after the wall
                lines in JSX so they share the ReferenceLine/Line zIndex-400 band and win the
                JSX-order tiebreak (33-01) — on top of the profit-zone/T+0 fills (zIndex 100,
                a different band, always painted first) and on top of the
                fan/tent/roll/compare curves + wall lines (same band, earlier in JSX), under
                only the final T+0 stroke below. ZIndexLayer applies no transform of its own
                (same as Customized/Layer, 33-06), hence the translate wrapper. */}
            <ZIndexLayer zIndex={DefaultZIndexes.line}>
              <PayoffMarksLayer
                domain={domain}
                expectedMoveBand={null}
                beTodayStrikes={beToday}
                beExpStrikes={beExp}
                gex={marksGex}
              />
            </ZIndexLayer>

            {/* ── Layer 2 (on top): T+0 curve violet #a78bfa ─────────────────────────── */}
            {todayCurve.length > 0 && (
              <Line
                data-testid="net-book-t0-curve"
                name="today"
                data={[...todayCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={todayCurveColor}
                strokeWidth={2.6}
                strokeOpacity={netBookStrokeOpacity}
                style={{ filter: "url(#payoff-glow)" }}
                isAnimationActive={false}
              />
            )}

            {/* ── Highlighted single-position curves (D-05) — same stroke tokens
                 as the net-book curves above, drawn at full emphasis on top ──────── */}
            {highlightActive && highlightedExpirationCurve !== null && highlightedExpirationCurve.length > 0 && (
              <Line
                data-testid="highlighted-exp-curve"
                data={[...highlightedExpirationCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={GRAY_MUTED}
                strokeWidth={1.4}
                strokeDasharray="5 4"
                isAnimationActive={false}
              />
            )}
            {highlightActive && highlightedTodayCurve !== null && highlightedTodayCurve.length > 0 && (
              <Line
                data-testid="highlighted-t0-curve"
                data={[...highlightedTodayCurve]}
                dataKey="pl"
                type="monotone"
                dot={false}
                stroke={VIOLET}
                strokeWidth={2.6}
                style={{ filter: "url(#payoff-glow)" }}
                isAnimationActive={false}
              />
            )}

            {/* ── Layer 9: Spot vertical blue line + dot ─────────────────────────────── */}
            <ReferenceLine data-testid="spot-line" x={spot} ifOverflow="hidden" stroke={BLUE} strokeWidth={1.1} />
            <ReferenceDot
              data-testid="spot-dot"
              x={spot}
              y={plAtSpot}
              ifOverflow="hidden"
              r={4.5}
              fill={BLUE}
              stroke="#0a0e14"
              strokeWidth={2}
            />

            <Tooltip
              cursor={{ stroke: CROSSHAIR_COLOR, strokeWidth: 1, opacity: 0.3 }}
              content={<PayoffTooltipContent gex={gex} />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}

// EDGE_ARROW_LANE_Y re-exported (not redeclared) so PayoffChart.test.tsx's existing
// import keeps resolving — PayoffChartMarks owns the constant (33-02).
export { EDGE_ARROW_LANE_Y };

// Re-export for testing
export { findZeroCrossings, computeYDomain, buildXTicks, buildXScale, INNER_W };
