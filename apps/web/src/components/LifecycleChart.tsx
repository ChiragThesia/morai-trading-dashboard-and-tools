import React, { useState } from "react";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SnapshotResponse } from "@morai/contracts";

const LIFECYCLE_MODES = ["pl", "price", "greeks"] as const;

/**
 * LifecycleChart — Journal center-column chart with 3 locked mode tabs + scrubber.
 *
 * UI-SPEC "Journal screen" center column:
 *   - Running P&L: violet curve (#a78bfa) + area fill
 *   - Price & spot: blue curve (#5b9cf6)
 *   - Greeks: teal vega curve (#26a69a) or amber theta (#f0b429)
 *   - Day separators: dashed vertical lines #27313f with date labels
 *   - Scrubber: range input below chart, highlights selected snapshot on curve
 *
 * Chart library: visx (locked by UI-SPEC — equity/lifecycle curves use visx).
 * Tabs: shadcn Tabs (locked).
 */

type LifecycleMode = (typeof LIFECYCLE_MODES)[number];

function isLifecycleMode(val: string): val is LifecycleMode {
  return LIFECYCLE_MODES.some((m) => m === val);
}

interface LifecycleChartProps {
  /** Journal snapshots for the selected trade */
  snapshots: ReadonlyArray<SnapshotResponse>;
  /** Width in pixels (defaults to 100% via SVG viewBox) */
  width?: number;
  /** Height in pixels for the chart area */
  height?: number;
}

/** Format UTC snapshot time as "Mon DD HH:MM" for display */
function formatSnapTime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

/** Extract the day string "Jun 12" from a UTC ISO datetime */
function snapDayLabel(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

/** Compute day-boundary indices: indices where the day changes from prior snapshot */
function dayBoundaryIndices(snapshots: ReadonlyArray<SnapshotResponse>): ReadonlyArray<number> {
  const indices: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    if (prev !== undefined && curr !== undefined) {
      const prevDay = new Date(prev.time).toISOString().slice(0, 10);
      const currDay = new Date(curr.time).toISOString().slice(0, 10);
      if (prevDay !== currDay) {
        indices.push(i);
      }
    }
  }
  return indices;
}

/** Chart inner component for a given mode */
function ModeChart({
  snapshots,
  mode,
  selectedIndex,
  width,
  height,
}: {
  snapshots: ReadonlyArray<SnapshotResponse>;
  mode: LifecycleMode;
  selectedIndex: number;
  width: number;
  height: number;
}): React.ReactElement | null {
  if (snapshots.length < 2) return null;

  const margin = { top: 16, right: 12, bottom: 24, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Extract values per mode
  const values = snapshots.map((s) => {
    if (mode === "pl") return parseFloat(s.pnlOpen);
    if (mode === "price") return parseFloat(s.spot);
    // Greeks mode: vega (teal)
    return parseFloat(s.netVega);
  });

  const lineColor = mode === "pl" ? "#a78bfa" : mode === "price" ? "#5b9cf6" : "#26a69a";
  const gradientId = `lifecycle-grad-${mode}`;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(Math.abs(hi - lo) * 0.12, 1);

  const xScale = scalePoint({
    domain: values.map((_, i) => i),
    range: [0, innerW],
    padding: 0,
  });

  const yScale = scaleLinear({
    domain: [lo - pad, hi + pad],
    range: [innerH, 0],
    nice: true,
  });

  const getX = (_: number, i: number): number => xScale(i) ?? 0;
  const getY = (v: number): number => yScale(v);

  const dayBoundaries = dayBoundaryIndices(snapshots);

  // Selected point
  const selX = xScale(selectedIndex) ?? 0;
  const selVal = values[selectedIndex] ?? 0;
  const selY = yScale(selVal);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      aria-label={`Lifecycle chart: ${mode}`}
      role="img"
    >
      <LinearGradient
        id={gradientId}
        from={lineColor}
        to={lineColor}
        fromOpacity={0.18}
        toOpacity={0}
        vertical
      />
      <Group left={margin.left} top={margin.top}>
        {/* Day separator dashed vertical lines */}
        {dayBoundaries.map((i) => {
          const snap = snapshots[i];
          const x = xScale(i) ?? 0;
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={innerH}
                stroke="#27313f"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              {snap !== undefined && (
                <text
                  x={x + 3}
                  y={-4}
                  fill="#566273"
                  fontSize={9}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                >
                  {snapDayLabel(snap.time)}
                </text>
              )}
            </g>
          );
        })}

        {/* Area fill */}
        <AreaClosed
          data={[...values]}
          x={getX}
          y={getY}
          yScale={yScale}
          curve={curveMonotoneX}
          fill={`url(#${gradientId})`}
        />

        {/* Line */}
        <LinePath
          data={[...values]}
          x={getX}
          y={getY}
          curve={curveMonotoneX}
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Selected point circle */}
        <circle
          cx={selX}
          cy={selY}
          r={5}
          fill={lineColor}
          stroke="#0a0e14"
          strokeWidth={1.5}
        />
      </Group>
    </svg>
  );
}

export function LifecycleChart({
  snapshots,
  width = 720,
  height = 300,
}: LifecycleChartProps): React.ReactElement {
  const [mode, setMode] = useState<LifecycleMode>("pl");
  const [selectedIndex, setSelectedIndex] = useState<number>(snapshots.length - 1);

  // Keep selectedIndex in bounds when snapshots change
  const clampedIndex = snapshots.length > 0
    ? Math.min(selectedIndex, snapshots.length - 1)
    : 0;

  const selectedSnap = snapshots[clampedIndex];

  // Scrubber label values per mode
  function scrubValues(): string {
    if (selectedSnap === undefined) return "";
    if (mode === "pl") {
      const v = parseFloat(selectedSnap.pnlOpen);
      return `P&L: ${v >= 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`;
    }
    if (mode === "price") {
      return `SPX: ${parseFloat(selectedSnap.spot).toLocaleString()}`;
    }
    return `Vega: ${parseFloat(selectedSnap.netVega).toFixed(0)}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Three locked mode tabs */}
      <Tabs
        value={mode}
        onValueChange={(val) => {
          if (isLifecycleMode(val)) setMode(val);
        }}
      >
        <TabsList style={{ marginBottom: 8, background: "transparent", padding: 0 }}>
          <TabsTrigger value="pl">Running P&amp;L</TabsTrigger>
          <TabsTrigger value="price">Price &amp; spot</TabsTrigger>
          <TabsTrigger value="greeks">Greeks</TabsTrigger>
        </TabsList>

        <TabsContent value="pl" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ position: "relative", flex: 1, minHeight: height }}>
            <ModeChart
              snapshots={snapshots}
              mode="pl"
              selectedIndex={clampedIndex}
              width={width}
              height={height}
            />
          </div>
        </TabsContent>

        <TabsContent value="price" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ position: "relative", flex: 1, minHeight: height }}>
            <ModeChart
              snapshots={snapshots}
              mode="price"
              selectedIndex={clampedIndex}
              width={width}
              height={height}
            />
          </div>
        </TabsContent>

        <TabsContent value="greeks" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ position: "relative", flex: 1, minHeight: height }}>
            <ModeChart
              snapshots={snapshots}
              mode="greeks"
              selectedIndex={clampedIndex}
              width={width}
              height={height}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Scrubber */}
      {snapshots.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: "#7b8696",
              marginBottom: 4,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            <span>
              {selectedSnap !== undefined ? formatSnapTime(selectedSnap.time) : ""}
            </span>
            <span style={{ color: "#d6dbe4" }}>{scrubValues()}</span>
          </div>
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            step={1}
            value={clampedIndex}
            onChange={(e) => {
              setSelectedIndex(parseInt(e.target.value, 10));
            }}
            style={{ width: "100%" }}
            aria-label="Lifecycle scrubber"
          />
        </div>
      )}
    </div>
  );
}
