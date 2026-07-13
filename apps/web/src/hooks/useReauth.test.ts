/**
 * useReauth.test.ts — TDD suite for the Phase 37-06 re-auth wizard data hook.
 *
 * Mirrors useRuleSettings.test.ts's apiFetch-mock harness (apps/web has no msw — 30-06 decision).
 *
 * Behaviors under test:
 *   1. startReauth POSTs /api/reauth/start with { app }, parses + returns the slim { authUrl }.
 *   2. exchangeReauth POSTs /api/reauth/exchange with { redirectUrl }, parses + returns
 *      { app, ok }.
 *   3. A successful exchange (ok: true) invalidates the ["status"] query.
 *   4. A failed exchange (ok: false) does NOT invalidate ["status"].
 *   5. A non-ok HTTP response throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useReauth } from "./useReauth.ts";

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useReauth", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("startReauth POSTs /api/reauth/start and returns the parsed slim { authUrl } (no state)", async () => {
    // CR-02 regression: the server route deliberately returns { authUrl } ONLY — the CSRF state
    // never crosses into the browser (T-37-06). The hook must parse that real body; a schema that
    // requires `state` rejects the genuine server response and the wizard's Authorize button
    // silently does nothing.
    mockApiFetch.mockResolvedValueOnce(
      makeOkResponse({ authUrl: "https://schwab.example/authorize?x=1" }),
    );

    const { result } = renderHook(() => useReauth(), { wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.startReauth("trader");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/reauth/start",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ app: "trader" }) }),
    );
    expect(response).toEqual({ authUrl: "https://schwab.example/authorize?x=1" });
  });

  it("exchangeReauth POSTs /api/reauth/exchange and returns the parsed {app, ok}", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ app: "trader", ok: true }));

    const { result } = renderHook(() => useReauth(), { wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.exchangeReauth("https://morai.wtf/?code=abc&state=xyz");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/reauth/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ redirectUrl: "https://morai.wtf/?code=abc&state=xyz" }),
      }),
    );
    expect(response).toEqual({ app: "trader", ok: true });
  });

  it("invalidates the status query on a successful exchange", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ app: "trader", ok: true }));

    const { result } = renderHook(() => useReauth(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.exchangeReauth("https://morai.wtf/?code=abc&state=xyz");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["status"] });
  });

  it("does not invalidate the status query when exchange returns ok:false", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse({ app: "trader", ok: false }));

    const { result } = renderHook(() => useReauth(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.exchangeReauth("https://morai.wtf/?code=abc&state=xyz");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("throws when the start POST fails", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(500));

    const { result } = renderHook(() => useReauth(), { wrapper });

    await expect(result.current.startReauth("market")).rejects.toThrow(
      "POST /api/reauth/start failed: 500",
    );
  });
});
