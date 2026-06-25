/**
 * JournalContainer — data wrapper for the Journal screen.
 *
 * Fetches the calendar list via useCalendars(), maps each CalendarResponse to
 * a TradeSummary, and renders <Journal trades={mappedTrades} />.
 *
 * Data honesty rules:
 *   - realizedPnl: always "" — the list endpoint has no P&L; Journal's fmtPnl
 *     returns "—" for non-finite values (parseFloat("") = NaN). Real P&L loads
 *     per-calendar via useJournal(calendarId) when a trade is selected.
 *   - hasSnapshots: always false — the list endpoint can't know. Journal shows
 *     the graceful pre-history/entry-exit view; the real lifecycle loads on selection.
 *
 * No fabricated P&L, no fabricated snapshot history.
 */

import { useCalendars } from "../hooks/useCalendars.ts";
import { Journal } from "./Journal.tsx";
import type { TradeSummary } from "./Journal.tsx";
import type { CalendarResponse } from "@morai/contracts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a YYYY-MM-DD date string as a short month+day label (e.g. "Aug 8").
 * Pure function, no Date mutation, no non-null assertions.
 */
function shortDate(ymd: string): string {
  // ymd is validated by Zod to be a date string, but we guard parse failure gracefully.
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Derive a human-readable trade label from a CalendarResponse.
 *
 * Example: SPX 7425P Aug 8/Sep 19
 *
 * strike is a ×1000 integer (e.g. 7425000 → 7425).
 */
function calendarName(c: CalendarResponse): string {
  const strikePt = c.strike / 1000;
  const front = shortDate(c.frontExpiry);
  const back = shortDate(c.backExpiry);
  return `${c.underlying} ${strikePt}${c.optionType} ${front}/${back}`;
}

/** Map a CalendarResponse to the TradeSummary shape Journal expects. */
function toTradeSummary(c: CalendarResponse): TradeSummary {
  return {
    id: c.id,
    calendarId: c.id,
    name: calendarName(c),
    openedAt: c.openedAt,
    closedAt: c.closedAt,
    // List endpoint has no P&L. "" → fmtPnl returns "—". Real P&L loads per-selection.
    realizedPnl: "",
    // List endpoint can't know. Journal shows graceful pre-history view.
    hasSnapshots: false,
  };
}

// ─── Container ────────────────────────────────────────────────────────────────

/**
 * JournalContainer — fetches the calendar list and passes mapped trades to Journal.
 *
 * Loading: passes empty array (Journal's loading copy handles it gracefully).
 * 401: the query enters error state; Journal receives an empty array and shows
 *      the "No journal history yet." empty state — no error shown to the user.
 *      The ErrorBoundary in App.tsx catches unexpected render errors.
 */
export function JournalContainer(): React.ReactElement {
  const { data } = useCalendars();

  const trades: ReadonlyArray<TradeSummary> =
    data !== undefined ? data.calendars.map(toTradeSummary) : [];

  return <Journal trades={trades} />;
}
