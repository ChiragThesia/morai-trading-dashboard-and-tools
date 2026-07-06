/**
 * OpenCalendarsStrip — Overview glance strip for the open book (the "what's going on now?"
 * answer). One compact row per OPEN calendar: short name · P&L-since-entry sparkline ·
 * current P&L · DTE. Clicking a row deep-links into the Journal for that calendar.
 *
 * Data: useCalendars() for the open set; useLifecycle(calendarId) per row for the P&L series
 * (same query keys the Journal populates, so the cache is warm on click). Renders nothing
 * when there are no open calendars — no empty panel on Overview.
 */
import { useCalendars } from "../hooks/useCalendars.ts";
import { useLifecycle } from "../hooks/useLifecycle.ts";
import { Panel, SectionLabel } from "./system/index.tsx";
import { sparklinePath } from "../lib/sparkline.ts";
import { cn } from "@/lib/utils";
import type { CalendarResponse } from "@morai/contracts";

const SPARK_W = 120;
const SPARK_H = 26;

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
  now,
  onOpen,
}: {
  calendar: CalendarResponse;
  now: Date;
  onOpen: (calendarId: string) => void;
}): React.ReactElement {
  const { data } = useLifecycle(calendar.id);
  const pnls = (data?.snapshots ?? [])
    .filter((s) => !s.isGap)
    .map((s) => Number(s.pnlOpen))
    .filter((n) => Number.isFinite(n));

  const lastPnl = pnls.at(-1) ?? null;
  const up = lastPnl !== null && lastPnl >= 0;
  const name = `${calendar.strike / 1000}${calendar.optionType}`;
  const dte = daysUntil(calendar.frontExpiry, now);
  const toneClass = lastPnl === null ? "text-dim" : up ? "text-up" : "text-down";

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
        {pnls.length > 0 && (
          <path
            d={sparklinePath(pnls, SPARK_W, SPARK_H)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className={cn("font-display text-xs font-bold tabular-nums", toneClass)}>
        {lastPnl === null ? "—" : signedUsd(lastPnl)}
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
  const { data } = useCalendars();
  const open = (data?.calendars ?? []).filter((c) => c.status === "open");

  if (open.length === 0) return null;

  const now = new Date();

  return (
    <Panel>
      <SectionLabel className="mb-2">Open calendars · P&amp;L since entry</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {open.map((c) => (
          <OpenCalendarRow key={c.id} calendar={c} now={now} onOpen={onOpenJournal} />
        ))}
      </div>
    </Panel>
  );
}
