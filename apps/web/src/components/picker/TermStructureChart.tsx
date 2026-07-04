/**
 * TermStructureChart — the picker's "Term structure + your legs" mini-chart (ANLZ-03, D-01b).
 *
 * Inline SVG (~310×150, fixture-fixed axis DTE 0-82 / IV 8%-15.5% — not auto-scaled, mirrors
 * `PayoffChart.tsx`'s hand-rolled-SVG precedent, UI-SPEC Registry Safety): the ATM-IV
 * term-structure polyline, amber dashed vertical event markers, front (coral) + back (teal) leg
 * dots, and a blue dashed forward-IV bracket between the two leg x-positions — **omitted** when
 * `candidate.fwdIv` is null (guard case, T-18-10) in favor of a small amber `guard` tag next to
 * the leg dots. No throw, no NaN, no fabricated bracket over an undefined forward IV.
 */
import type { PickerCandidate, PickerEvent, TermStructurePoint } from "@morai/contracts";

const W = 310;
const H = 150;
const PAD = { left: 30, right: 8, top: 10, bottom: 20 };

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

const GRID_TICKS: ReadonlyArray<{ readonly iv: number; readonly label: string }> = [
  { iv: 0.09, label: "9" },
  { iv: 0.12, label: "12" },
  { iv: 0.15, label: "15" },
];

const X_TICKS: ReadonlyArray<number> = [0, 20, 40, 60, 80];

/**
 * The fixed reference "today" the frozen fixture's DTE fields are computed against — verified
 * against the fixture's own leg-dte / exitPlan.closeByExpiry pairs (e.g. the top candidate's
 * front leg carries `dte: 21` and its `closeByExpiry` is "2026-07-23"; 2026-07-02 + 21 days is
 * exactly 2026-07-23). Events carry absolute ISO dates (D-01) while the term-structure points and
 * leg dots are already DTE-relative, so this constant is what puts events on the same x-axis.
 * Fixture-fixed, never re-derived at runtime — matches this chart's "not auto-scaled" contract.
 */
const FIXTURE_REFERENCE_DATE_MS = Date.UTC(2026, 6, 2); // 2026-07-02

export function xScale(dte: number): number {
  return PAD.left + ((dte - DTE_MIN) / (DTE_MAX - DTE_MIN)) * (W - PAD.left - PAD.right);
}

export function yScale(iv: number): number {
  return PAD.top + ((IV_MAX - iv) / (IV_MAX - IV_MIN)) * (H - PAD.top - PAD.bottom);
}

/** Convert an event's absolute ISO date into a DTE relative to `FIXTURE_REFERENCE_DATE_MS`. */
function eventDte(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const eventMs = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return Math.round((eventMs - FIXTURE_REFERENCE_DATE_MS) / 86_400_000);
}

function buildTermLinePath(points: ReadonlyArray<TermStructurePoint>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.dte)} ${yScale(p.iv)}`).join("");
}

export interface TermStructureChartProps {
  readonly termStructure: ReadonlyArray<TermStructurePoint>;
  readonly events: ReadonlyArray<PickerEvent>;
  readonly candidate: PickerCandidate;
}

export function TermStructureChart({
  termStructure,
  events,
  candidate,
}: TermStructureChartProps): React.ReactElement {
  const frontX = xScale(candidate.frontLeg.dte);
  const backX = xScale(candidate.backLeg.dte);
  const frontY = yScale(candidate.frontLeg.iv);
  const backY = yScale(candidate.backLeg.iv);
  const fwdIv = candidate.fwdIv;
  const bracketMidX = (frontX + backX) / 2;
  const guardTagY = Math.min(frontY, backY) - 18;

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block" }}
        role="img"
        aria-label="Term structure and leg placement"
      >
        {/* Gridlines */}
        {GRID_TICKS.map(({ iv, label }) => (
          <g key={label}>
            <line
              x1={PAD.left}
              y1={yScale(iv)}
              x2={W - PAD.right}
              y2={yScale(iv)}
              stroke={GRID_LINE}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 4}
              y={yScale(iv) + 3}
              fill={AXIS_LABEL}
              fontSize={8}
              textAnchor="end"
              fontFamily="JetBrains Mono, monospace"
            >
              {label}
            </text>
          </g>
        ))}

        {/* Event markers */}
        {events.map((ev) => {
          const dte = eventDte(ev.date);
          if (dte < DTE_MIN || dte > DTE_MAX) return null;
          const x = xScale(dte);
          return (
            <g key={`${ev.date}-${ev.name}`} data-testid={`term-structure-event-${ev.date}-${ev.name}`}>
              <line
                x1={x}
                y1={PAD.top}
                x2={x}
                y2={H - PAD.bottom}
                stroke={AMBER}
                strokeWidth={0.8}
                strokeDasharray="2 3"
              />
              <text
                x={x}
                y={PAD.top + 7}
                fill={AMBER}
                fontSize={6.5}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
              >
                {ev.name}
              </text>
            </g>
          );
        })}

        {/* Term-structure polyline */}
        <path
          data-testid="term-structure-line"
          d={buildTermLinePath(termStructure)}
          stroke={TERM_LINE}
          strokeWidth={1.6}
          fill="none"
        />

        {/* X-axis DTE labels */}
        {X_TICKS.map((t) => (
          <text
            key={t}
            x={xScale(t)}
            y={H - 6}
            fill={AXIS_LABEL}
            fontSize={7.5}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
          >
            {`${t}d`}
          </text>
        ))}

        {/* Forward-IV bracket (omitted for the guard case) or the guard tag */}
        {fwdIv !== null ? (
          <g data-testid="term-structure-fwd-bracket">
            <path
              d={`M${frontX} ${yScale(fwdIv)}H${backX}`}
              stroke={BLUE}
              strokeWidth={1.2}
              strokeDasharray="3 2"
            />
            <text
              x={bracketMidX}
              y={yScale(fwdIv) - 4}
              fill={BLUE}
              fontSize={7.5}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {`fwd ${(fwdIv * 100).toFixed(1)}%`}
            </text>
          </g>
        ) : (
          <g data-testid="term-structure-guard-tag">
            <rect
              x={bracketMidX - 15}
              y={guardTagY}
              width={30}
              height={10}
              rx={2}
              fill="rgba(240,180,41,0.14)"
              stroke={AMBER}
              strokeWidth={1}
            />
            <text
              x={bracketMidX}
              y={guardTagY + 7.5}
              fill={AMBER}
              fontSize={6.5}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              guard
            </text>
          </g>
        )}

        {/* Leg dots — front (coral/down), back (teal/up) */}
        <circle data-testid="term-structure-leg-dot-front" cx={frontX} cy={frontY} r={3.5} fill={CORAL} />
        <text
          x={frontX}
          y={frontY - 7}
          fill={CORAL}
          fontSize={7.5}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
        >
          short f
        </text>
        <circle data-testid="term-structure-leg-dot-back" cx={backX} cy={backY} r={3.5} fill={TEAL} />
        <text
          x={backX}
          y={backY - 7}
          fill={TEAL}
          fontSize={7.5}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
        >
          long b
        </text>
      </svg>
      <p className="m-0 font-mono text-[9px] leading-[1.5] text-dim">
        Amber = FOMC/CPI/NFP. Note the kink into event dates — event premium, stripped before
        scoring.
      </p>
    </div>
  );
}
