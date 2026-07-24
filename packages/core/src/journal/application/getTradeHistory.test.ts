/**
 * getTradeHistory.test.ts — Trade Ledger read model (round-trips + executions).
 *
 * Proves:
 *  - roundTrips: one per calendar, newest openedAt first, realizedPnl joined from the
 *    per-calendar aggregate, greeks joined from the latest snapshot for OPEN calendars only
 *    ('NaN' numeric strings map to null — JSON cannot carry NaN)
 *  - executions: one row per stored-transaction leg, expiry/strike/type parsed from the
 *    OCC symbol (strike in points), port order (exec desc) preserved
 *  - totals.realizedPnl: sum of non-null round-trip P&Ls; null when none
 *  - vix: latest VIXCLS macro row; null when the series is absent
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";
import { makeGetTradeHistoryUseCase } from "./getTradeHistory.ts";
import type {
  Calendar,
  SnapshotRow,
  StoredBrokerTransaction,
  MacroObservationRow,
} from "./ports.ts";

const FRONT = formatOccSymbol({
  root: "SPXW",
  expiry: new Date("2026-08-11T12:00:00Z"),
  type: "P",
  strike: 7400,
});

function cal(overrides: Partial<Calendar> & { id: string }): Calendar {
  return {
    underlying: "SPXW",
    strike: 7400000,
    optionType: "P",
    frontExpiry: "2026-08-11",
    backExpiry: "2026-08-31",
    qty: 1,
    openNetDebit: 40.08,
    status: "open",
    openedAt: new Date("2026-07-23T19:50:00Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

function snap(calendarId: string, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    time: new Date("2026-07-23T19:30:00Z"),
    calendarId,
    spot: "7395.14",
    netMark: "40.1",
    frontMark: "103.4",
    backMark: "143.5",
    frontIv: "0.145",
    backIv: "0.139",
    frontIvRaw: "0.146",
    backIvRaw: "NaN",
    netDelta: "1.2",
    netGamma: "0.01",
    netTheta: "38.5",
    netVega: "112.3",
    termSlope: "-0.006",
    dteFront: 19,
    dteBack: 39,
    pnlOpen: "2.0",
    source: "schwab_chain",
    ...overrides,
  };
}

const OPEN_CAL = cal({ id: "open-cal" });
const CLOSED_CAL = cal({
  id: "closed-cal",
  strike: 7500000,
  frontExpiry: "2026-08-07",
  status: "closed",
  openedAt: new Date("2026-07-16T14:00:00Z"),
  closedAt: new Date("2026-07-23T19:50:00Z"),
  openNetDebit: 43.27,
  closeNetCredit: 41.58,
});

const TX: StoredBrokerTransaction = {
  activityId: 126084076124,
  orderId: 1007316230828,
  activityType: "EXECUTION",
  execTime: new Date("2026-07-23T19:50:12Z"),
  tradeDate: "2026-07-23",
  settlementDate: "2026-07-24",
  netAmount: 10334.87,
  fees: -0.66,
  legs: [
    { occSymbol: FRONT, qty: 1, price: 103.36, positionEffect: "OPENING", side: "sell" },
  ],
  raw: { verbatim: true },
};

const MACRO: ReadonlyArray<MacroObservationRow> = [
  { seriesId: "VIXCLS", date: "2026-07-22", value: 16.8, source: "fred" },
  { seriesId: "VIXCLS", date: "2026-07-23", value: 18.2, source: "fred" },
  { seriesId: "VVIX", date: "2026-07-23", value: 95.1, source: "cboe" },
];

function makeUseCase(overrides: {
  calendars?: ReadonlyArray<Calendar>;
  snapshots?: ReadonlyArray<{ calendarId: string; snapshot: SnapshotRow }>;
  macro?: ReadonlyArray<MacroObservationRow>;
  txs?: ReadonlyArray<StoredBrokerTransaction>;
} = {}) {
  return makeGetTradeHistoryUseCase({
    listCalendars: async () => ok(overrides.calendars ?? [OPEN_CAL, CLOSED_CAL]),
    readLatestSnapshotPerOpenCalendar: async () =>
      ok(overrides.snapshots ?? [{ calendarId: "open-cal", snapshot: snap("open-cal") }]),
    readMacroObservations: async () => ok(overrides.macro ?? MACRO),
    readBrokerTransactions: async () => ok(overrides.txs ?? [TX]),
  });
}

describe("makeGetTradeHistoryUseCase — Trade Ledger read model", () => {
  it("builds round-trips newest-first with realizedPnl + open-calendar greeks", async () => {
    const result = await makeUseCase()();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { roundTrips, totals, vix } = result.value;
    expect(roundTrips.map((r) => r.calendarId)).toEqual(["open-cal", "closed-cal"]);

    const open = roundTrips[0];
    expect(open?.realizedPnl).toBeNull();
    expect(open?.greeks?.netDelta).toBeCloseTo(1.2, 10);
    expect(open?.greeks?.netTheta).toBeCloseTo(38.5, 10);
    expect(open?.greeks?.frontIv).toBeCloseTo(0.145, 10);
    expect(open?.greeks?.termSlope).toBeCloseTo(-0.006, 10);
    expect(open?.greeks?.asOf.toISOString()).toBe("2026-07-23T19:30:00.000Z");

    // Realized $ = (closeNetCredit − openNetDebit) × qty × 100 — the oracle-validated
    // calendars-table amounts (points), never the events aggregate (null-riddled for
    // history whose OPEN fills predate registration; see orphan-exclusion LAW).
    const closed = roundTrips[1];
    expect(closed?.realizedPnl).toBeCloseTo((41.58 - 43.27) * 100, 8);
    expect(closed?.closeNetCredit).toBeCloseTo(41.58, 10);
    expect(closed?.greeks).toBeNull();
    expect(closed?.closedAt?.toISOString()).toBe("2026-07-23T19:50:00.000Z");

    // Open trade has no exit yet — closeNetCredit null, never 0.
    expect(roundTrips[0]?.closeNetCredit).toBeNull();

    expect(totals.realizedPnl).toBeCloseTo(-169, 8);
    expect(vix).toEqual({ value: 18.2, date: "2026-07-23" });
  });

  it("an OPEN calendar with a stored closeNetCredit of 0 still reports null exit (recompute writes 0 for open cals)", async () => {
    const result = await makeUseCase({
      calendars: [cal({ id: "open-zero", closeNetCredit: 0 })],
    })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundTrips[0]?.closeNetCredit).toBeNull();
    expect(result.value.roundTrips[0]?.realizedPnl).toBeNull();
  });

  it("closed calendar without a stored closeNetCredit → realizedPnl null, never fabricated", async () => {
    const result = await makeUseCase({
      calendars: [cal({ id: "c", status: "closed", closedAt: new Date("2026-07-20T14:00:00Z") })],
    })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundTrips[0]?.realizedPnl).toBeNull();
    expect(result.value.totals.realizedPnl).toBeNull();
  });

  it("qty scales realized P&L", async () => {
    const result = await makeUseCase({
      calendars: [
        cal({
          id: "c2",
          status: "closed",
          closedAt: new Date("2026-07-20T14:00:00Z"),
          qty: 2,
          openNetDebit: 40,
          closeNetCredit: 41,
        }),
      ],
    })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundTrips[0]?.realizedPnl).toBeCloseTo(200, 8);
  });

  it("'NaN' greek strings map to null — JSON cannot carry NaN", async () => {
    const result = await makeUseCase({
      snapshots: [
        {
          calendarId: "open-cal",
          snapshot: snap("open-cal", { netVega: "NaN", backIv: "NaN" }),
        },
      ],
    })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const open = result.value.roundTrips[0];
    expect(open?.greeks?.netVega).toBeNull();
    expect(open?.greeks?.backIv).toBeNull();
    expect(open?.greeks?.netDelta).toBeCloseTo(1.2, 10);
  });

  it("flattens executions per leg with parsed expiry/strike/type", async () => {
    const result = await makeUseCase()();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { executions } = result.value;
    expect(executions).toHaveLength(1);
    const row = executions[0];
    expect(row?.activityId).toBe(126084076124);
    expect(row?.execTime?.toISOString()).toBe("2026-07-23T19:50:12.000Z");
    expect(row?.occSymbol).toBe(FRONT);
    expect(row?.expiry).toBe("2026-08-11");
    expect(row?.strike).toBe(7400);
    expect(row?.type).toBe("P");
    expect(row?.side).toBe("sell");
    expect(row?.positionEffect).toBe("OPENING");
    expect(row?.price).toBeCloseTo(103.36, 10);
    expect(row?.netAmount).toBeCloseTo(10334.87, 10);
    expect(row?.fees).toBeCloseTo(-0.66, 10);
  });

  it("vix null when the series is absent", async () => {
    const result = await makeUseCase({ macro: [] })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vix).toBeNull();
  });
});
