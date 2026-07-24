/**
 * Journal.test.tsx — Trade Ledger screen (simple tables + expandable per-trade history).
 *
 * Behaviors under test:
 *   1. Main table: exactly TRADE/STATUS/OPENED/CLOSED/DAYS/ENTRY/EXIT/P&L — greek symbol
 *      columns are gone; Days/Entry/Exit values render; footer total intact.
 *   2. Clicking a row expands it in place: legs mini-table (only that calendar's fills) +
 *      daily history table with NAMED greek headers + legend; re-click collapses.
 *   3. Executions table unchanged (TOS-style, ET exec time).
 *   4. Loading/error/empty states.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import type { TradeHistoryResponse, TradeDetailResponse } from "@morai/contracts";

// ─── Mock the data hooks (screen tests own rendering, not fetching) ───────────
const { mockUseTradeHistory, mockUseTradeDetail } = vi.hoisted(() => ({
  mockUseTradeHistory: vi.fn(),
  mockUseTradeDetail: vi.fn(),
}));
vi.mock("../hooks/useTradeHistory.ts", () => ({
  useTradeHistory: mockUseTradeHistory,
}));
vi.mock("../hooks/useTradeDetail.ts", () => ({
  useTradeDetail: mockUseTradeDetail,
}));
import { Journal } from "./Journal.tsx";

const OPEN_ID = "550e8400-e29b-41d4-a716-446655440001";
const CLOSED_ID = "550e8400-e29b-41d4-a716-446655440002";

const FIXTURE: TradeHistoryResponse = {
  roundTrips: [
    {
      calendarId: OPEN_ID,
      underlying: "SPXW",
      strike: 7400000,
      optionType: "P",
      frontExpiry: "2026-08-11",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "open",
      openedAt: "2026-07-23T19:50:00.000Z",
      closedAt: null,
      openNetDebit: 40.08,
      closeNetCredit: null,
      realizedPnl: null,
      greeks: null,
    },
    {
      calendarId: CLOSED_ID,
      underlying: "SPXW",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-08-07",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "closed",
      openedAt: "2026-07-16T14:00:00.000Z",
      closedAt: "2026-07-23T19:50:00.000Z",
      openNetDebit: 43.25,
      closeNetCredit: 41.58,
      realizedPnl: -167,
      greeks: null,
    },
  ],
  executions: [
    {
      activityId: 126084076124,
      execTime: "2026-07-23T19:50:12.000Z",
      tradeDate: "2026-07-23",
      orderId: 1007316230828,
      occSymbol: "SPXW  260811P07400000",
      expiry: "2026-08-11",
      strike: 7400,
      type: "P",
      side: "sell",
      qty: 1,
      positionEffect: "OPENING",
      price: 103.36,
      netAmount: 10334.87,
      fees: -0.66,
    },
    {
      activityId: 126084076125,
      execTime: null,
      tradeDate: "2026-07-23",
      orderId: null,
      occSymbol: "SPXW  260807P07500000",
      expiry: "2026-08-07",
      strike: 7500,
      type: "P",
      side: "buy",
      qty: 1,
      positionEffect: "CLOSING",
      price: 143.35,
      netAmount: -14336.13,
      fees: null,
    },
  ],
  totals: { realizedPnl: -167 },
  vix: null,
};

const DETAIL: TradeDetailResponse = {
  calendarId: OPEN_ID,
  days: [
    {
      date: "2026-07-23",
      asOf: "2026-07-23T19:30:00.000Z",
      spot: 7400.5,
      pnlOpen: 2.0,
      netDelta: 1.2,
      netGamma: -0.05,
      netTheta: 38.5,
      netVega: 112.3,
      frontIv: 0.145,
      backIv: 0.139,
      termSlope: -0.006,
      front: { mark: 103.4, iv: 0.145, delta: -40, gamma: null, theta: 550, vega: -610 },
      back: { mark: 143.5, iv: 0.139, delta: 42, gamma: 0.2, theta: -310, vega: 720 },
    },
  ],
};

function mockSuccess(data: TradeHistoryResponse = FIXTURE): void {
  mockUseTradeHistory.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-25T15:00:00Z"));
  mockUseTradeDetail.mockReturnValue({
    data: DETAIL,
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("Journal — Trade Ledger screen", () => {
  it("main table shows exactly the 8 simple columns — greek symbol columns gone", () => {
    mockSuccess();
    render(<Journal />);

    // DOM casing (CSS uppercases visually); "Trade" appears only as a header here.
    for (const h of ["Trade", "Status", "Opened", "Closed", "Days", "Entry", "Exit", "P&L"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    // The old cryptic columns are gone from the main table
    expect(screen.queryByText("Θ/d")).toBeNull();
    expect(screen.queryByText("IV f/b")).toBeNull();
    expect(screen.queryByText("Slope")).toBeNull();
  });

  it("rows show Days/Entry/Exit/P&L; open rows dash the Exit", () => {
    mockSuccess();
    render(<Journal />);

    const closedRow = screen.getByTestId(`roundtrip-row-${CLOSED_ID}`);
    expect(closedRow.textContent).toContain("SPXW 7500P");
    expect(closedRow.textContent).toContain("7"); // 7/16 → 7/23 = 7 days
    expect(closedRow.textContent).toContain("43.25");
    expect(closedRow.textContent).toContain("41.58");
    expect(closedRow.textContent).toContain("−$167");

    const openRow = screen.getByTestId(`roundtrip-row-${OPEN_ID}`);
    expect(openRow.textContent).toContain("40.08");
    expect(openRow.textContent).toContain("2"); // 7/23 → now (7/25) = 2 days
    expect(openRow.textContent).toContain("—"); // no exit yet
  });

  it("clicking a row expands it in place: legs + named-header daily history + legend; re-click collapses", () => {
    mockSuccess();
    render(<Journal />);

    fireEvent.click(screen.getByTestId(`roundtrip-row-${OPEN_ID}`));

    const detail = screen.getByTestId(`roundtrip-detail-${OPEN_ID}`);
    // Legs mini-table: only THIS calendar's fill (the 7500 closing fill is another trade)
    expect(detail.textContent).toContain("SELL");
    expect(detail.textContent).toContain("103.36");
    expect(detail.textContent).not.toContain("143.35");

    // Daily history: named greek headers + values
    for (const h of [
      "Net Delta (Δ)",
      "Net Theta (Θ)/day",
      "Net Gamma (Γ)",
      "Net Vega",
      "Front IV",
      "Back IV",
      "IV Slope (back−front)",
      "Front Delta (Δ)",
      "Back Delta (Δ)",
    ]) {
      expect(detail.textContent).toContain(h);
    }
    expect(detail.textContent).toContain("7400.5"); // SPX spot
    // Legend explains the symbols in words
    expect(detail.textContent).toContain("delta = $ per 1-pt SPX move");

    // Re-click collapses
    fireEvent.click(screen.getByTestId(`roundtrip-row-${OPEN_ID}`));
    expect(screen.queryByTestId(`roundtrip-detail-${OPEN_ID}`)).toBeNull();
  });

  it("expansion shows a loading hint while the detail is pending", () => {
    mockSuccess();
    mockUseTradeDetail.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<Journal />);

    fireEvent.click(screen.getByTestId(`roundtrip-row-${OPEN_ID}`));
    expect(
      screen.getByTestId(`roundtrip-detail-${OPEN_ID}`).textContent,
    ).toContain("Loading");
  });

  it("footer shows the total realized P&L", () => {
    mockSuccess();
    render(<Journal />);
    expect(screen.getByTestId("roundtrip-total").textContent).toContain("−$167");
  });

  it("renders executions TOS-style: ET exec time, side, effect, strike, net amount", () => {
    mockSuccess();
    render(<Journal />);

    const row = screen.getByTestId("execution-row-126084076124-0");
    expect(row.textContent).toContain("3:50");
    expect(row.textContent).toContain("SELL");
    expect(row.textContent).toContain("OPENING");
    expect(row.textContent).toContain("7400");
    expect(row.textContent).toContain("10,334.87");

    const nullTimeRow = screen.getByTestId("execution-row-126084076125-1");
    expect(nullTimeRow.textContent).toContain("—");
    expect(nullTimeRow.textContent).toContain("BUY");
  });

  it("both tables sit in horizontal-scroll wrappers (mobile recipe)", () => {
    mockSuccess();
    render(<Journal />);

    expect(screen.getByTestId("roundtrip-table-scroll").className).toContain(
      "overflow-x-auto",
    );
    expect(screen.getByTestId("execution-table-scroll").className).toContain(
      "overflow-x-auto",
    );
  });

  it("loading state renders a placeholder, error state renders a retry", () => {
    mockUseTradeHistory.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<Journal />);
    expect(screen.getByTestId("ledger-loading")).toBeTruthy();
    cleanup();

    mockUseTradeHistory.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<Journal />);
    expect(screen.getByText(/Couldn.t load/)).toBeTruthy();
  });

  it("empty ledger shows the empty state", () => {
    mockSuccess({
      roundTrips: [],
      executions: [],
      totals: { realizedPnl: null },
      vix: null,
    });
    render(<Journal />);
    expect(screen.getByText(/No trade history yet/)).toBeTruthy();
  });
});
