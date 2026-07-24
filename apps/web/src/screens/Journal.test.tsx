/**
 * Journal.test.tsx — Trade Ledger screen (simple tables, no lifecycle chrome).
 *
 * Behaviors under test:
 *   1. Round-trips table: one row per calendar, open rows show greeks, closed rows
 *      show "—" greeks and their realized P&L; footer shows the total.
 *   2. Executions table: one row per stored leg, TOS-style columns, exec time in ET.
 *   3. Both tables live in horizontal-scroll wrappers (mobile-friendly recipe).
 *   4. Loading and error states render without tables; empty ledger shows empty state.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import type { TradeHistoryResponse } from "@morai/contracts";

// ─── Mock the data hook (screen-level tests own rendering, not fetching) ──────
const { mockUseTradeHistory } = vi.hoisted(() => ({
  mockUseTradeHistory: vi.fn(),
}));
vi.mock("../hooks/useTradeHistory.ts", () => ({
  useTradeHistory: mockUseTradeHistory,
}));
import { Journal } from "./Journal.tsx";

const FIXTURE: TradeHistoryResponse = {
  roundTrips: [
    {
      calendarId: "550e8400-e29b-41d4-a716-446655440001",
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
      greeks: {
        netDelta: 1.2,
        netTheta: 38.5,
        netVega: 112.3,
        frontIv: 0.145,
        backIv: 0.139,
        termSlope: -0.006,
        asOf: "2026-07-23T19:30:00.000Z",
      },
    },
    {
      calendarId: "550e8400-e29b-41d4-a716-446655440002",
      underlying: "SPXW",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-08-07",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "closed",
      openedAt: "2026-07-16T14:00:00.000Z",
      closedAt: "2026-07-23T19:50:00.000Z",
      openNetDebit: 43.27,
      closeNetCredit: 41.58,
      realizedPnl: -171.7,
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
  totals: { realizedPnl: -171.7 },
  vix: { value: 18.2, date: "2026-07-23" },
};

function mockSuccess(data: TradeHistoryResponse = FIXTURE): void {
  mockUseTradeHistory.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Journal — Trade Ledger screen", () => {
  it("renders one round-trip row per calendar with status, debit and realized P&L", () => {
    mockSuccess();
    render(<Journal />);

    const openRow = screen.getByTestId(
      "roundtrip-row-550e8400-e29b-41d4-a716-446655440001",
    );
    const closedRow = screen.getByTestId(
      "roundtrip-row-550e8400-e29b-41d4-a716-446655440002",
    );
    expect(openRow.textContent).toContain("SPXW 7400P");
    expect(openRow.textContent).toContain("open");
    expect(openRow.textContent).toContain("40.08");
    expect(closedRow.textContent).toContain("SPXW 7500P");
    // signedUsd convention: U+2212 minus, 2dp trimmed (lib/position-format.ts).
    expect(closedRow.textContent).toContain("−$171.7");
  });

  it("open rows show greeks; closed rows show em-dash greeks", () => {
    mockSuccess();
    render(<Journal />);

    const openRow = screen.getByTestId(
      "roundtrip-row-550e8400-e29b-41d4-a716-446655440001",
    );
    expect(openRow.textContent).toContain("14.5%"); // frontIv
    const closedRow = screen.getByTestId(
      "roundtrip-row-550e8400-e29b-41d4-a716-446655440002",
    );
    expect(closedRow.textContent).toContain("—");
  });

  it("footer shows the total realized P&L; no VIX chip (live VIX lives in the top strip)", () => {
    mockSuccess();
    render(<Journal />);

    expect(screen.getByTestId("roundtrip-total").textContent).toContain("−$171.7");
    expect(screen.queryByText(/VIX/)).toBeNull();
  });

  it("renders executions TOS-style: ET exec time, side, effect, strike, net amount", () => {
    mockSuccess();
    render(<Journal />);

    const row = screen.getByTestId("execution-row-126084076124-0");
    // 19:50Z = 3:50 PM ET (EDT) — rendered in America/New_York explicitly.
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
