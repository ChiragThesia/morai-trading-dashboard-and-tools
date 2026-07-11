/**
 * TermStructureChart — the picker's "Term structure + your legs" mini-chart (ANLZ-03, D-01b).
 *
 * Recharts (~760×230, fixture-fixed axis DTE 0-82 / IV 8%-15.5% — not auto-scaled, mirrors
 * `PayoffChart.tsx`'s fixed-domain precedent, UI-SPEC Registry Safety): the ATM-IV
 * term-structure Line, amber dashed event ReferenceLines, front (coral) + back (teal) leg
 * ReferenceDots, and a blue dashed forward-IV bracket (ReferenceLine `segment`) between the
 * two leg x-positions — **omitted** when `candidate.fwdIv` is null (guard case, T-18-10) in
 * favor of a small amber `guard` tag next to the leg dots. No throw, no NaN, no fabricated
 * bracket over an undefined forward IV.
 *
 * Migrated off hand-rolled inline SVG to Recharts — Phase 33 (33-04).
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  useXAxisScale,
  useYAxisScale,
  usePlotArea,
} from "recharts";
import { ChartContainer } from "../ui/chart.tsx";
import type { ChartConfig } from "../ui/chart.tsx";
import type { PickerCandidate, PickerEvent, TermStructurePoint } from "@morai/contracts";

const W = 760;
const H = 230;

const DTE_MIN = 0;
const DTE_MAX = 82;
const IV_MIN = 0.08;
const IV_MAX = 0.155;

const CORAL = "#ef5350";
const TEAL = "#26a69a";
const BLUE = "#5b9cf6";
const AMBER = "#f0b429";
const GRID_LINE = "#222839";
const TERM_LINE = "#9aa3b8";
const AXIS_LABEL = "#67708a";
const MONO = "JetBrains Mono, monospace";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const IV_TICKS: ReadonlyArray<number> = [0.09, 0.12, 0.15];
const X_TICKS: ReadonlyArray<number> = [0, 20, 40, 60, 80];

const chartConfig = { iv: { label: "ATM IV", color: TERM_LINE } } satisfies ChartConfig;

/** Parse an ISO 8601 date (YYYY-MM-DD) into a UTC-midnight epoch-ms value. */
function isoDateToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Convert an event's absolute ISO date into a DTE relative to the snapshot's `asOf` reference.
 * Events carry absolute ISO dates (D-01) while the term-structure points and leg dots are
 * DTE-relative, so `referenceMs` (the snapshot's asOf) is what puts events on the same x-axis.
 */
function eventDte(iso: string, referenceMs: number): number {
  return Math.round((isoDateToUtcMs(iso) - referenceMs) / 86_400_000);
}

interface GuardTagProps {
  readonly frontDte: number;
  readonly frontIv: number;
  readonly backDte: number;
  readonly backIv: number;
}

/**
 * Guard tag (T-18-10 / WR-02): the fwdIv-null badge. No native Recharts primitive draws a
 * rounded-rect background behind text at a pixel-space-clamped position, so this is the one
 * genuinely non-standard mark on this chart (D-08) — it reads the chart's own axis scales via
 * Recharts 3.x hooks instead of hand-rolling pixel math.
 */
function GuardTag({ frontDte, frontIv, backDte, backIv }: GuardTagProps): React.ReactElement | null {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();
  if (xScale === undefined || yScale === undefined || plotArea === undefined) return null;
  const frontX = xScale(frontDte);
  const backX = xScale(backDte);
  const frontY = yScale(frontIv);
  const backY = yScale(backIv);
  if (frontX === undefined || backX === undefined || frontY === undefined || backY === undefined) return null;
  const midX = (frontX + backX) / 2;
  // Clamp into the plot area so the tag never clips above the chart (WR-02): when the higher
  // leg sits at IV_MAX, the raw `min(frontY, backY) - 22` goes above the plot top.
  const tagY = Math.max(plotArea.y, Math.min(frontY, backY) - 22);
  return (
    <g data-testid="term-structure-guard-tag">
      <rect
        x={midX - 24}
        y={tagY}
        width={48}
        height={17}
        rx={3}
        fill="rgba(240,180,41,0.14)"
        stroke={AMBER}
        strokeWidth={1}
      />
      <text x={midX} y={tagY + 12} fill={AMBER} fontSize={11} textAnchor="middle" fontFamily={MONO}>
        guard
      </text>
    </g>
  );
}

export interface TermStructureChartProps {
  readonly termStructure: ReadonlyArray<TermStructurePoint>;
  readonly events: ReadonlyArray<PickerEvent>;
  /** ISO 8601 snapshot reference date the DTE fields are relative to (WR-03). */
  readonly asOf: string;
  readonly candidate: PickerCandidate;
}

export function TermStructureChart({
  termStructure,
  events,
  asOf,
  candidate,
}: TermStructureChartProps): React.ReactElement {
  const referenceMs = isoDateToUtcMs(asOf);
  const fwdIv = candidate.fwdIv;
  const frontDte = candidate.frontLeg.dte;
  const backDte = candidate.backLeg.dte;
  const frontIv = candidate.frontLeg.iv;
  const backIv = candidate.backLeg.iv;

  // Dated event legend below the chart — each scheduled event with its calendar date, tagged by
  // which leg spans it (classified by DTE: front ≤ front expiry, back ≤ back expiry, else later).
  // Fixture data today; a live economic calendar arrives with the Phase-19 picker engine.
  const legendEvents = events
    .map((ev) => {
      const [, moStr, dayStr] = ev.date.split("-");
      const dte = eventDte(ev.date, referenceMs);
      const leg: "front" | "back" | "later" = dte <= frontDte ? "front" : dte <= backDte ? "back" : "later";
      return {
        key: `${ev.date}-${ev.name}`,
        name: ev.name,
        label: `${MON[(Number(moStr) || 1) - 1]} ${Number(dayStr) || 1}`,
        dte,
        leg,
      };
    })
    .filter((e) => e.dte >= DTE_MIN && e.dte <= DTE_MAX)
    .sort((a, b) => a.dte - b.dte);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-1.5">
      <ChartContainer config={chartConfig} className="aspect-[760/230] w-full">
        {/* Explicit width/height: required under jsdom (mockResponsiveContainer strips
            ResponsiveContainerContext, per 33-03's GammaProfile finding); a real browser
            measures the aspect-[760/230] box above via ResponsiveContainer and takes
            priority over these, so the chart stays fluid in the app. */}
        <LineChart data={termStructure} width={W} height={H} margin={{ top: 30, right: 22, bottom: 40, left: 50 }}>
          <CartesianGrid horizontal vertical={false} stroke={GRID_LINE} />
          <XAxis
            type="number"
            dataKey="dte"
            domain={[DTE_MIN, DTE_MAX]}
            allowDataOverflow
            ticks={X_TICKS}
            tickFormatter={(v: number): string => `${v}d`}
            tick={{ fill: AXIS_LABEL, fontSize: 12, fontFamily: MONO }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            domain={[IV_MIN, IV_MAX]}
            allowDataOverflow
            ticks={IV_TICKS}
            tickFormatter={(v: number): string => String(Math.round(v * 100))}
            tick={{ fill: AXIS_LABEL, fontSize: 12, fontFamily: MONO }}
            tickLine={false}
            axisLine={false}
          />

          {events.map((ev) => {
            const dte = eventDte(ev.date, referenceMs);
            if (dte < DTE_MIN || dte > DTE_MAX) return null;
            return (
              <ReferenceLine
                key={`${ev.date}-${ev.name}`}
                data-testid={`term-structure-event-${ev.date}-${ev.name}`}
                x={dte}
                stroke={AMBER}
                strokeDasharray="2 5"
                opacity={0.3}
              />
            );
          })}

          <Line
            data-testid="term-structure-line"
            type="linear"
            dataKey="iv"
            dot={false}
            stroke={TERM_LINE}
            strokeWidth={2.4}
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
              strokeDasharray="4 3"
              label={{
                value: `fwd ${(fwdIv * 100).toFixed(1)}%`,
                // WR-02: "insideBottom" on a zero-height segment computes y - offset (the
                // label sits ABOVE the line). "bottom" computes y + height + offset, which
                // for height=0 is y + offset — clearing 16px below, matching the
                // pre-migration yScale(fwdIv) + 16 placement.
                position: "bottom",
                offset: 16,
                fill: BLUE,
                fontSize: 12,
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
            r={5.5}
            fill={CORAL}
            stroke="none"
            label={{ value: "short f", position: "top", offset: 8, fill: CORAL, fontSize: 12, fontFamily: MONO }}
          />
          <ReferenceDot
            data-testid="term-structure-leg-dot-back"
            x={backDte}
            y={backIv}
            r={5.5}
            fill={TEAL}
            stroke="none"
            label={{ value: "long b", position: "top", offset: 8, fill: TEAL, fontSize: 12, fontFamily: MONO }}
          />
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="term-structure-legend">
        {legendEvents.map((e) => {
          const color = e.leg === "front" ? CORAL : e.leg === "back" ? TEAL : AXIS_LABEL;
          const tag = e.leg === "front" ? " ◂f" : e.leg === "back" ? " ◂b" : "";
          return (
            <span
              key={e.key}
              className="rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px]"
              style={{
                color,
                borderColor: `${color}66`,
                background: `${color}12`,
                opacity: e.leg === "later" ? 0.6 : 1,
              }}
            >
              {`${e.label} ${e.name}${tag}`}
            </span>
          );
        })}
      </div>
      <p className="m-0 font-mono text-[10px] leading-[1.5] text-dim">
        ATM implied vol by expiry. <span style={{ color: CORAL }}>◂f</span> = event before front expiry ·{" "}
        <span style={{ color: TEAL }}>◂b</span> = before back expiry · the IV kink into those dates is
        event premium, stripped before scoring.
      </p>
    </div>
  );
}
