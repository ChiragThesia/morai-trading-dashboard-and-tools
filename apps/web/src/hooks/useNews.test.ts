/**
 * useNews.test.ts — TDD suite for the useNews hook (D28).
 *
 * Behaviors under test:
 *   1. Successful fetch → returns parsed NewsResponse (newest-first array).
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *
 * Mirrors useCot.test.ts.
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

import { useNews } from "./useNews.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NEWS_ITEM = {
  id: "24843171",
  headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
  summary: "Markets retreated after hawkish commentary.",
  source: "benzinga",
  url: "https://www.benzinga.com/markets/24843171",
  symbols: ["SPY", "QQQ"],
  publishedAt: "2026-07-24T13:05:00.000Z",
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

describe("useNews", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed news series on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse([NEWS_ITEM]));

    const { result } = renderHook(() => useNews(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.id).toBe("24843171");
    expect(result.current.data?.[0]?.symbols).toEqual(["SPY", "QQQ"]);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/analytics/news");
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useNews(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });
});
