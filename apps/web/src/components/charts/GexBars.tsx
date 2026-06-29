import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GexBars — GEX by-strike horizontal bar chart with GEX/OI/Volume toggle.
 *
 * UI-SPEC "Market screen" + "Analyzer right panel":
 *   - Horizontal bar chart over strikes[]
 *   - Toggle: GEX / OI wall / Volume (shadcn ToggleGroup)
 *   - GEX mode:    teal bars right of center (positive) / coral left of center (negative)
 *   - OI wall mode: call teal right / put coral left (coi/poi)
 *   - Volume mode:  blue bars from left (vol)
 *   - Put wall + call wall + spot horizontal dashed reference lines drawn over bars
 *   - Transparent background; echarts-for-react owns resize/dispose — no lifecycle hand-roll.
 *
 * Chart library: Apache ECharts via echarts-for-react (locked by UI-SPEC).
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL = "#26a69a";
const CORAL = "#ef5350";
const BLUE = "#5b9cf6";
const AMBER = "#f0b429";
const ZERO_LINE = "#27313f";

function fmtBn(v: number): string {
  const bn = v / 1_000_000_000;
  return `${bn.toFixed(1)}B`;
}

// ─── Build ECharts option per mode ───────────────────────────────────────────

function buildOption(
  strikes: GexSnapshotEntry["strikes"],
  mode: GexMode,
  spot: number,
  callWall: GexSnapshotEntry["callWall"],
  putWall: GexSnapshotEntry["putWall"],
): object {
  const labels = strikes.map((s) => s.k.toString());

  // Reference mark lines (spot, call wall, put wall)
  const markLines: object[] = [
    {
      name: "Spot",
      xAxis: spot,
      lineStyle: { color: BLUE, type: "dashed", width: 1 },
      label: { show: true, formatter: `spot ${spot.toFixed(0)}`, position: "insideEndTop", color: BLUE, fontSize: 9 },
    },
  ];

  if (callWall !== null) {
    markLines.push({
      name: "Call Wall",
      xAxis: callWall,
      lineStyle: { color: TEAL, type: "dashed", width: 1 },
      label: { show: true, formatter: `cw ${callWall}`, position: "insideStartTop", color: TEAL, fontSize: 9 },
    });
  }

  if (putWall !== null) {
    markLines.push({
      name: "Put Wall",
      xAxis: putWall,
      lineStyle: { color: CORAL, type: "dashed", width: 1 },
      label: { show: true, formatter: `pw ${putWall}`, position: "insideStartTop", color: CORAL, fontSize: 9 },
    });
  }

  // The reference lines are on a value axis (x-axis for horizontal bars),
  // so they are horizontal lines on the chart. For horizontal bar charts in ECharts,
  // x=value axis and y=category axis. MarkLine xAxis = value axis position.

  if (mode === "gex") {
    const data = strikes.map((s) => ({
      value: s.gex / 1_000_000_000, // convert to $Bn
      itemStyle: {
        color: s.gex >= 0 ? TEAL : CORAL,
      },
    }));

    return {
      backgroundColor: "transparent",
      grid: { left: 60, right: 24, top: 12, bottom: 12 },
      xAxis: {
        type: "value",
        axisLine: { lineStyle: { color: ZERO_LINE } },
        splitLine: { lineStyle: { color: ZERO_LINE, type: "dashed" } },
        axisLabel: { color: "#566273", fontSize: 9, formatter: (v: number) => fmtBn(v) },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#566273", fontSize: 9 },
        axisLine: { lineStyle: { color: ZERO_LINE } },
      },
      series: [
        {
          type: "bar",
          data,
          markLine: {
            symbol: "none",
            data: markLines.map((ml) => [{ ...ml, coord: [ml, 0] }, { coord: [ml, labels.length - 1] }]),
          },
        },
      ],
    };
  }

  if (mode === "oi") {
    const callData = strikes.map((s) => ({
      value: s.coi,
      itemStyle: { color: TEAL },
    }));
    const putData = strikes.map((s) => ({
      value: -s.poi, // negative to put bars on the left
      itemStyle: { color: CORAL },
    }));

    return {
      backgroundColor: "transparent",
      grid: { left: 60, right: 24, top: 12, bottom: 12 },
      xAxis: {
        type: "value",
        axisLine: { lineStyle: { color: ZERO_LINE } },
        splitLine: { lineStyle: { color: ZERO_LINE, type: "dashed" } },
        axisLabel: { color: "#566273", fontSize: 9 },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#566273", fontSize: 9 },
        axisLine: { lineStyle: { color: ZERO_LINE } },
      },
      series: [
        {
          name: "Call OI",
          type: "bar",
          stack: "oi",
          data: callData,
        },
        {
          name: "Put OI",
          type: "bar",
          stack: "oi",
          data: putData,
        },
      ],
    };
  }

  // mode === "volume"
  const volData = strikes.map((s) => ({
    value: s.vol,
    itemStyle: { color: AMBER },
  }));

  return {
    backgroundColor: "transparent",
    grid: { left: 60, right: 24, top: 12, bottom: 12 },
    xAxis: {
      type: "value",
      axisLine: { lineStyle: { color: ZERO_LINE } },
      splitLine: { lineStyle: { color: ZERO_LINE, type: "dashed" } },
      axisLabel: { color: "#566273", fontSize: 9 },
    },
    yAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: "#566273", fontSize: 9 },
      axisLine: { lineStyle: { color: ZERO_LINE } },
    },
    series: [
      {
        type: "bar",
        data: volData,
      },
    ],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GexBars — ECharts horizontal bar chart over strikes[] with GEX/OI/Volume toggle.
 *
 * Uses echarts-for-react; DOES NOT hand-roll init/resize/dispose — ReactECharts owns lifecycle.
 */
export function GexBars({
  strikes,
  spot,
  callWall,
  putWall,
  width = "100%",
  height = 260,
}: GexBarsProps): React.ReactElement {
  const [mode, setMode] = useState<GexMode>("gex");

  const option = useMemo(
    () => buildOption(strikes, mode, spot, callWall, putWall),
    [strikes, mode, spot, callWall, putWall],
  );

  // base-ui Tabs.Root passes the new tab value (string); narrow to GexMode before set.
  const handleModeChange = (value: string): void => {
    if (value === "gex" || value === "oi" || value === "volume") {
      setMode(value);
    }
  };

  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Metric tabs: GEX / OI wall / Volume */}
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

      {/* ECharts bar chart — echarts-for-react owns resize/dispose */}
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </div>
  );
}
