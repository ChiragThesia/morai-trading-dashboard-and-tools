import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GexByExpiry — GEX by-expiration vertical bar chart.
 *
 * UI-SPEC "Market screen":
 *   - Apache ECharts vertical bar chart, 360×200px.
 *   - All bars in coral (negative gamma dominant per-expiry).
 *   - Date labels on x-axis.
 *   - Value labels on bars.
 *
 * Data: gexSnapshotEntry.byExpiry[{date, gex}] — already aggregated per expiry on the server.
 * No recompute in the browser (D-01).
 *
 * Chart library: Apache ECharts via echarts-for-react (locked by UI-SPEC).
 * No any/as/! — all types from GexSnapshotEntry.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface GexByExpiryProps {
  /** Per-expiry aggregate GEX from gexSnapshotEntry */
  byExpiry: GexSnapshotEntry["byExpiry"];
  /** Chart width in pixels or CSS string (default 100%) */
  width?: string | number;
  /** Chart height in pixels (default 200) */
  height?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CORAL = "#ef5350";
const ZERO_LINE = "#27313f";

// Units regression: domain dollarGamma outputs $Bn/1% ALREADY — no second /1e9.
function fmtBn(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}B`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GexByExpiry — ECharts vertical bar chart over byExpiry[].
 *
 * All bars rendered in coral per UI-SPEC (negative-gamma dominant per expiry).
 * Uses echarts-for-react; does NOT hand-roll init/resize/dispose.
 */
export function GexByExpiry({
  byExpiry,
  width = "100%",
  height = 200,
}: GexByExpiryProps): React.ReactElement {
  const option = useMemo(() => {
    const dates = byExpiry.map((e) => e.date);
    const values = byExpiry.map((e) => ({
      value: e.gex, // already $Bn/1% units from the domain
      itemStyle: { color: CORAL },
      label: {
        show: true,
        position: e.gex >= 0 ? "top" : "bottom",
        formatter: (params: { value: number }) => fmtBn(params.value),
        color: "#d6dbe4",
        fontSize: 9,
        fontFamily: "JetBrains Mono, monospace",
      },
    }));

    return {
      backgroundColor: "transparent",
      grid: { left: 24, right: 8, top: 20, bottom: 40 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: {
          color: "#566273",
          fontSize: 9,
          rotate: 30,
          fontFamily: "JetBrains Mono, monospace",
        },
        axisLine: { lineStyle: { color: ZERO_LINE } },
        axisTick: { lineStyle: { color: ZERO_LINE } },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: ZERO_LINE } },
        splitLine: { lineStyle: { color: ZERO_LINE, type: "dashed" } },
        axisLabel: {
          color: "#566273",
          fontSize: 9,
          formatter: (v: number) => fmtBn(v),
        },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 40,
        },
      ],
    };
  }, [byExpiry]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}
