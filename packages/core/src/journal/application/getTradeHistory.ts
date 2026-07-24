/**
 * getTradeHistory.ts — Trade Ledger read model (round-trips + executions).
 *
 * Composes four existing reads into the ledger the Journal screen renders:
 *   - listCalendars → one round-trip row per calendar, newest openedAt first
 *   - readLatestSnapshotPerOpenCalendar → greeks/IV block for OPEN calendars
 *     ('NaN' numeric strings map to null — JSON cannot carry NaN)
 *   - readMacroObservations → latest VIXCLS row as the vol-context value
 *   - readBrokerTransactions → TOS-style executions, one row per stored leg
 *
 * Realized P&L = (closeNetCredit − openNetDebit) × qty × 100 from the calendars table —
 * the oracle-validated amounts (journal-pnl fix 2026-07-05), stored in POINTS. The
 * calendar_events realized_pnl aggregate is deliberately NOT used: it is null for any
 * calendar whose OPEN fills predate its registration (orphan-exclusion trap) and is
 * points-scaled per leg. Missing closeNetCredit → null, never a fabricated number.
 */

import { ok, parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  Calendar,
  ForListingCalendars,
  ForReadingBrokerTransactions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingMacroObservations,
  SnapshotRow,
  StorageError,
} from "./ports.ts";

// ─── Output types ─────────────────────────────────────────────────────────────

export type TradeHistoryGreeks = {
  readonly netDelta: number | null;
  readonly netTheta: number | null;
  readonly netVega: number | null;
  readonly frontIv: number | null;
  readonly backIv: number | null;
  readonly termSlope: number | null;
  readonly asOf: Date;
};

export type TradeHistoryRoundTrip = {
  readonly calendarId: string;
  readonly underlying: string;
  readonly strike: number; // ×1000 int (calendars convention)
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
  readonly qty: number;
  readonly status: "open" | "closed";
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly openNetDebit: number;
  readonly closeNetCredit: number | null; // stored exit credit (points); null while open
  readonly realizedPnl: number | null;
  readonly greeks: TradeHistoryGreeks | null; // open calendars with a snapshot only
};

export type TradeHistoryExecution = {
  readonly activityId: number;
  readonly execTime: Date | null;
  readonly tradeDate: string;
  readonly orderId: number | null;
  readonly occSymbol: string;
  readonly expiry: string; // YYYY-MM-DD from the OCC symbol
  readonly strike: number; // points (not ×1000)
  readonly type: "C" | "P";
  readonly side: "buy" | "sell";
  readonly qty: number;
  readonly positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
  readonly price: number;
  readonly netAmount: number;
  readonly fees: number | null;
};

export type TradeHistory = {
  readonly roundTrips: ReadonlyArray<TradeHistoryRoundTrip>;
  readonly executions: ReadonlyArray<TradeHistoryExecution>;
  readonly totals: { readonly realizedPnl: number | null };
  readonly vix: { readonly value: number; readonly date: string } | null;
};

// ─── Deps ─────────────────────────────────────────────────────────────────────

export type GetTradeHistoryDeps = {
  readonly listCalendars: ForListingCalendars;
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendar;
  readonly readMacroObservations: ForReadingMacroObservations;
  readonly readBrokerTransactions: ForReadingBrokerTransactions;
};

export type ForRunningGetTradeHistory = () => Promise<
  Result<TradeHistory, StorageError>
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Drizzle-numeric string → number | null ('NaN' is a valid stored value per D-06,
// but JSON cannot carry NaN — the contract layer would reject it).
function numOrNull(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Format a parsed OCC expiry (local-midnight Date, see shared/occ-symbol.ts) as YYYY-MM-DD.
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toGreeks(snapshot: SnapshotRow): TradeHistoryGreeks {
  return {
    netDelta: numOrNull(snapshot.netDelta),
    netTheta: numOrNull(snapshot.netTheta),
    netVega: numOrNull(snapshot.netVega),
    frontIv: numOrNull(snapshot.frontIv),
    backIv: numOrNull(snapshot.backIv),
    termSlope: numOrNull(snapshot.termSlope),
    asOf: snapshot.time,
  };
}

// ─── Use-case factory ─────────────────────────────────────────────────────────

export function makeGetTradeHistoryUseCase(
  deps: GetTradeHistoryDeps,
): ForRunningGetTradeHistory {
  return async (): Promise<Result<TradeHistory, StorageError>> => {
    const calendarsResult = await deps.listCalendars();
    if (!calendarsResult.ok) return calendarsResult;
    const snapshotsResult = await deps.readLatestSnapshotPerOpenCalendar();
    if (!snapshotsResult.ok) return snapshotsResult;
    const macroResult = await deps.readMacroObservations();
    if (!macroResult.ok) return macroResult;
    const txResult = await deps.readBrokerTransactions();
    if (!txResult.ok) return txResult;

    const snapshotByCalendar = new Map(
      snapshotsResult.value.map((row) => [row.calendarId, row.snapshot]),
    );

    const roundTrips: TradeHistoryRoundTrip[] = [...calendarsResult.value]
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
      .map((c: Calendar): TradeHistoryRoundTrip => {
        const snapshot =
          c.status === "open" ? snapshotByCalendar.get(c.id) : undefined;
        // Realized $ from the oracle-validated calendars-table amounts (points → ×100).
        const closeNetCredit = c.closeNetCredit ?? null;
        const realizedPnl =
          c.status === "closed" && closeNetCredit !== null
            ? (closeNetCredit - c.openNetDebit) * c.qty * 100
            : null;
        return {
          calendarId: c.id,
          underlying: c.underlying,
          strike: c.strike,
          optionType: c.optionType,
          frontExpiry: c.frontExpiry,
          backExpiry: c.backExpiry,
          qty: c.qty,
          status: c.status,
          openedAt: c.openedAt,
          closedAt: c.closedAt,
          openNetDebit: c.openNetDebit,
          closeNetCredit,
          realizedPnl,
          greeks: snapshot !== undefined ? toGreeks(snapshot) : null,
        };
      });

    const executions: TradeHistoryExecution[] = [];
    for (const tx of txResult.value) {
      for (const leg of tx.legs) {
        const parsed = parseOccSymbol(leg.occSymbol);
        if (!parsed.ok) continue; // unparseable leg — raw row still holds it for audit
        executions.push({
          activityId: tx.activityId,
          execTime: tx.execTime,
          tradeDate: tx.tradeDate,
          orderId: tx.orderId,
          occSymbol: leg.occSymbol,
          expiry: toYmd(parsed.value.expiry),
          strike: parsed.value.strike,
          type: parsed.value.type,
          side: leg.side,
          qty: leg.qty,
          positionEffect: leg.positionEffect,
          price: leg.price,
          netAmount: tx.netAmount,
          fees: tx.fees,
        });
      }
    }

    const nonNullPnls = roundTrips
      .map((r) => r.realizedPnl)
      .filter((pnl): pnl is number => pnl !== null);
    const totals = {
      realizedPnl:
        nonNullPnls.length > 0 ? nonNullPnls.reduce((a, b) => a + b, 0) : null,
    };

    let vix: TradeHistory["vix"] = null;
    for (const row of macroResult.value) {
      if (row.seriesId !== "VIXCLS") continue;
      if (vix === null || row.date > vix.date) vix = { value: row.value, date: row.date };
    }

    return ok({ roundTrips, executions, totals, vix });
  };
}
