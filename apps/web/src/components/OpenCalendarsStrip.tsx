/**
 * OpenCalendarsStrip — Overview glance strip for the open book (the "what's going on now?"
 * answer). One compact row per OPEN calendar: short name · P&L-since-entry sparkline ·
 * current P&L · DTE. Clicking a row deep-links into the Journal for that calendar.
 *
 * Data:
 *   - useCalendars() — the open set (name, strike, expiry).
 *   - usePositions() — live broker marks; the current P&L number is the calendar's unrealized
 *     P&L (netUnreal), which is available whenever positions load — NOT the journal snapshot
 *     history (that lags: it needs the 30-min snapshot-calendars job to have run for the
 *     calendar, which is chain/RTH-gated).
 *   - useLifecycle(calendarId) per row — the persisted P&L series that draws the sparkline.
 *     Empty until snapshots accumulate; the row still shows its live P&L number in the meantime.
 *
 * Renders nothing when there are no open calendars — no empty panel on Overview.
 */
import { useCalendars } from "../hooks/useCalendars.ts";
import { useLifecycle } from "../hooks/useLifecycle.ts";
import { usePositions } from "../hooks/usePositions.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import { Panel, SectionLabel } from "./system/index.tsx";
import { sparklinePath } from "../lib/sparkline.ts";
import { cn } from "@/lib/utils";
import type { CalendarResponse } from "@morai/contracts";

const SPARK_W = 120;
const SPARK_H = 26;

/**
 * Join key for matching a journal calendar to a live broker calendar group. The broker reports
 * underlyingSymbol "$SPX" for every leg, so we key on option type + strike-in-points, which is
 * unique per open calendar. parseOccSymbol yields strike in points (7400); the journal calendar
 * strike is a ×1000 int (7400000) — the strip divides before keying.
 */
function legKey(optionType: "C" | "P", strikePoints: number): string {
  return `${optionType}|${strikePoints}`;
}

/** Whole calendar days from `now` until a YYYY-MM-DD expiry (floored at 0). */
function daysUntil(ymd: string, now: Date): number {
  const exp = new Date(`${ymd}T00:00:00Z`).getTime();
  if (Number.isNaN(exp)) return 0;
  return Math.max(0, Math.ceil((exp - now.getTime()) / 86_400_000));
}

/** Signed whole-dollar label (e.g. "+$210", "−$90"). */
function signedUsd(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

function OpenCalendarRow({
  calendar,
  livePnl,
  now,
  onOpen,
}: {
  calendar: CalendarResponse;
  /** Live unrealized P&L from broker marks (netUnreal), or null when no marks match. */
  livePnl: number | null;
  now: Date;
  onOpen: (calendarId: string) => void;
}): React.ReactElement {
  const { data } = useLifecycle(calendar.id);
  const pnls = (data?.snapshots ?? [])
    .filter((s) => !s.isGap)
    .map((s) => Number(s.pnlOpen))
    .filter((n) => Number.isFinite(n));

  const up = livePnl !== null && livePnl >= 0;
  const toneClass = livePnl === null ? "text-dim" : up ? "text-up" : "text-down";
  const name = `${calendar.strike / 1000}${calendar.optionType}`;
  const dte = daysUntil(calendar.frontExpiry, now);

  return (
    <button
      type="button"
      data-testid="open-calendar-row"
      onClick={() => {
        onOpen(calendar.id);
      }}
      className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-left transition-colors hover:border-violet"
    >
      <span className="font-display text-xs text-txt tabular-nums">{name}</span>
      <svg
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        className={cn("overflow-visible", toneClass)}
        aria-hidden="true"
      >
        {pnls.length > 0 ? (
          <path
            d={sparklinePath(pnls, SPARK_W, SPARK_H)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          // No snapshot history yet (pipeline lag) — a faint baseline, not a fake trend.
          <line
            x1={0}
            y1={SPARK_H / 2}
            x2={SPARK_W}
            y2={SPARK_H / 2}
            className="text-line"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        )}
      </svg>
      <span className={cn("font-display text-xs font-bold tabular-nums", toneClass)}>
        {livePnl === null ? "—" : signedUsd(livePnl)}
      </span>
      <span className="font-mono text-[10px] text-dim tabular-nums">{dte}d</span>
    </button>
  );
}

export function OpenCalendarsStrip({
  onOpenJournal,
}: {
  onOpenJournal: (calendarId: string) => void;
}): React.ReactElement | null {
  const { data: calData } = useCalendars();
  const { data: posData } = usePositions();

  const open = (calData?.calendars ?? []).filter((c) => c.status === "open");
  if (open.length === 0) return null;

  const now = new Date();

  // Live unrealized P&L per open calendar, keyed by option type + strike-in-points.
  const { calendars: groups } = pairPositionsIntoCalendars(posData?.positions ?? [], now);
  const pnlByKey = new Map<string, number | null>();
  for (const g of groups) {
    pnlByKey.set(legKey(g.optionType, g.strike), g.netUnreal);
  }

  return (
    <Panel>
      <SectionLabel className="mb-2">Open calendars · P&amp;L since entry</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {open.map((c) => (
          <OpenCalendarRow
            key={c.id}
            calendar={c}
            livePnl={pnlByKey.get(legKey(c.optionType, c.strike / 1000)) ?? null}
            now={now}
            onOpen={onOpenJournal}
          />
        ))}
      </div>
    </Panel>
  );
}
