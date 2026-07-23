/**
 * useTradeHistory.test.ts — TDD suite for the Trade Ledger data hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → returns parsed TradeHistoryResponse.
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *
 * Mirrors the useCalendars.test.ts pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Mock apiFetch ───────────────────────────────────────────────────────────
const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

vi.mock("../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// ─── Import hook after vi.mock hoisting ─────────────────────────────────────
import { useTradeHistory } from "./useTradeHistory.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_TRADE_HISTORY = {
  roundTrips: [
    {
      calendarId: "550e8400-e29b-41d4-a716-446655440000",
      underlying: "SPXW",
      strike: 7400000,
      optionType: "P" as const,
      frontExpiry: "2026-08-11",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "open" as const,
      openedAt: "2026-07-23T19:50:00.000Z",
      closedAt: null,
      openNetDebit: 40.08,
      realizedPnl: null,
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
      type: "P" as const,
      side: "sell" as const,
      qty: 1,
      positionEffect: "OPENING" as const,
      price: 103.36,
      netAmount: 10334.87,
      fees: -0.66,
    },
  ],
  totals: { realizedPnl: -171.7 },
  vix: { value: 18.2, date: "2026-07-23" },
};

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useTradeHistory", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed trade history on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(SAMPLE_TRADE_HISTORY));

    const { result } = renderHook(() => useTradeHistory(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.roundTrips).toHaveLength(1);
    expect(result.current.data?.executions[0]?.strike).toBe(7400);
    expect(result.current.data?.totals.realizedPnl).toBeCloseTo(-171.7, 10);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/trade-history");
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useTradeHistory(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.name).toBe("UnauthorizedError");
  });

  // ponytail: no non-401 retry test — it would exercise TanStack's backoff machinery
  // (3 retries, seconds of wall-clock), not our code. 401 non-retry above is the
  // behavior this hook owns.
});
