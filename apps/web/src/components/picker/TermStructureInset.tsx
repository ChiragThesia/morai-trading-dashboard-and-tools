/**
 * TermStructureInset — the miniature term-structure chart overlaid on the desktop Analyzer's
 * payoff chart (no-scroll layout, 2026-07-15). Replaces the full-width "Term structure + your
 * legs" panel on desktop: same marks at ~40% scale — ATM-IV line, amber event verticals,
 * front/back leg dots, blue forward-IV bracket (or the amber guard tag when fwdIv is null).
 *
 * Reuses TermStructureChart's exported domain constants, palette, date helpers, and GuardTag
 * so the two renderings can never drift. Same mark testids as the full chart — exactly one of
 * the two mounts per tree (desktop: inset only; mobile: full chart only).
 *
 * Non-interactive by design: the caller layers it `pointer-events-none` over the payoff chart
 * so crosshair/tooltip interaction underneath stays live; the event chips row (EventChipsRow,
 * rendered separately in the chart header area) carries the hover teaching copy.
 *
 * No any/as/!.
 */
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ReferenceDot } from "recharts";
import { ChartContainer } from "../ui/chart.tsx";
import type { ChartConfig } from "../ui/chart.tsx";
import type { PickerCandidate, PickerEvent, TermStructurePoint } from "@morai/contracts";
import {
  DTE_MIN,
  DTE_MAX,
  IV_MIN,
  IV_MAX,
  CORAL,
  TEAL,
  BLUE,
  AMBER,
  TERM_LINE,
  AXIS_LABEL,
  MONO,
  GuardTag,
  isoDateToUtcMs,
  eventDte,
} from "./TermStructureChart.tsx";

const W = 300;
const H = 130;

const IV_TICKS: ReadonlyArray<number> = [0.09, 0.15];
const X_TICKS: ReadonlyArray<number> = [0, 40, 80];

const chartConfig = { iv: { label: "ATM IV", color: TERM_LINE } } satisfies ChartConfig;

export interface TermStructureInsetProps {
  readonly termStructure: ReadonlyArray<TermStructurePoint>;
  readonly events: ReadonlyArray<PickerEvent>;
  /** ISO 8601 snapshot reference date the DTE fields are relative to. */
  readonly asOf: string;
  readonly candidate: PickerCandidate;
}

export function TermStructureInset({
  termStructure,
  events,
  asOf,
  candidate,
}: TermStructureInsetProps): React.ReactElement {
  const referenceMs = isoDateToUtcMs(asOf);
  const fwdIv = candidate.fwdIv;
  const frontDte = candidate.frontLeg.dte;
  const backDte = candidate.backLeg.dte;
  const frontIv = candidate.frontLeg.iv;
  const backIv = candidate.backLeg.iv;

  return (
    <div
      data-testid="term-structure-inset"
      className="w-[300px] rounded-[3px] border border-line2 bg-bg/90 px-1.5 pb-0.5 pt-1"
    >
      <span className="font-display text-[8px] font-semibold uppercase tracking-[0.08em] text-dim">
        Term structure
      </span>
      <ChartContainer config={chartConfig} className="aspect-[300/130] w-full">
        {/* Explicit width/height: required under jsdom (mockResponsiveContainer strips
            ResponsiveContainerContext); a real browser measures the aspect box above. */}
        <LineChart data={termStructure} width={W} height={H} margin={{ top: 10, right: 6, bottom: 2, left: -18 }}>
          <XAxis
            type="number"
            dataKey="dte"
            domain={[DTE_MIN, DTE_MAX]}
            allowDataOverflow
            ticks={X_TICKS}
            tickFormatter={(v: number): string => `${v}d`}
            tick={{ fill: AXIS_LABEL, fontSize: 8, fontFamily: MONO }}
            tickLine={false}
            axisLine={false}
            height={12}
          />
          <YAxis
            type="number"
            domain={[IV_MIN, IV_MAX]}
            allowDataOverflow
            ticks={IV_TICKS}
            tickFormatter={(v: number): string => String(Math.round(v * 100))}
            tick={{ fill: AXIS_LABEL, fontSize: 8, fontFamily: MONO }}
            tickLine={false}
            axisLine={false}
          />

          {events.map((ev) => {
            const dte = eventDte(ev.date, referenceMs);
            if (dte < DTE_MIN || dte > DTE_MAX) return null;
            return (
              <ReferenceLine
                key={`${ev.date}-${ev.name}`}
                x={dte}
                stroke={AMBER}
                strokeDasharray="2 4"
                opacity={0.45}
                label={{ value: ev.name.slice(0, 1), position: "top", fontSize: 8, fill: AMBER }}
              />
            );
          })}

          <Line
            data-testid="term-structure-line"
            type="linear"
            dataKey="iv"
            dot={false}
            stroke={TERM_LINE}
            strokeWidth={1.6}
            isAnimationActive={false}
          />

          {fwdIv !== null ? (
            <ReferenceLine
              data-testid="term-structure-fwd-bracket"
              segment={[
                { x: frontDte, y: fwdIv },
                { x: backDte, y: fwdIv },
              ]}
              stroke={BLUE}
              strokeDasharray="3 2"
              label={{
                value: `fwd ${(fwdIv * 100).toFixed(1)}%`,
                position: "bottom",
                offset: 8,
                fill: BLUE,
                fontSize: 8,
                fontFamily: MONO,
              }}
            />
          ) : (
            <GuardTag frontDte={frontDte} frontIv={frontIv} backDte={backDte} backIv={backIv} />
          )}

          <ReferenceDot
            data-testid="term-structure-leg-dot-front"
            x={frontDte}
            y={frontIv}
            r={3.5}
            fill={CORAL}
            stroke="none"
          />
          <ReferenceDot
            data-testid="term-structure-leg-dot-back"
            x={backDte}
            y={backIv}
            r={3.5}
            fill={TEAL}
            stroke="none"
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
