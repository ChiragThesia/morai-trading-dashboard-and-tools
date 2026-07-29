/**
 * usePricedChain.test.ts — TDD suite for the priced-chain fetch hook.
 *
 * Same contract as `useChain` (parse-don't-cast, non-retryable 401), plus the two things that
 * are specific to this endpoint:
 *   - the WING is a query parameter, so it belongs in the query key or a toggle serves stale rows
 *   - the wing toggle must not blank the table while the new wing is in flight
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

import { usePricedChain } from "./usePricedChain.ts";

const STRIKE = {
  strike: 6400,
  iv: 0.1249,
  bid: 40.1,
  ask: 41.9,
  openInterest: 1234,
  delta: -0.31,
  gamma: 0.0004,
  theta: -2.1,
  vega: 5.4,
  vSkew: 0.002,
};

function body(over: Record<string, unknown> = {}): unknown {
  return {
    asOf: "2026-07-26T18:00:00.000Z",
    spot: 6500.25,
    contractType: "P",
    cohorts: [
      {
        root: "SPXW",
        expiration: "2026-08-21",
        dte: 26,
        t: 0.0712,
        atmStrike: 6500,
        atmIv: 0.15,
        strikes: [STRIKE],
      },
    ],
    ...over,
  };
}

function okResponse(payload: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function errorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePricedChain", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed surface and asks the server for the wing it was given", async () => {
    mockApiFetch.mockResolvedValueOnce(okResponse(body()));

    const { result } = renderHook(() => usePricedChain("P"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.cohorts).toHaveLength(1);
    expect(result.current.data?.cohorts[0]?.strikes[0]?.strike).toBe(6400);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/chain/priced?contractType=P");
  });

  it("keeps a null IV and null greeks null — never coerced to 0", async () => {
    const gap = { ...STRIKE, iv: null, delta: null, gamma: null, theta: null, vega: null, vSkew: null };
    mockApiFetch.mockResolvedValueOnce(
      okResponse(body({ cohorts: [{ root: "SPXW", expiration: "2026-08-21", dte: 26, t: 0.0712, atmStrike: 6500, atmIv: null, strikes: [gap] }] })),
    );

    const { result } = renderHook(() => usePricedChain("P"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row = result.current.data?.cohorts[0]?.strikes[0];
    expect([row?.iv, row?.delta, row?.vSkew]).toEqual([null, null, null]);
    // The market itself is still there — a gap is not a deletion.
    expect(row?.bid).toBe(40.1);
  });

  // The wing is a QUERY PARAM, so it has to be part of the cache key. Keyed on "chain-priced"
  // alone, flipping to calls would serve the put response out of cache and the whole table would
  // silently be the wrong wing — every number present, nothing to dash.
  it("caches per wing, so switching wings actually refetches", async () => {
    mockApiFetch.mockResolvedValue(okResponse(body({ contractType: "C" })));

    const initialProps: { wing: "C" | "P" } = { wing: "P" };
    const { result, rerender } = renderHook(({ wing }: { wing: "C" | "P" }) => usePricedChain(wing), {
      wrapper,
      initialProps,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ wing: "C" });
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith("/api/chain/priced?contractType=C"),
    );
  });

  // The put/call toggle is a control the owner clicks constantly. Without previous data held
  // across the key change, every click empties `data` for one round trip and the table drops to
  // the "Loading chain…" panel — a full-screen flash on a two-state toggle.
  it("holds the previous wing's rows on screen while the new wing is in flight", async () => {
    mockApiFetch.mockResolvedValue(okResponse(body()));

    const initialProps: { wing: "C" | "P" } = { wing: "P" };
    const { result, rerender } = renderHook(({ wing }: { wing: "C" | "P" }) => usePricedChain(wing), {
      wrapper,
      initialProps,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ wing: "C" });
    expect(result.current.data).toBeDefined();
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(errorResponse(401));

    const { result } = renderHook(() => usePricedChain("P"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });

  it("fails on a body that does not match the contract", async () => {
    mockApiFetch.mockResolvedValue(okResponse(body({ contractType: "X" })));

    const { result } = renderHook(() => usePricedChain("P"), { wrapper });

    await waitFor(() => expect(result.current.failureCount).toBeGreaterThan(0));
    expect(result.current.data).toBeUndefined();
  });

  it("fails on a non-OK, non-401 response", async () => {
    mockApiFetch.mockResolvedValue(errorResponse(500));

    const { result } = renderHook(() => usePricedChain("P"), { wrapper });

    await waitFor(() => expect(result.current.failureCount).toBeGreaterThan(0));
    expect(result.current.failureReason?.message).toContain("500");
  });
});
