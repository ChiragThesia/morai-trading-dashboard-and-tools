/**
 * EventLegRibbon — the leg-and-events day timeline on the desktop Analyzer's chart panel
 * (2026-07-15, replaces the term-structure inset: the decision-relevant term info is WHERE
 * the macro events fall relative to your legs — days, not the IV curve; the curve's verdict
 * already lives in the WHY panel numbers and the hero's fwdEdge/slope chips).
 *
 * One horizontal strip on the shared 0..DTE_MAX day axis:
 *   - coral segment  today → front expiry  (the SHORT leg's danger window)
 *   - teal segment   front → back expiry   (events here are vol the LONG leg owns)
 *   - dim segment    back → axis end       (context only)
 *   - front/back leg dots (same testids as the term-structure chart — one tree, one owner)
 *   - one tick per scheduled event, colored by its window, with the WHAT/WHY hover tooltip
 *     (same copy and chip testids the retired chips row used)
 *
 * No any/as/!.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.tsx";
import type { PickerEvent } from "@morai/contracts";
import {
  DTE_MIN,
  DTE_MAX,
  CORAL,
  TEAL,
  AXIS_LABEL,
  EVENT_COPY,
  isoDateToUtcMs,
  eventDte,
} from "./TermStructureChart.tsx";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The calendar-date label ("Aug 6") for a leg sitting `dte` days after the snapshot's asOf.
 * PickerCandidate legs carry only DTE (no expiration ISO), so the date is derived — UTC
 * arithmetic, same convention as eventDte's day math.
 */
export function legDateLabel(asOf: string, dte: number): string {
  const d = new Date(isoDateToUtcMs(asOf) + dte * 86_400_000);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Labels closer than this (in % of axis width) stagger onto the second lane. */
const LANE_COLLISION_PCT = 7;

export interface RibbonItem {
  readonly key: string;
  readonly name: string;
  /** Calendar-date label, e.g. "Jul 29". */
  readonly label: string;
  readonly dte: number;
  readonly window: "front" | "back" | "later";
  /** Linear day position on the 0..DTE_MAX axis, in percent. */
  readonly xPct: number;
  /** 0 or 1 — near-coincident labels alternate lanes so they never overprint. */
  readonly lane: 0 | 1;
}

/** Pure layout: classify, position, and lane-stagger the in-axis events (sorted by day). */
export function ribbonLayout(
  events: ReadonlyArray<PickerEvent>,
  asOf: string,
  frontDte: number,
  backDte: number,
): ReadonlyArray<RibbonItem> {
  const referenceMs = isoDateToUtcMs(asOf);
  const positioned = events
    .map((ev) => {
      const [, moStr, dayStr] = ev.date.split("-");
      const dte = eventDte(ev.date, referenceMs);
      const window: RibbonItem["window"] = dte <= frontDte ? "front" : dte <= backDte ? "back" : "later";
      return {
        key: `${ev.date}-${ev.name}`,
        name: ev.name,
        label: `${MON[(Number(moStr) || 1) - 1]} ${Number(dayStr) || 1}`,
        dte,
        window,
        xPct: (dte / DTE_MAX) * 100,
      };
    })
    .filter((e) => e.dte >= DTE_MIN && e.dte <= DTE_MAX)
    .sort((a, b) => a.dte - b.dte);

  const items: RibbonItem[] = [];
  for (const e of positioned) {
    const prev = items[items.length - 1];
    const lane: 0 | 1 = prev !== undefined && e.xPct - prev.xPct < LANE_COLLISION_PCT && prev.lane === 0 ? 1 : 0;
    items.push({ ...e, lane });
  }
  return items;
}

const WINDOW_COLOR: Readonly<Record<RibbonItem["window"], string>> = {
  front: CORAL,
  back: TEAL,
  later: AXIS_LABEL,
};

const WINDOW_NOTE: Readonly<Record<RibbonItem["window"], string>> = {
  front: "Inside the SHORT front leg — max-loss exposure.",
  back: "Inside the LONG back leg only — vega event for the leg you own.",
  later: "After both legs — context only.",
};

export interface EventLegRibbonProps {
  readonly events: ReadonlyArray<PickerEvent>;
  /** ISO 8601 snapshot reference date the DTE fields are relative to. */
  readonly asOf: string;
  readonly frontDte: number;
  readonly backDte: number;
}

export function EventLegRibbon({
  events,
  asOf,
  frontDte,
  backDte,
}: EventLegRibbonProps): React.ReactElement {
  const items = ribbonLayout(events, asOf, frontDte, backDte);
  const frontLabel = legDateLabel(asOf, frontDte);
  const backLabel = legDateLabel(asOf, backDte);
  const frontPct = Math.min(100, (frontDte / DTE_MAX) * 100);
  const backPct = Math.min(100, (backDte / DTE_MAX) * 100);
  // Baseline sits below the two label lanes, leg labels below it.
  const BASE = 34;

  return (
    <TooltipProvider>
      <div data-testid="event-leg-ribbon" className="relative mb-1.5 h-[64px] w-full select-none font-mono">
        {/* Axis segments: short-leg danger window / long-leg owned window / afterwards */}
        <div
          className="absolute h-[2px]"
          style={{ left: 0, width: `${frontPct}%`, top: BASE, background: `${CORAL}88` }}
        />
        <div
          className="absolute h-[2px]"
          style={{ left: `${frontPct}%`, width: `${backPct - frontPct}%`, top: BASE, background: `${TEAL}88` }}
        />
        <div
          className="absolute h-px"
          style={{ left: `${backPct}%`, width: `${100 - backPct}%`, top: BASE + 1, background: "#222839" }}
        />

        {/* Endpoints */}
        <span className="absolute text-[9px]" style={{ left: 0, top: BASE + 8, color: AXIS_LABEL }}>
          today
        </span>
        <span className="absolute text-[9px]" style={{ right: 0, top: BASE + 8, color: AXIS_LABEL }}>
          {`${DTE_MAX}d`}
        </span>

        {/* Event ticks + staggered labels with the WHAT/WHY tooltips */}
        {items.map((e) => {
          const color = WINDOW_COLOR[e.window];
          const copy = EVENT_COPY[e.name];
          const labelTop = e.lane === 0 ? 16 : 2;
          return (
            <Tooltip key={e.key}>
              <TooltipTrigger
                data-testid={`term-structure-chip-${e.key}`}
                aria-label={`${e.name} event details`}
                className="absolute -translate-x-1/2 cursor-default border-none bg-transparent p-0"
                style={{ left: `${e.xPct}%`, top: 0, height: BASE }}
              >
                <span
                  className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] leading-none"
                  style={{ left: "50%", top: labelTop, color, opacity: e.window === "later" ? 0.65 : 1 }}
                >
                  {`${e.name} ${e.dte}d`}
                </span>
                <span
                  className="absolute w-px -translate-x-1/2"
                  style={{ left: "50%", top: labelTop + 10, height: BASE - labelTop - 10, background: `${color}99` }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex max-w-[16rem] flex-col gap-1 font-mono">
                  <span className="text-[11px] text-txt">{copy?.what ?? `${e.name} — scheduled economic release.`}</span>
                  <span className="text-[11px] text-dim">{copy?.why ?? "Scheduled event — IV into it is event premium."}</span>
                  <span className="text-[10px] text-dim/70">{`${e.label} · ${e.dte}d out · ${WINDOW_NOTE[e.window]}`}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Leg markers (same testids as the term-structure chart — one tree mounts one owner) */}
        <span
          data-testid="term-structure-leg-dot-front"
          className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${frontPct}%`, top: BASE + 1, background: CORAL }}
        />
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold"
          style={{ left: `${frontPct}%`, top: BASE + 8, color: CORAL }}
        >
          {`front ${frontLabel} · ${frontDte}d`}
        </span>
        <span
          data-testid="term-structure-leg-dot-back"
          className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${backPct}%`, top: BASE + 1, background: TEAL }}
        />
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold"
          style={{ left: `${backPct}%`, top: BASE + 8, color: TEAL }}
        >
          {`back ${backLabel} · ${backDte}d`}
        </span>
      </div>
    </TooltipProvider>
  );
}
