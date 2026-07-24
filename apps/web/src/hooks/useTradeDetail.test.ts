/**
 * useTradeDetail.test.ts — Trade Ledger expansion data hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → parsed TradeDetailResponse.
 *   2. 401 → UnauthorizedError (non-retryable).
 *   3. calendarId null → query disabled, apiFetch never called.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

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

import { useTradeDetail } from "./useTradeDetail.ts";

const CAL = "550e8400-e29b-41d4-a716-446655440001";

const SAMPLE_DETAIL = {
  calendarId: CAL,
  days: [
    {
      date: "2026-07-23",
      asOf: "2026-07-23T19:30:00.000Z",
      spot: 7400.5,
      pnlOpen: 2.0,
      netDelta: 1.2,
      netGamma: null,
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

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useTradeDetail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed detail on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(SAMPLE_DETAIL));

    const { result } = renderHook(() => useTradeDetail(CAL), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.days[0]?.front.delta).toBeCloseTo(-40, 10);
    expect(mockApiFetch).toHaveBeenCalledWith(`/api/trade-history/${CAL}/detail`);
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useTradeDetail(CAL), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.name).toBe("UnauthorizedError");
  });

  it("calendarId null → disabled, no fetch fired", async () => {
    const { result } = renderHook(() => useTradeDetail(null), { wrapper });

    // Give the query a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
