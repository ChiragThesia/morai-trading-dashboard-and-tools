import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, ReferenceLine, CartesianGrid } from "recharts";
import { ChartContainer } from "../ui/chart.tsx";
import type { ChartConfig } from "../ui/chart.tsx";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GexBars — GEX by-strike horizontal bar chart with GEX/OI/Volume toggle.
 *
 * UI-SPEC "Market screen" + "Analyzer right panel":
 *   - Horizontal bar chart over strikes[]
 *   - Toggle: GEX / OI wall / Volume (shadcn Tabs)
 *   - GEX mode:    teal bars right of center (positive) / coral left of center (negative)
 *   - OI wall mode: call teal right / put coral left (coi/poi)
 *   - Volume mode:  amber bars from left (vol)
 *   - Put wall + call wall + spot horizontal dashed reference lines drawn over bars
 *
 * Chart library: Recharts (shadcn ChartContainer), migrated off echarts-for-react — Phase 33.
 * No any/as/! — all types from GexSnapshotEntry.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type GexMode = "gex" | "oi" | "volume";

interface GexBarsProps {
  /** Full strike detail from gexSnapshotEntry */
  strikes: GexSnapshotEntry["strikes"];
  /** Current spot price (dashed reference line) */
  spot: number;
  /** Call wall strike price; null if no dominant call wall */
  callWall: GexSnapshotEntry["callWall"];
  /** Put wall strike price; null if no dominant put wall */
  putWall: GexSnapshotEntry["putWall"];
  /** Chart width in pixels (default: 100%) */
  width?: string | number;
  /** Chart height in pixels (default 260) */
  height?: number;
  /**
   * Locked metric. When set, the chart renders that one metric with NO tab picker
   * (used to show GEX / OI wall / Volume as three separate charts). When omitted, the
   * chart manages its own metric via the tab picker (default).
   */
  mode?: GexMode;
  /** Strike window: ATM ± N strikes, or "all" (default). */
  range?: StrikeRange;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL = "#26a69a";
const CORAL = "#ef5350";
const BLUE = "#5b9cf6";
const AMBER = "#f0b429";
const ZERO_LINE = "#27313f";
const TICK_STYLE = { fill: "#566273", fontSize: 9 };

// jsdom/test fallback width when `width` is the responsive "100%" default — inert in the
// browser, where the real ResponsiveContainer measures and overrides it (33-03/33-04 finding).
const FALLBACK_WIDTH = 720;

// Units regression: domain dollarGamma outputs $Bn/1% ALREADY — a second /1e9
// collapsed every axis label to "0.0B". Exported for the units regression test.
export function fmtBn(v: number): string {
  return `${v.toFixed(1)}B`;
}

/** Strike-window range: ATM ± N strikes, or "all". */
export type StrikeRange = number | "all";

/**
 * Window the strike list to the N strikes nearest to spot on each side (ATM ± N).
 * "all" returns the full list. Keeps the rows nearest spot regardless of strike spacing.
 */
export function windowStrikes(
  strikes: GexSnapshotEntry["strikes"],
  spot: number,
  range: StrikeRange,
): GexSnapshotEntry["strikes"] {
  if (range === "all" || strikes.length === 0) return strikes;
  // Index of the strike closest to spot (ATM).
  let atm = 0;
  let best = Infinity;
  strikes.forEach((s, i) => {
    const d = Math.abs(s.k - spot);
    if (d < best) {
      best = d;
      atm = i;
    }
  });
  const lo = Math.max(0, atm - range);
  const hi = Math.min(strikes.length, atm + range + 1);
  return strikes.slice(lo, hi);
}

/**
 * Nearest visible strike to a price. The spot reference line sits on the category (strike)
 * y-axis, which only renders a ReferenceLine at an exact category match — spot is a
 * continuous price that rarely equals a strike exactly, so it's snapped to the nearest
 * visible row (same nearest-match technique windowStrikes uses to find ATM).
 */
function nearestStrikeK(strikes: GexSnapshotEntry["strikes"], price: number): number | null {
  if (strikes.length === 0) return null;
  let nearestK = 0;
  let best = Infinity;
  strikes.forEach((s) => {
    const d = Math.abs(s.k - price);
    if (d < best) {
      best = d;
      nearestK = s.k;
    }
  });
  return nearestK;
}

const chartConfig = {
  gex: { label: "GEX", color: TEAL },
} satisfies ChartConfig;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GexBars — Recharts horizontal bar chart over strikes[] with GEX/OI/Volume toggle.
 *
 * `<BarChart layout="vertical">` is Recharts' naming for horizontal bars: numeric value
 * XAxis, category strike YAxis (RESEARCH D-14 / Pitfall 8).
 */
export function GexBars({
  strikes,
  spot,
  callWall,
  putWall,
  width = "100%",
  height = 260,
  mode: modeProp,
  range = "all",
}: GexBarsProps): React.ReactElement {
  const [internalMode, setMode] = useState<GexMode>("gex");
  // Locked when a mode prop is supplied (three-chart layout); otherwise tab-controlled.
  const mode = modeProp ?? internalMode;
  const showTabs = modeProp === undefined;

  const chart = useMemo(() => {
    const windowed = windowStrikes(strikes, spot, range);

    if (mode === "oi") {
      const data = windowed.map((s) => ({ k: s.k, coi: s.coi, negPoi: -s.poi }));
      const maxCall = Math.max(0, ...windowed.map((s) => s.coi));
      const maxPut = Math.max(0, ...windowed.map((s) => s.poi));
      const domain: [number, number] = [-maxPut, maxCall];
      return { kind: "oi" as const, data, domain, windowed };
    }

    if (mode === "volume") {
      const data = windowed.map((s) => ({ k: s.k, vol: s.vol }));
      const maxVol = Math.max(0, ...windowed.map((s) => s.vol));
      const domain: [number, number] = [0, maxVol];
      return { kind: "volume" as const, data, domain, windowed };
    }

    const data = windowed.map((s) => ({ k: s.k, gex: s.gex }));
    const values = windowed.map((s) => s.gex);
    const domain: [number, number] = [Math.min(0, ...values), Math.max(0, ...values)];
    return { kind: "gex" as const, data, domain, windowed };
  }, [strikes, spot, range, mode]);

  const spotRowK = nearestStrikeK(chart.windowed, spot);
  const svgWidth = typeof width === "number" ? width : FALLBACK_WIDTH;

  // base-ui Tabs.Root passes the new tab value (string); narrow to GexMode before set.
  const handleModeChange = (value: string): void => {
    if (value === "gex" || value === "oi" || value === "volume") {
      setMode(value);
    }
  };

  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Metric tabs: GEX / OI wall / Volume — hidden when a single mode is locked */}
      {showTabs && (
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList aria-label="GEX chart mode">
            <TabsTrigger value="gex" aria-label="GEX mode" data-testid="toggle-gex">
              GEX
            </TabsTrigger>
            <TabsTrigger value="oi" aria-label="OI wall mode" data-testid="toggle-oi">
              OI wall
            </TabsTrigger>
            <TabsTrigger value="volume" aria-label="Volume mode" data-testid="toggle-volume">
              Volume
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <ChartContainer config={chartConfig} style={{ width: "100%", height }}>
        {/* Explicit width/height fallback on the inner chart: ChartContainer's real
            ResponsiveContainer takes priority when it measures a real size (browser), but
            falls back to these under jsdom, where sizing context isn't available
            (33-03/33-04 finding). */}
        <BarChart
          layout="vertical"
          data={chart.data}
          width={svgWidth}
          height={height}
          margin={{ top: 12, right: 24, bottom: 12, left: 8 }}
        >
          <CartesianGrid horizontal={false} stroke={ZERO_LINE} strokeDasharray="3 3" />
          <XAxis
            type="number"
            domain={chart.domain}
            allowDataOverflow
            tickFormatter={mode === "gex" ? fmtBn : undefined}
            tick={TICK_STYLE}
            axisLine={{ stroke: ZERO_LINE }}
          />
          <YAxis type="category" dataKey="k" tick={TICK_STYLE} axisLine={{ stroke: ZERO_LINE }} />

          {chart.kind === "gex" && (
            <Bar dataKey="gex" isAnimationActive={false}>
              {chart.data.map((d) => (
                <Cell key={d.k} fill={d.gex >= 0 ? TEAL : CORAL} />
              ))}
            </Bar>
          )}
          {chart.kind === "oi" && (
            <>
              <Bar dataKey="coi" stackId="oi" fill={TEAL} isAnimationActive={false} />
              <Bar dataKey="negPoi" stackId="oi" fill={CORAL} isAnimationActive={false} />
            </>
          )}
          {chart.kind === "volume" && <Bar dataKey="vol" fill={AMBER} isAnimationActive={false} />}

          {putWall !== null && (
            <ReferenceLine
              y={putWall}
              className="gex-put-wall-line"
              stroke={CORAL}
              strokeDasharray="4 3"
              label={{ value: `pw ${putWall}`, position: "insideTopLeft", fill: CORAL, fontSize: 9 }}
            />
          )}
          {callWall !== null && (
            <ReferenceLine
              y={callWall}
              className="gex-call-wall-line"
              stroke={TEAL}
              strokeDasharray="4 3"
              label={{ value: `cw ${callWall}`, position: "insideTopLeft", fill: TEAL, fontSize: 9 }}
            />
          )}
          {spotRowK !== null && (
            <ReferenceLine
              y={spotRowK}
              className="gex-spot-line"
              stroke={BLUE}
              strokeDasharray="4 3"
              label={{ value: `spot ${spot.toFixed(0)}`, position: "insideTopRight", fill: BLUE, fontSize: 9 }}
            />
          )}
        </BarChart>
      </ChartContainer>
    </div>
  );
}
