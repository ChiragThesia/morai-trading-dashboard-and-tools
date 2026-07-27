/**
 * useChain.test.ts — TDD suite for the chain fetch hook.
 *
 * Behaviors under test (the useCot/useGex contract, verbatim):
 *   1. Successful fetch → the body parsed through the chain schema, never cast.
 *   2. 401 → UnauthorizedError, non-retryable (failureCount stays 1).
 *   3. A body that does not match the row contract → error, not a silent pass.
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

import { useChain } from "./useChain.ts";

const ROW = {
  strike: 6400_000,
  expiration: "2026-08-21",
  contractType: "P",
  dte: 26,
  bsmIv: 0.1249,
  bid: 40.1,
  ask: 41.9,
  openInterest: 1234,
  underlyingPrice: 6500.25,
  source: "schwab",
  observedAt: "2026-07-26T18:00:00.000Z",
};

function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function errorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useChain", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed chain rows on success", async () => {
    mockApiFetch.mockResolvedValueOnce(okResponse({ rows: [ROW] }));

    const { result } = renderHook(() => useChain(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.rows).toHaveLength(1);
    expect(result.current.data?.rows[0]?.strike).toBe(6400_000);
    expect(result.current.data?.rows[0]?.bsmIv).toBe(0.1249);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/chain");
  });

  it("keeps a null bsmIv null — never coerced to 0", async () => {
    mockApiFetch.mockResolvedValueOnce(okResponse({ rows: [{ ...ROW, bsmIv: null }] }));

    const { result } = renderHook(() => useChain(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0]?.bsmIv).toBeNull();
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(errorResponse(401));

    const { result } = renderHook(() => useChain(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });

  // The two cases below are retryable (unlike 401), so they assert the FIRST failure
  // rather than waiting out the 1s/2s/4s backoff to reach isError.
  it("fails on a body that does not match the row contract", async () => {
    mockApiFetch.mockResolvedValue(okResponse({ rows: [{ ...ROW, contractType: "X" }] }));

    const { result } = renderHook(() => useChain(), { wrapper });

    await waitFor(() => expect(result.current.failureCount).toBeGreaterThan(0));
    expect(result.current.data).toBeUndefined();
  });

  it("fails on a non-OK, non-401 response", async () => {
    mockApiFetch.mockResolvedValue(errorResponse(500));

    const { result } = renderHook(() => useChain(), { wrapper });

    await waitFor(() => expect(result.current.failureCount).toBeGreaterThan(0));
    expect(result.current.failureReason?.message).toContain("500");
  });
});
