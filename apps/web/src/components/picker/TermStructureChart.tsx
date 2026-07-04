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

// Native viewBox sized for the center-column panel; the container caps its width (below) so it
// renders at ~these px instead of ballooning when stretched across the full column.
const W = 760;
const H = 230;
const PAD = { left: 50, right: 22, top: 30, bottom: 40 };

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

export function xScale(dte: number): number {
  return PAD.left + ((dte - DTE_MIN) / (DTE_MAX - DTE_MIN)) * (W - PAD.left - PAD.right);
}

export function yScale(iv: number): number {
  return PAD.top + ((IV_MAX - iv) / (IV_MAX - IV_MIN)) * (H - PAD.top - PAD.bottom);
}

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

function buildTermLinePath(points: ReadonlyArray<TermStructurePoint>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.dte)} ${yScale(p.iv)}`).join("");
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
  const frontX = xScale(candidate.frontLeg.dte);
  const backX = xScale(candidate.backLeg.dte);
  const frontY = yScale(candidate.frontLeg.iv);
  const backY = yScale(candidate.backLeg.iv);
  const fwdIv = candidate.fwdIv;
  const bracketMidX = (frontX + backX) / 2;
  // Clamp into the drawable band so the guard tag never clips above the SVG viewport
  // (WR-02): when the higher leg dot sits near the top (front IV == IV_MAX), the raw
  // `min(frontY, backY) - 18` goes negative and the default viewport clipping hides it.
  const guardTagY = Math.max(PAD.top, Math.min(frontY, backY) - 22);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-1.5">
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
              x={PAD.left - 8}
              y={yScale(iv) + 4}
              fill={AXIS_LABEL}
              fontSize={12}
              textAnchor="end"
              fontFamily="JetBrains Mono, monospace"
            >
              {label}
            </text>
          </g>
        ))}

        {/* Event markers */}
        {events.map((ev) => {
          const dte = eventDte(ev.date, referenceMs);
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
                strokeWidth={1}
                strokeDasharray="2 5"
                opacity={0.3}
              />
              <text
                x={x}
                y={PAD.top - 4}
                fill={AMBER}
                fontSize={10}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                opacity={0.75}
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
          strokeWidth={2.4}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* X-axis DTE labels */}
        {X_TICKS.map((t) => (
          <text
            key={t}
            x={xScale(t)}
            y={H - 12}
            fill={AXIS_LABEL}
            fontSize={12}
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
              strokeWidth={1.8}
              strokeDasharray="4 3"
            />
            <text
              x={bracketMidX}
              y={yScale(fwdIv) + 16}
              fill={BLUE}
              fontSize={12}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {`fwd ${(fwdIv * 100).toFixed(1)}%`}
            </text>
          </g>
        ) : (
          <g data-testid="term-structure-guard-tag">
            <rect
              x={bracketMidX - 24}
              y={guardTagY}
              width={48}
              height={17}
              rx={3}
              fill="rgba(240,180,41,0.14)"
              stroke={AMBER}
              strokeWidth={1}
            />
            <text
              x={bracketMidX}
              y={guardTagY + 12}
              fill={AMBER}
              fontSize={11}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              guard
            </text>
          </g>
        )}

        {/* Leg dots — front (coral/down), back (teal/up) */}
        <circle data-testid="term-structure-leg-dot-front" cx={frontX} cy={frontY} r={5.5} fill={CORAL} />
        <text
          x={frontX}
          y={frontY - 11}
          fill={CORAL}
          fontSize={12}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
        >
          short f
        </text>
        <circle data-testid="term-structure-leg-dot-back" cx={backX} cy={backY} r={5.5} fill={TEAL} />
        <text
          x={backX}
          y={backY - 11}
          fill={TEAL}
          fontSize={12}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
        >
          long b
        </text>
      </svg>
      <p className="m-0 font-mono text-[10px] leading-[1.5] text-dim">
        ATM implied vol by expiry. Amber lines = FOMC / CPI / NFP; the kink into those dates is
        event premium, stripped before scoring. Your two legs: <span className="text-[#ef5350]">short front</span> / <span className="text-[#26a69a]">long back</span>.
      </p>
    </div>
  );
}
