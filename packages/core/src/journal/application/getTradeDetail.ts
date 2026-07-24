/**
 * getTradeDetail.ts — per-trade daily history for the Trade Ledger expansion.
 *
 * One row per ET trading day the calendar was held: SPX spot, open P&L, calendar NET
 * greeks, front/back IVs + term slope (all from the day's LAST calendar_snapshots slot),
 * plus PER-LEG bsm greeks resolved at that same slot via ForResolvingLegObservationForSlot
 * — the same observation cohort that fed the snapshot, so front + back sum to net, and
 * 24/7 overnight quotes never pollute an EOD row (the reason this anchors to snapshot
 * slots instead of "last leg_observation of the day").
 *
 * Per-leg greeks are position-scaled to DOLLARS and SIGNED: the front leg is SHORT
 * (× −qty×100), the back leg LONG (× +qty×100). Marks/IVs come from the snapshot's own
 * frontMark/backMark/frontIv/backIv columns. 'NaN' strings map to null — JSON rule.
 *
 * ponytail: 2 slot lookups × held days on expand (indexed PK reads, single user) —
 * batch the port if a months-long trade ever drags.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  Calendar,
  ForGettingCalendarById,
  ForReadingJournal,
  ForResolvingLegObservationForSlot,
  LegSnapshot,
  SnapshotRow,
  StorageError,
} from "./ports.ts";

// ─── Output types ─────────────────────────────────────────────────────────────

export type TradeDetailLegDay = {
  readonly mark: number | null; // points (snapshot front/back mark)
  readonly iv: number | null; // decimal (snapshot front/back IV)
  readonly delta: number | null; // signed dollars per SPX point
  readonly gamma: number | null;
  readonly theta: number | null; // signed dollars per day
  readonly vega: number | null; // signed dollars per vol point
};

export type TradeDetailDay = {
  readonly date: string; // ET calendar day, YYYY-MM-DD
  readonly asOf: Date; // the day's chosen snapshot slot
  readonly spot: number | null;
  readonly pnlOpen: number | null;
  readonly netDelta: number | null;
  readonly netGamma: number | null;
  readonly netTheta: number | null;
  readonly netVega: number | null;
  readonly frontIv: number | null;
  readonly backIv: number | null;
  readonly termSlope: number | null;
  readonly front: TradeDetailLegDay;
  readonly back: TradeDetailLegDay;
};

export type TradeDetail = {
  readonly calendarId: string;
  readonly days: ReadonlyArray<TradeDetailDay>;
};

// ─── Deps ─────────────────────────────────────────────────────────────────────

export type GetTradeDetailDeps = {
  readonly getCalendarById: ForGettingCalendarById;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegObservationForSlot: ForResolvingLegObservationForSlot;
};

export type ForRunningGetTradeDetail = (
  calendarId: string,
) => Promise<Result<TradeDetail | null, StorageError>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Drizzle-numeric string → number | null ('NaN' is a valid stored value, JSON is not).
function numOrNull(s: string | null): number | null {
  if (s === null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ET calendar day of an instant — same Intl mechanism as picker's etDateIso /
// shared's isNyseHoliday (core Intl precedent: rth-slot.ts, computePickerSnapshot.ts).
function etDayIso(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

// Scale a raw per-contract bsm greek string into signed position dollars.
function scaleGreek(raw: string | null, factor: number): number | null {
  const n = numOrNull(raw);
  return n === null ? null : n * factor;
}

function toLegDay(
  obs: LegSnapshot | null,
  mark: string,
  iv: string,
  factor: number,
): TradeDetailLegDay {
  return {
    mark: numOrNull(mark),
    iv: numOrNull(iv),
    delta: obs !== null ? scaleGreek(obs.bsmDelta, factor) : null,
    gamma: obs !== null ? scaleGreek(obs.bsmGamma, factor) : null,
    theta: obs !== null ? scaleGreek(obs.bsmTheta, factor) : null,
    vega: obs !== null ? scaleGreek(obs.bsmVega, factor) : null,
  };
}

// ─── Use-case factory ─────────────────────────────────────────────────────────

export function makeGetTradeDetailUseCase(
  deps: GetTradeDetailDeps,
): ForRunningGetTradeDetail {
  return async (calendarId: string): Promise<Result<TradeDetail | null, StorageError>> => {
    const calResult = await deps.getCalendarById(calendarId);
    if (!calResult.ok) return calResult;
    const calendar: Calendar | null = calResult.value;
    if (calendar === null) return ok(null);

    const journalResult = await deps.readJournal(calendarId);
    if (!journalResult.ok) return journalResult;
    const snapshots = journalResult.value;
    if (snapshots === null) return ok(null);

    // One row per ET day — the LAST slot of each day wins (rows arrive time-ASC).
    const lastPerDay = new Map<string, SnapshotRow>();
    for (const row of snapshots) {
      const day = etDayIso(row.time);
      const existing = lastPerDay.get(day);
      if (existing === undefined || row.time.getTime() > existing.time.getTime()) {
        lastPerDay.set(day, row);
      }
    }
    const dayEntries = [...lastPerDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

    // Front leg is SHORT, back leg LONG — signed dollar scaling per contract greek.
    const frontFactor = -calendar.qty * 100;
    const backFactor = calendar.qty * 100;

    const days: TradeDetailDay[] = [];
    for (const [date, row] of dayEntries) {
      const legQuery = {
        underlying: calendar.underlying,
        strike: calendar.strike,
        optionType: calendar.optionType,
        slotAnchor: row.time,
      };
      const [frontResult, backResult] = await Promise.all([
        deps.resolveLegObservationForSlot({ ...legQuery, expiry: calendar.frontExpiry }),
        deps.resolveLegObservationForSlot({ ...legQuery, expiry: calendar.backExpiry }),
      ]);
      if (!frontResult.ok) return frontResult;
      if (!backResult.ok) return backResult;

      days.push({
        date,
        asOf: row.time,
        spot: numOrNull(row.spot),
        pnlOpen: numOrNull(row.pnlOpen),
        netDelta: numOrNull(row.netDelta),
        netGamma: numOrNull(row.netGamma),
        netTheta: numOrNull(row.netTheta),
        netVega: numOrNull(row.netVega),
        frontIv: numOrNull(row.frontIv),
        backIv: numOrNull(row.backIv),
        termSlope: numOrNull(row.termSlope),
        front: toLegDay(frontResult.value, row.frontMark, row.frontIv, frontFactor),
        back: toLegDay(backResult.value, row.backMark, row.backIv, backFactor),
      });
    }

    return ok({ calendarId, days });
  };
}
