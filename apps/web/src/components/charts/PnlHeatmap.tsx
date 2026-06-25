/**
 * PnlHeatmap — P&L heatmap (spot × date) using Apache ECharts
 *
 * UI-SPEC "Analyzer screen" P&L heatmap:
 *   - Columns: T+0, +5d, +10d, +15d, +20d, +30d
 *   - Rows: ±7 strikes from spot at selected step (10/25/50/100 pt)
 *   - Color: diverging teal↔coral symmetric about zero
 *   - Compact cell labels: $47, $1.2k, −$3.2k
 *   - Cell text: #08111a (dark on colored background), weight 600
 *   - Step toggle: 10s / 25s / 50s / 100s (default 50s)
 *
 * Chart library: Apache ECharts via echarts-for-react (locked by UI-SPEC).
 * No any/as/!.
 */

import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import type { HeatmapCell } from "../../lib/scenario-engine.ts";
import { buildHeatmapCells } from "../../lib/scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams } from "../../lib/scenario-engine.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HeatmapStep = 10 | 25 | 50 | 100;

interface PnlHeatmapProps {
  positions: ReadonlyArray<AnalyzerPosition>;
  params: ScenarioParams;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS = [0, 5, 10, 15, 20, 30] as const;
const COL_LABELS = ["T+0", "+5d", "+10d", "+15d", "+20d", "+30d"] as const;
const STEP_OPTIONS: ReadonlyArray<HeatmapStep> = [10, 25, 50, 100];

// ─── Color helpers ────────────────────────────────────────────────────────────

/** Diverging teal↔coral color matching playground-v3 heatRGB() */
function heatColor(v: number, scale: number): string {
  if (scale === 0) return "rgb(90,65,68)";
  const t = Math.max(-1, Math.min(1, v / scale));
  if (t >= 0) {
    return `rgb(${Math.round(16 + (1 - t) * 30)},${Math.round(70 + t * 150)},${Math.round(60 + t * 100)})`;
  }
  const u = -t;
  return `rgb(${Math.round(90 + u * 150)},${Math.round(40 + (1 - u) * 25)},${Math.round(55 + (1 - u) * 20)})`;
}

/** Compact P&L label */
function fmtCell(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

// ─── Build ECharts option ─────────────────────────────────────────────────────

function buildHeatmapOption(cells: ReadonlyArray<HeatmapCell>): object {
  // Group cells by spot (rows) and day (columns)
  const spotSet = new Set<number>();
  const daySet = new Set<number>();
  for (const c of cells) {
    spotSet.add(c.spot);
    daySet.add(c.daysForward);
  }

  // Sort spots descending (highest at top, like a P&L table)
  const spots = [...spotSet].sort((a, b) => b - a);
  // Columns in fixed order
  const days = COLUMNS.filter((d) => daySet.has(d));

  // Compute scale for diverging colors
  let maxAbs = 1;
  for (const c of cells) {
    if (Math.abs(c.pl) > maxAbs) maxAbs = Math.abs(c.pl);
  }

  // Build data array for ECharts scatter heatmap
  const data: Array<[number, number, number, string, string]> = [];
  for (const c of cells) {
    const xi = days.findIndex((d) => d === c.daysForward);
    const yi = spots.indexOf(c.spot);
    if (xi < 0 || yi < 0) continue;
    const color = heatColor(c.pl, maxAbs);
    const label = fmtCell(c.pl);
    data.push([xi, yi, c.pl, color, label]);
  }

  const colLabels = days.map((d, i) => COL_LABELS[i] ?? `+${d}d`);
  const rowLabels = spots.map((s) => s.toString());

  return {
    backgroundColor: "transparent",
    grid: { top: 28, bottom: 8, left: 52, right: 8 },
    xAxis: {
      type: "category",
      data: colLabels,
      axisLabel: { color: "#566273", fontSize: 9, fontFamily: "JetBrains Mono, monospace" },
      axisLine: { lineStyle: { color: "#27313f" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: rowLabels,
      axisLabel: { color: "#566273", fontSize: 9, fontFamily: "JetBrains Mono, monospace" },
      axisLine: { lineStyle: { color: "#27313f" } },
      splitLine: { show: false },
    },
    series: [
      {
        type: "custom",
        renderItem: (
          _params: { dataIndex: number },
          api: {
            value: (idx: number) => number;
            coord: (coords: [number, number]) => [number, number];
            size: (size: [number, number]) => [number, number];
            style: (extra: object) => object;
          },
        ): object => {
          const xi = api.value(0);
          const yi = api.value(1);
          const coord = api.coord([xi, yi]);
          const size = api.size([1, 1]);

          const cellW = size[0];
          const cellH = size[1];

          const dataItem = data[_params.dataIndex];
          const bgColor = dataItem !== undefined ? dataItem[3] : "#1b2433";
          const label = dataItem !== undefined ? dataItem[4] : "";

          return {
            type: "group",
            children: [
              {
                type: "rect",
                shape: {
                  x: coord[0] - cellW / 2 + 1,
                  y: coord[1] - cellH / 2 + 1,
                  width: cellW - 2,
                  height: cellH - 2,
                  r: 2,
                },
                style: api.style({ fill: bgColor }),
              },
              {
                type: "text",
                style: {
                  x: coord[0],
                  y: coord[1],
                  text: label,
                  textAlign: "center",
                  textVerticalAlign: "middle",
                  fill: "#08111a",
                  fontSize: 9,
                  fontFamily: "JetBrains Mono, monospace",
                  fontWeight: "bold",
                },
              },
            ],
          };
        },
        data: data.map((d) => [d[0], d[1], d[2]]),
        encode: { x: 0, y: 1, value: 2 },
      },
    ],
    tooltip: { show: false },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PnlHeatmap — ECharts P&L heatmap with step toggle.
 */
export function PnlHeatmap({ positions, params }: PnlHeatmapProps): React.ReactElement {
  const [step, setStep] = useState<HeatmapStep>(50);

  const cells = useMemo(
    () => buildHeatmapCells(positions, params, step),
    [positions, params, step],
  );

  const option = useMemo(() => buildHeatmapOption(cells), [cells]);

  const handleStepChange = (groupValue: string[]): void => {
    const picked = groupValue[0];
    const n = Number(picked);
    if (n === 10 || n === 25 || n === 50 || n === 100) {
      setStep(n);
    }
  };

  // Badge text: "step {n} · spot×date"
  const badgeText = `step ${step} · spot×date`;

  return (
    <div data-testid="pnl-heatmap">
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.9px",
            textTransform: "uppercase",
            color: "#7b8696",
          }}
        >
          P&L heatmap
        </h3>
        <span
          style={{
            fontSize: 9,
            color: "#566273",
            border: "1px solid #27313f",
            borderRadius: 999,
            padding: "1px 7px",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {badgeText}
        </span>
      </div>

      {/* Step toggle */}
      <div style={{ marginBottom: 8 }}>
        <ToggleGroup
          value={[step.toString()]}
          onValueChange={handleStepChange}
          aria-label="Heatmap step size"
        >
          {STEP_OPTIONS.map((s) => (
            <ToggleGroupItem
              key={s}
              value={s.toString()}
              aria-label={`${s}s step`}
            >
              {`${s}s`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* ECharts heatmap */}
      <ReactECharts
        option={option}
        style={{ height: 220, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </div>
  );
}
