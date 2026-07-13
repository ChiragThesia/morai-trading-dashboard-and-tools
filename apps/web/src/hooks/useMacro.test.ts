/**
 * useMacro.test.ts — TDD suite for the useMacro hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → returns parsed MacroResponse (map keyed by series id).
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *   3. Non-401 failure → throws a plain Error.
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

import { useMacro } from "./useMacro.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MACRO_RESPONSE = {
  DFF: [{ time: "2026-06-30", value: 4.33 }],
  VIXCLS: [{ time: "2026-06-30", value: 18.9 }],
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

describe("useMacro", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed macro map on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(MACRO_RESPONSE));

    const { result } = renderHook(() => useMacro(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.["DFF"]?.[0]?.value).toBe(4.33);
    expect(result.current.data?.["VIXCLS"]?.[0]?.value).toBe(18.9);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/analytics/macro");
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useMacro(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });

  it("throws a plain Error on a non-401 failure", async () => {
    // Non-401 errors go through the hook's own retry(failureCount < 3) callback (matching
    // useCot's shape), so this settles after real retry backoff — needs a longer waitFor.
    mockApiFetch.mockResolvedValue(makeErrorResponse(500));

    const { result } = renderHook(() => useMacro(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 10_000 });

    expect(result.current.error?.message).toContain("500");
  }, 15_000);
});
