/**
 * useRepullChains.test.ts — mutation hook for the Analyzer "Re-pull chains" button.
 *
 * Behaviors under test:
 *   1. POSTs to /api/jobs/fetch-schwab-chain/trigger and returns the parsed jobId.
 *   2. Non-2xx → mutation errors.
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

import { useRepullChains } from "./useRepullChains.ts";

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRepullChains", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("POSTs the trigger and returns the parsed jobId", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ jobId: "job-123" }),
    });

    const { result } = renderHook(() => useRepullChains(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ jobId: "job-123" });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/jobs/fetch-schwab-chain/trigger",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("errors on a non-2xx response", async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useRepullChains(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
