import { useCallback, useMemo, useRef, useState } from "react";
import { LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { localPoint } from "@visx/event";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * LifecycleChart — D-08 stacked-panel lifecycle engine (JRNL-01, phase 22 plan 05).
 *
 * Replaces the retired 3-tab + scrubber engine with FIVE stacked regions sharing ONE
 * time axis (D-04): P&L attribution hero (D-01) -> vol & term structure (D-02) -> four
 * signed greek small-multiples (D-03) -> price vs strike. Feed gaps (isGap) and an
 * inverted forward-vol guard render as honest line breaks, never interpolated (D-05).
 *
 * Chart library: visx (LinePath's `defined` accessor drives every gap break — locked
 * by 22-UI-SPEC.md). Stacked-area fills have no first-class gap-aware visx primitive,
 * so their paths are hand-built (ported from mockups/journal-lifecycle-v3.html's
 * areaSeg/flush helper) and flush at each gap boundary rather than bridging it.
 *
 * Crosshair + tooltip mapping reuses PayoffChart.tsx's exact
 * localPoint -> svgRect -> scaleX -> logicalX technique verbatim (see handlePointerMove).
 *
 * Color constants below map 1:1 to 22-UI-SPEC.md's "Chart Series Color Map" — no hex
 * value appears outside that table (mirrors PayoffChart.tsx's own module-level block).
 * No any/as/!.
 */

// ─── Color constants (locked 1:1 to 22-UI-SPEC.md Chart Series Color Map) ───────
const COLOR_UP = "#26a69a"; // theta (attribution + greek)
const COLOR_BLUE = "#5b9cf6"; // vega (attribution + greek)
const COLOR_VIOLET = "#a78bfa"; // delta-gamma (attribution), delta (greek), strike ref
const COLOR_FAINT = "#3a4453"; // residual band fill
const COLOR_DIM = "#566273"; // residual legend swatch, faint labels
const COLOR_TXT = "#d6dbe4"; // net P&L line, front IV
const COLOR_AMBER = "#f0b429"; // forward vol — the edge (D-02)
const COLOR_MUTED = "#7b8696"; // back IV, price/spot
const COLOR_DOWN = "#ef5350"; // gamma
const COLOR_LINE2 = "#27313f"; // zero baselines, crosshair

// ─── Layout constants (D-08 / 22-UI-SPEC.md "Layout & Chart Geometry") ──────────
const SVG_W = 840;
const SVG_H = 700;
const CHART_X0 = 54;
const CHART_X1 = SVG_W - 56;

const TOP_MARGIN = 40;
const LEGEND_H = 20;
const HERO_H = 210;
const VOL_H = 120;
const GREEK_PANEL_H = 28;
const GREEK_GAP = 8;
const PRICE_H = 60;

const HERO_Y = TOP_MARGIN + LEGEND_H;
const VOL_Y = HERO_Y + HERO_H;
const GREEKS_Y = VOL_Y + VOL_H;
const GREEK_STRIDE = GREEK_PANEL_H + GREEK_GAP;
const GREEK_BLOCK_H = 4 * GREEK_STRIDE;
const PRICE_Y = GREEKS_Y + GREEK_BLOCK_H;
const CROSSHAIR_TOP = HERO_Y;
const CROSSHAIR_BOTTOM = PRICE_Y + PRICE_H;

const GREEK_KEYS = ["delta", "gamma", "theta", "vega"] as const;
type GreekKey = (typeof GREEK_KEYS)[number];

const GREEK_PANEL_Y: Record<GreekKey, number> = {
  delta: GREEKS_Y,
  gamma: GREEKS_Y + GREEK_STRIDE,
  theta: GREEKS_Y + 2 * GREEK_STRIDE,
  vega: GREEKS_Y + 3 * GREEK_STRIDE,
};
const GREEK_COLOR: Record<GreekKey, string> = {
  delta: COLOR_VIOLET,
  gamma: COLOR_DOWN,
  theta: COLOR_UP,
  vega: COLOR_BLUE,
};
const GREEK_LABEL: Record<GreekKey, string> = {
  delta: "delta",
  gamma: "gamma",
  theta: "theta/day",
  vega: "vega",
};

const HERO_KEYS = ["theta", "vega", "deltaGamma", "residual"] as const;
type HeroKey = (typeof HERO_KEYS)[number];

const HERO_COLOR: Record<HeroKey, string> = {
  theta: COLOR_UP,
  vega: COLOR_BLUE,
  deltaGamma: COLOR_VIOLET,
  residual: COLOR_FAINT,
};
const HERO_LEGEND_LABEL: Record<HeroKey, string> = {
  theta: "theta",
  vega: "vega",
  deltaGamma: "delta-gamma",
  residual: "residual",
};

type LifecycleSnapshot = LifecycleResponse["snapshots"][number];

export interface LifecycleChartProps {
  /** Enriched journal snapshots for the selected calendar (forward vol + attribution). */
  readonly snapshots: LifecycleResponse["snapshots"];
  /** Calendar strike, for the optional dashed price-panel reference line (wired by 22-06). */
  readonly strike?: number;
  /** Fires the hovered snapshot index on crosshair move, and `null` on leave (rail sync). */
  readonly onCrosshairChange?: (index: number | null) => void;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────────

function parseNum(value: string): number {
  return parseFloat(value);
}

/** Day label ("Jun 12") from a UTC ISO datetime. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

/** Indices where the calendar day changes from the prior snapshot (x-axis date labels). */
function dayBoundaryIndices(snapshots: LifecycleResponse["snapshots"]): ReadonlyArray<number> {
  const indices: number[] = [0];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    if (prev !== undefined && curr !== undefined) {
      const prevDay = new Date(prev.time).toISOString().slice(0, 10);
      const currDay = new Date(curr.time).toISOString().slice(0, 10);
      if (prevDay !== currDay) indices.push(i);
    }
  }
  return indices;
}

interface DerivedPoint {
  readonly isGap: boolean;
  readonly heroValues: Record<HeroKey, number>;
  readonly net: number;
  readonly frontIv: number;
  readonly backIv: number;
  readonly forwardVol: number | null;
  readonly forwardVolBroken: boolean;
  readonly spot: number;
  readonly greeks: Record<GreekKey, number>;
  readonly dteFront: number;
  readonly dteBack: number;
  readonly time: string;
}

/** Map the raw enriched snapshot series into typed numeric points for every panel. */
function derivePoints(snapshots: LifecycleResponse["snapshots"]): ReadonlyArray<DerivedPoint> {
  return snapshots.map((s) => {
    const forwardVol = s.forwardVolGuard === "inverted" ? null : s.forwardVol;
    const heroValues: Record<HeroKey, number> = {
      theta: s.cumTheta ?? 0,
      vega: s.cumVega ?? 0,
      deltaGamma: s.cumDeltaGamma ?? 0,
      residual: s.cumResidual ?? 0,
    };
    return {
      isGap: s.isGap,
      heroValues,
      net: heroValues.theta + heroValues.vega + heroValues.deltaGamma + heroValues.residual,
      frontIv: parseNum(s.frontIv),
      backIv: parseNum(s.backIv),
      forwardVol,
      forwardVolBroken: s.isGap || forwardVol === null,
      spot: parseNum(s.spot),
      greeks: {
        delta: parseNum(s.netDelta),
        gamma: parseNum(s.netGamma),
        theta: parseNum(s.netTheta),
        vega: parseNum(s.netVega),
      },
      dteFront: s.dteFront,
      dteBack: s.dteBack,
      time: s.time,
    };
  });
}

/** Inclusive [lo, hi] domain from raw values with a flat additive pad on each side. */
function domainWithPad(values: ReadonlyArray<number>, pad: number): { readonly lo: number; readonly hi: number } {
  if (values.length === 0) return { lo: -1, hi: 1 };
  return { lo: Math.min(...values) - pad, hi: Math.max(...values) + pad };
}

type StackBand = { readonly low: number; readonly high: number };

/**
 * Diverging (bipolar) stack at a single point in time: positive-valued series stack
 * upward from zero, negative-valued series stack downward from zero, in series order —
 * generalizes d3's stackOffsetDiverging to per-point sign flips (a calendar's theta/
 * vega/delta-gamma/residual buckets can each flip sign over the trade's life).
 */
function stackDiverging(values: ReadonlyArray<number>): ReadonlyArray<StackBand> {
  let posRunning = 0;
  let negRunning = 0;
  return values.map((v) => {
    if (v >= 0) {
      const low = posRunning;
      posRunning += v;
      return { low, high: posRunning };
    }
    const high = negRunning;
    negRunning += v;
    return { low: negRunning, high };
  });
}

type Band = { readonly x: number; readonly yTop: number; readonly yBottom: number };

/**
 * Gap-aware stacked-area fill: flushes (closes) the polygon at each gap boundary
 * rather than bridging across it — ported from journal-lifecycle-v3.html's areaSeg/
 * flush helper (D-05, T-22-12). Returns one `M...Z` subpath per contiguous defined run.
 */
function buildGapAwareBandPath(bands: ReadonlyArray<Band | null>): string {
  const runs: Band[][] = [];
  let current: Band[] = [];
  for (const b of bands) {
    if (b === null) {
      if (current.length > 1) runs.push(current);
      current = [];
      continue;
    }
    current.push(b);
  }
  if (current.length > 1) runs.push(current);

  return runs
    .map((run) => {
      const top = run.map((p) => `${p.x.toFixed(2)} ${p.yTop.toFixed(2)}`).join(" L");
      const bottom = [...run]
        .reverse()
        .map((p) => `${p.x.toFixed(2)} ${p.yBottom.toFixed(2)}`)
        .join(" L");
      return `M${top} L${bottom} Z`;
    })
    .join(" ");
}

function fmtSignedDollars(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

interface CrosshairState {
  readonly index: number;
  readonly x: number;
  readonly renderedWidth: number;
}

export function LifecycleChart({
  snapshots,
  strike,
  onCrosshairChange,
}: LifecycleChartProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const [crosshair, setCrosshair] = useState<CrosshairState | null>(null);

  const points = useMemo(() => derivePoints(snapshots), [snapshots]);
  const n = points.length;

  const xScale = useMemo(
    () =>
      scalePoint({
        domain: points.map((_, i) => i),
        range: [CHART_X0, CHART_X1],
        padding: 0,
      }),
    [points],
  );
  const getX = useCallback((i: number): number => xScale(i) ?? CHART_X0, [xScale]);

  // ── HERO: diverging stack of theta/vega/deltaGamma/residual + the net line ──────
  const heroBands = useMemo(
    () =>
      points.map((p) => (p.isGap ? null : stackDiverging(HERO_KEYS.map((key) => p.heroValues[key])))),
    [points],
  );

  const heroDomain = useMemo(() => {
    const vals: number[] = [];
    for (const bands of heroBands) {
      if (bands === null) continue;
      for (const b of bands) vals.push(b.low, b.high);
    }
    for (const p of points) {
      if (!p.isGap) vals.push(p.net);
    }
    return domainWithPad(vals, 10);
  }, [heroBands, points]);

  const heroScaleY = useMemo(
    () => scaleLinear({ domain: [heroDomain.lo, heroDomain.hi], range: [HERO_Y + HERO_H, HERO_Y] }),
    [heroDomain],
  );
  const heroZeroY = heroScaleY(0);

  const heroBandPaths: Record<HeroKey, string> = useMemo(() => {
    const result: Record<HeroKey, string> = {
      theta: "",
      vega: "",
      deltaGamma: "",
      residual: "",
    };
    HERO_KEYS.forEach((key, seriesIndex) => {
      const bandPoints = heroBands.map((bands, i) => {
        if (bands === null) return null;
        const b = bands[seriesIndex];
        if (b === undefined) return null;
        return { x: getX(i), yTop: heroScaleY(b.high), yBottom: heroScaleY(b.low) };
      });
      result[key] = buildGapAwareBandPath(bandPoints);
    });
    return result;
  }, [heroBands, getX, heroScaleY]);

  const netLineData = useMemo(() => points.map((p, i) => ({ i, net: p.net, isGap: p.isGap })), [points]);

  // ── VOL & TERM STRUCTURE: front/back IV + forward vol (the edge, D-02) ──────────
  const volLineData = useMemo(
    () =>
      points.map((p, i) => ({
        i,
        frontIv: p.frontIv,
        backIv: p.backIv,
        forwardVol: p.forwardVol ?? 0,
        isGap: p.isGap,
        forwardVolBroken: p.forwardVolBroken,
      })),
    [points],
  );
  const volDomain = useMemo(() => {
    const vals: number[] = [];
    for (const p of points) {
      if (p.isGap) continue;
      vals.push(p.frontIv, p.backIv);
      if (p.forwardVol !== null) vals.push(p.forwardVol);
    }
    return domainWithPad(vals, 0.25);
  }, [points]);
  const volScaleY = useMemo(
    () => scaleLinear({ domain: [volDomain.lo, volDomain.hi], range: [VOL_Y + VOL_H, VOL_Y] }),
    [volDomain],
  );

  // ── GREEKS: four signed small-multiples, each on its own zero-baselined scale ────
  const greekLineData = useMemo(
    () =>
      GREEK_KEYS.reduce<Record<GreekKey, Array<{ i: number; v: number; isGap: boolean }>>>(
        (acc, key) => {
          acc[key] = points.map((p, i) => ({ i, v: p.greeks[key], isGap: p.isGap }));
          return acc;
        },
        { delta: [], gamma: [], theta: [], vega: [] },
      ),
    [points],
  );
  const greekScaleY: Record<GreekKey, ReturnType<typeof scaleLinear<number>>> = useMemo(() => {
    function scaleFor(key: GreekKey): ReturnType<typeof scaleLinear<number>> {
      const vals = points.filter((p) => !p.isGap).map((p) => p.greeks[key]);
      const raw = domainWithPad(vals, 0);
      const pad = Math.max((raw.hi - raw.lo) * 0.2, 0.001);
      const lo = Math.min(raw.lo - pad, 0);
      const hi = Math.max(raw.hi + pad, 0);
      const y = GREEK_PANEL_Y[key];
      return scaleLinear({ domain: [lo, hi], range: [y + GREEK_PANEL_H, y] });
    }
    return {
      delta: scaleFor("delta"),
      gamma: scaleFor("gamma"),
      theta: scaleFor("theta"),
      vega: scaleFor("vega"),
    };
  }, [points]);
  const greekBandPaths: Record<GreekKey, string> = useMemo(() => {
    function pathFor(key: GreekKey): string {
      const scaleY = greekScaleY[key];
      const zeroY = scaleY(0);
      const bandPoints = points.map((p, i) =>
        p.isGap ? null : { x: getX(i), yTop: scaleY(p.greeks[key]), yBottom: zeroY },
      );
      return buildGapAwareBandPath(bandPoints);
    }
    return {
      delta: pathFor("delta"),
      gamma: pathFor("gamma"),
      theta: pathFor("theta"),
      vega: pathFor("vega"),
    };
  }, [points, greekScaleY, getX]);

  // ── PRICE vs STRIKE ───────────────────────────────────────────────────────────────
  const priceLineData = useMemo(() => points.map((p, i) => ({ i, spot: p.spot, isGap: p.isGap })), [points]);
  const priceDomain = useMemo(() => {
    const vals = points.filter((p) => !p.isGap).map((p) => p.spot);
    if (strike !== undefined) vals.push(strike);
    return domainWithPad(vals, 6);
  }, [points, strike]);
  const priceScaleY = useMemo(
    () => scaleLinear({ domain: [priceDomain.lo, priceDomain.hi], range: [PRICE_Y + PRICE_H, PRICE_Y] }),
    [priceDomain],
  );

  const dayTicks = useMemo(() => dayBoundaryIndices(snapshots), [snapshots]);

  // ── Crosshair mapping — verbatim PayoffChart.tsx technique (localPoint -> svgRect
  //    -> scaleX -> logicalX), then snapped to the nearest shared x-scale index ──────
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (svg === null || n === 0) return;
      const point = localPoint(svg, event);
      if (point === null) return;

      const svgRect = svg.getBoundingClientRect();
      const scaleX = SVG_W / svgRect.width;
      const logicalX = point.x * scaleX;

      if (logicalX < CHART_X0 || logicalX > CHART_X1) {
        setCrosshair(null);
        onCrosshairChange?.(null);
        return;
      }

      const frac = (logicalX - CHART_X0) / (CHART_X1 - CHART_X0);
      const index = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));

      setCrosshair({ index, x: getX(index), renderedWidth: svgRect.width });
      onCrosshairChange?.(index);
    },
    [n, getX, onCrosshairChange],
  );

  const handlePointerLeave = useCallback(() => {
    setCrosshair(null);
    onCrosshairChange?.(null);
  }, [onCrosshairChange]);

  const hoveredPoint = crosshair !== null ? points[crosshair.index] : undefined;
  const hoveredSnapshot = crosshair !== null ? snapshots[crosshair.index] : undefined;

  const tooltipLeft =
    crosshair !== null
      ? Math.min((crosshair.x / SVG_W) * crosshair.renderedWidth + 14, crosshair.renderedWidth - 190)
      : 0;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        aria-label="Calendar lifecycle: P&L attribution, vol term structure, greeks, price over time"
        role="img"
      >
        {/* ── Title/legend band + P&L ATTRIBUTION hero ─────────────────────────── */}
        <text
          x={CHART_X0}
          y={HERO_Y - 8}
          fill={COLOR_TXT}
          fontSize={10}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          letterSpacing="0.12em"
        >
          P&amp;L ATTRIBUTION
        </text>
        {HERO_KEYS.map((key, i) => (
          <g key={key} data-testid={`hero-legend-${key}`} transform={`translate(${CHART_X0 + 150 + i * 78}, ${HERO_Y - 19})`}>
            <rect width={9} height={9} rx={2} fill={key === "residual" ? COLOR_DIM : HERO_COLOR[key]} />
            <text
              x={13}
              y={8}
              fill={COLOR_MUTED}
              fontSize={8.5}
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
            >
              {HERO_LEGEND_LABEL[key]}
            </text>
          </g>
        ))}
        <line
          x1={CHART_X0}
          y1={heroZeroY}
          x2={CHART_X1}
          y2={heroZeroY}
          stroke={COLOR_LINE2}
          strokeWidth={1}
        />
        {HERO_KEYS.map((key) => (
          <path
            key={key}
            data-testid={`hero-band-${key}`}
            d={heroBandPaths[key]}
            fill={key === "residual" ? COLOR_FAINT : HERO_COLOR[key]}
            fillOpacity={key === "residual" ? 0.5 : 0.3}
            stroke="none"
          />
        ))}
        <LinePath
          data-testid="hero-net-line"
          data={netLineData}
          x={(d) => getX(d.i)}
          y={(d) => heroScaleY(d.net)}
          defined={(d) => !d.isGap}
          curve={curveLinear}
          stroke={COLOR_TXT}
          strokeWidth={2.4}
          fill="none"
        />

        {/* ── VOL & TERM STRUCTURE ──────────────────────────────────────────────── */}
        <text
          x={CHART_X0}
          y={VOL_Y - 9}
          fill={COLOR_AMBER}
          fontSize={10}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          letterSpacing="0.12em"
        >
          VOL &amp; TERM STRUCTURE
        </text>
        <LinePath
          data-testid="vol-line-back"
          data={volLineData}
          x={(d) => getX(d.i)}
          y={(d) => volScaleY(d.backIv)}
          defined={(d) => !d.isGap}
          curve={curveLinear}
          stroke={COLOR_MUTED}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          fill="none"
        />
        <LinePath
          data-testid="vol-line-front"
          data={volLineData}
          x={(d) => getX(d.i)}
          y={(d) => volScaleY(d.frontIv)}
          defined={(d) => !d.isGap}
          curve={curveLinear}
          stroke={COLOR_TXT}
          strokeWidth={1.6}
          fill="none"
        />
        <LinePath
          data-testid="vol-line-forward"
          data={volLineData}
          x={(d) => getX(d.i)}
          y={(d) => volScaleY(d.forwardVol)}
          defined={(d) => !d.forwardVolBroken}
          curve={curveLinear}
          stroke={COLOR_AMBER}
          strokeWidth={2.6}
          fill="none"
        />

        {/* ── GREEKS — four signed small-multiples ──────────────────────────────── */}
        <text
          x={CHART_X0}
          y={GREEKS_Y - 9}
          fill={COLOR_MUTED}
          fontSize={10}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          letterSpacing="0.12em"
        >
          GREEKS
        </text>
        {GREEK_KEYS.map((key) => {
          const y = GREEK_PANEL_Y[key];
          const zeroY = greekScaleY[key](0);
          return (
            <g key={key}>
              <line
                data-testid={`greek-zero-${key}`}
                x1={CHART_X0}
                y1={zeroY}
                x2={CHART_X1}
                y2={zeroY}
                stroke={COLOR_LINE2}
                strokeWidth={1}
              />
              <path
                data-testid={`greek-fill-${key}`}
                d={greekBandPaths[key]}
                fill={GREEK_COLOR[key]}
                fillOpacity={0.16}
                stroke="none"
              />
              <LinePath
                data-testid={`greek-line-${key}`}
                data={greekLineData[key]}
                x={(d) => getX(d.i)}
                y={(d) => greekScaleY[key](d.v)}
                defined={(d) => !d.isGap}
                curve={curveLinear}
                stroke={GREEK_COLOR[key]}
                strokeWidth={1.5}
                fill="none"
              />
              <text
                x={CHART_X0 - 6}
                y={y + GREEK_PANEL_H * 0.5 + 3}
                fill={COLOR_MUTED}
                fontSize={8.5}
                textAnchor="end"
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
              >
                {GREEK_LABEL[key]}
              </text>
            </g>
          );
        })}

        {/* ── PRICE vs STRIKE ────────────────────────────────────────────────────── */}
        <text
          x={CHART_X0}
          y={PRICE_Y - 9}
          fill={COLOR_MUTED}
          fontSize={10}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          letterSpacing="0.12em"
        >
          PRICE vs STRIKE
        </text>
        {strike !== undefined && (
          <line
            data-testid="price-line-strike"
            x1={CHART_X0}
            y1={priceScaleY(strike)}
            x2={CHART_X1}
            y2={priceScaleY(strike)}
            stroke={COLOR_VIOLET}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        )}
        <LinePath
          data-testid="price-line-spot"
          data={priceLineData}
          x={(d) => getX(d.i)}
          y={(d) => priceScaleY(d.spot)}
          defined={(d) => !d.isGap}
          curve={curveLinear}
          stroke={COLOR_MUTED}
          strokeWidth={1.5}
          fill="none"
        />

        {/* ── X-axis date-label band ─────────────────────────────────────────────── */}
        {dayTicks.map((i) => {
          const snap = snapshots[i];
          if (snap === undefined) return null;
          return (
            <text
              key={i}
              x={getX(i)}
              y={PRICE_Y + PRICE_H + 16}
              fill={i === n - 1 ? COLOR_MUTED : COLOR_DIM}
              fontSize={9}
              textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
            >
              {dayLabel(snap.time)}
            </text>
          );
        })}

        {/* ── Shared crosshair — spans the full stacked panel height ─────────────── */}
        {crosshair !== null && (
          <line
            data-testid="lifecycle-crosshair"
            x1={crosshair.x}
            y1={CROSSHAIR_TOP}
            x2={crosshair.x}
            y2={CROSSHAIR_BOTTOM}
            stroke={COLOR_LINE2}
            strokeWidth={1}
            opacity={0.5}
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Fixed HTML tooltip (not SVG) — reuses PayoffChart's positioning formula */}
      {crosshair !== null && hoveredPoint !== undefined && hoveredSnapshot !== undefined && (
        <div
          data-testid="lifecycle-tooltip"
          style={{
            position: "absolute",
            top: 8,
            left: tooltipLeft,
            pointerEvents: "none",
            background: "rgba(8,11,16,0.97)",
            border: `1px solid ${COLOR_LINE2}`,
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
            data-testid="tooltip-row-header"
            style={{ color: COLOR_DIM, fontSize: 9.5, marginBottom: 5 }}
          >
            {dayLabel(hoveredSnapshot.time)} &middot; {hoveredPoint.dteFront}d / {hoveredPoint.dteBack}d left
          </div>
          {hoveredPoint.isGap ? (
            <div data-testid="tooltip-row-gap" style={{ color: COLOR_DIM }}>
              feed lapsed &mdash; no data
            </div>
          ) : (
            <>
              <div
                data-testid="tooltip-row-net"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_TXT, fontWeight: 700 }}
              >
                <span>net P&amp;L</span>
                <span>{fmtSignedDollars(hoveredPoint.net)}</span>
              </div>
              <div
                data-testid="tooltip-row-theta"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_UP }}
              >
                <span>theta</span>
                <span>{fmtSignedDollars(hoveredPoint.heroValues.theta)}</span>
              </div>
              <div
                data-testid="tooltip-row-vega"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_BLUE }}
              >
                <span>vega</span>
                <span>{fmtSignedDollars(hoveredPoint.heroValues.vega)}</span>
              </div>
              <div
                data-testid="tooltip-row-deltaGamma"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_VIOLET }}
              >
                <span>delta-gamma</span>
                <span>{fmtSignedDollars(hoveredPoint.heroValues.deltaGamma)}</span>
              </div>
              <div
                data-testid="tooltip-row-forwardVol"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_AMBER }}
              >
                <span>forward vol</span>
                <span>{hoveredPoint.forwardVol !== null ? `${hoveredPoint.forwardVol.toFixed(2)}%` : "—"}</span>
              </div>
              <div
                data-testid="tooltip-row-spot"
                style={{ display: "flex", justifyContent: "space-between", gap: 14, color: COLOR_MUTED }}
              >
                <span>SPX</span>
                <span>{hoveredPoint.spot.toFixed(0)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
