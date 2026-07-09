/**
 * replayExitsForCalendar — BT-03 13-trade walk-forward vs the fills-ledger oracle (Phase 27,
 * Plan 05, Task 2).
 *
 * Walks a closed calendar's full snapshot history (03's source-inclusive
 * readFullSnapshotHistoryForCalendar, so a schwab_chain-sourced cycle is never silently
 * dropped -- Pattern 4, 27-RESEARCH.md) ASC through the untouched evaluateExit, threading
 * the in-memory previousVerdict forward for hysteresis. The oracle is the sum of
 * calendar_events.realizedPnl over CLOSE/ROLL events (Pattern 3) -- the validated fills
 * ledger a real trader's own fills already reflect; the modeled trajectory prices entry AND
 * exit via the shared haircutFill on real chain quotes (falling back to the calendar's own
 * real openNetDebit / the exit row's raw netMark only when no as-of-T chain quote is found,
 * never inventing data).
 *
 * A gap/stale/AH row is never selected as the exit point: evaluateExit's own indicative gate
 * (spot<=0, NaN, after-hours, stale) already forces `indicative: true`, and this replay only
 * treats a NON-indicative, non-HOLD verdict as the exit trigger.
 *
 * Hexagon law (architecture-boundaries §2/§7): imports only @morai/shared + the reused exit
 * pure evaluator / journal helpers threaded to @morai/core (self-import, mirrors
 * replayPickerCohort.ts's precedent) + this context's own ports/types.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  evaluateExit,
  haircutFill,
  computeSnapshotPnl,
  isWithinRth,
  isNyseHoliday,
} from "@morai/core";
import type { Calendar, CalendarEvent, ForReadingCalendarEvents, HeldPosition, MarketContext, PreviousVerdict } from "@morai/core";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingFullSnapshotHistoryForCalendar,
  FullHistorySnapshotRow,
  StorageError,
} from "../application/ports.ts";
import type { TradeReproduction } from "../domain/types.ts";

export type ReplayExitsForCalendarDeps = {
  readonly readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readChainAsOf: ForReadingChainAsOf;
};

/** Sum of calendar_events.realizedPnl over CLOSE/ROLL rows -- the validated fills-ledger
 * oracle (Pattern 3, Phase-22 P&L fix; "the fills are the oracle"). */
function oraclePnlFromEvents(events: ReadonlyArray<CalendarEvent>): number {
  return events
    .filter((e) => (e.eventType === "CLOSE" || e.eventType === "ROLL") && e.realizedPnl !== null)
    .reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0);
}

/** Locate the front/back leg quote for a calendar's fixed strike/expiry in an as-of-T chain
 * slice (puts only, D-01 scope). */
function findLeg(
  chain: ReadonlyArray<ChainLegQuoteAsOf>,
  strike: number,
  expiration: string,
): ChainLegQuoteAsOf | undefined {
  return chain.find((q) => q.strike === strike && q.expiration === expiration && q.contractType === "P");
}

/**
 * Prices the calendar's net debit/credit via the shared haircutFill on REAL as-of-T bid/ask
 * quotes -- "open" mirrors candidate-selection.ts's debit formula (buy the back, sell the
 * front); "close" is the inverse (sell the back, buy back the front). Returns null (never a
 * fabricated value) when no as-of-T chain quote is found for either leg at `atTime`.
 */
async function priceLegPairHaircut(
  deps: ReplayExitsForCalendarDeps,
  calendar: Calendar,
  atTime: Date,
  mode: "open" | "close",
): Promise<number | null> {
  const chainResult = await deps.readChainAsOf(atTime);
  if (!chainResult.ok) return null;
  const front = findLeg(chainResult.value, calendar.strike, calendar.frontExpiry);
  const back = findLeg(chainResult.value, calendar.strike, calendar.backExpiry);
  if (front === undefined || back === undefined) return null;
  return mode === "open"
    ? haircutFill(back, "buy") - haircutFill(front, "sell")
    : haircutFill(back, "sell") - haircutFill(front, "buy");
}

function toMarketContext(row: FullHistorySnapshotRow, calendar: Calendar): MarketContext {
  const marketSession: "rth" | "after-hours" = isWithinRth(row.time) && !isNyseHoliday(row.time) ? "rth" : "after-hours";
  return {
    netMark: row.netMark,
    pnlOpen: computeSnapshotPnl(row.netMark, calendar.openNetDebit, calendar.qty),
    spot: row.spot,
    frontIv: row.frontIv,
    backIv: row.backIv,
    dteFront: row.dteFront,
    dteBack: row.dteBack,
    snapshotTime: row.time,
    // Replay has no wall-clock lag beyond the row's own instant -- mirrors RESEARCH Pattern
    // 5's cohortNow convention (the staleness gate degrades to a no-op on historical replay).
    cohortNow: row.time,
    marketSession,
    // ponytail: no chain-triggered economic-events/roll-chain dependency for this task (the
    // plan's own action text names none) -- BT-03 tests P&L-trajectory reproduction, not
    // EVT/ROLL rule attribution. Upgrade path: thread readEconomicEvents + a per-row
    // readChainAsOf-derived rollChain if a future replay needs exact rule-firing parity.
    tier1Events: [],
    rollChain: { candidates: [] },
  };
}

export async function replayExitsForCalendar(
  calendar: Calendar,
  deps: ReplayExitsForCalendarDeps,
): Promise<Result<TradeReproduction, StorageError>> {
  const eventsResult = await deps.readCalendarEvents(calendar.id);
  if (!eventsResult.ok) return eventsResult;
  const oraclePnl = oraclePnlFromEvents(eventsResult.value);

  const historyResult = await deps.readFullSnapshotHistoryForCalendar(calendar.id);
  if (!historyResult.ok) return historyResult;

  const position: HeldPosition = {
    calendarId: calendar.id,
    name: `${calendar.underlying} ${calendar.strike / 1000}P`,
    strike: calendar.strike / 1000,
    qty: calendar.qty,
    openNetDebit: calendar.openNetDebit,
    frontExpiry: calendar.frontExpiry,
    backExpiry: calendar.backExpiry,
  };

  let previousVerdict: PreviousVerdict = null;
  let exitRow: FullHistorySnapshotRow | null = null;
  for (const row of historyResult.value) {
    const context = toMarketContext(row, calendar);
    const verdict = evaluateExit(position, context, previousVerdict);
    previousVerdict = { verdict: verdict.verdict, rung: verdict.rung, ruleId: verdict.ruleId };
    // A gap/stale/AH row is never actionable (evaluateExit's own indicative gate) -- never
    // fills on garbage, never selected as the exit trigger.
    if (!verdict.indicative && verdict.verdict !== "HOLD") {
      exitRow = row;
      break;
    }
  }

  const lastRow = historyResult.value[historyResult.value.length - 1];
  const finalRow = exitRow ?? lastRow ?? null;
  if (finalRow === null) {
    return ok({ calendarId: calendar.id, directionMatch: false, modeledPnl: 0, oraclePnl });
  }

  const exitValue = (await priceLegPairHaircut(deps, calendar, finalRow.time, "close")) ?? finalRow.netMark;
  const entryValue = (await priceLegPairHaircut(deps, calendar, calendar.openedAt, "open")) ?? calendar.openNetDebit;

  const modeledPnl = (exitValue - entryValue) * calendar.qty * 100;
  const directionMatch =
    Math.sign(modeledPnl) === Math.sign(oraclePnl) || (modeledPnl === 0 && oraclePnl === 0);

  return ok({ calendarId: calendar.id, directionMatch, modeledPnl, oraclePnl });
}
