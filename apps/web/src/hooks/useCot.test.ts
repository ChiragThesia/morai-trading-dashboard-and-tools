/**
 * useCot.test.ts — TDD suite for the useCot hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → returns parsed CotResponse (newest-first array).
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *
 * Mirrors useCalendars.test.ts / useGex.test.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useCot } from "./useCot.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COT_ENTRY = {
  asOf: "2026-06-23",
  publishedAt: "2026-07-01T16:48:14.548Z",
  contractCode: "13874A",
  openInterest: 1980254,
  dealerLong: 112578,
  dealerShort: 868478,
  netDealer: -755900,
  assetMgrLong: 1171421,
  assetMgrShort: 178692,
  netAssetManager: 992729,
  levMoneyLong: 185058,
  levMoneyShort: 558526,
  netLeveraged: -373468,
  otherReptLong: 62151,
  otherReptShort: 48090,
  netOther: 14061,
  nonreptLong: 260145,
  nonreptShort: 137567,
  netNonreportable: 122578,
};

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCot", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed COT series on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse([COT_ENTRY]));

    const { result } = renderHook(() => useCot(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.netLeveraged).toBe(-373468);
    expect(result.current.data?.[0]?.asOf).toBe("2026-06-23");
    expect(mockApiFetch).toHaveBeenCalledWith("/api/analytics/cot");
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useCot(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });
});
