/**
 * useAnalyzeCalendar.test.ts — TDD suite for the Phase 30-06 ad-hoc analyze mutation hook.
 *
 * Behaviors under test:
 *   1. Success → POST /api/picker/analyze with the request body, parses+returns
 *      {scored:true, candidate, reason:null}.
 *   2. scored:false → resolves normally (NOT an error) — binding #2, D-02.
 *   3. Non-ok HTTP status (network/auth failure) → throws, mutation surfaces isError.
 *
 * Mirrors useRuleSettings.test.ts's apiFetch-mock harness (this repo's established web-hook
 * test convention — msw is not a dependency of apps/web; only packages/adapters uses it for
 * external HTTP adapters per tdd.md).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { AnalyzeAdHocCalendarRequest, AnalyzeAdHocCalendarResponse, PickerCandidate } from "@morai/contracts";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useAnalyzeCalendar } from "./useAnalyzeCalendar.ts";

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

const REQUEST_BODY: AnalyzeAdHocCalendarRequest = {
  putCall: "P",
  strike: 7500,
  frontDte: 21,
  backDte: 45,
  qty: 1,
  frontIv: 0.15,
  backIv: 0.16,
  debit: 45.85,
  frontExpiry: "2026-08-03",
  backExpiry: "2026-08-31",
};

const SCORED_CANDIDATE: PickerCandidate = {
  id: "adhoc-30D-7500-2026-08-03-2026-08-31",
  name: "7500P 2026-08-03 / 2026-08-31",
  score: 62,
  breakdown: [{ criterion: "slope", weight: 10, rawValue: 0.05, contribution: 80 }],
  debit: 4585,
  theta: 12.3,
  vega: 45.1,
  delta: -30.2,
  gamma: null,
  fwdIv: 0.155,
  fwdIvGuard: "ok",
  slope: 0.08,
  fwdEdge: 5.1,
  expectedMove: 200,
  frontEvents: [],
  backEvents: [],
  frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.15 },
  backLeg: { strike: 7500, putCall: "P", dte: 45, iv: 0.16 },
  context: [],
  bucket: "standard",
  exitPlan: {
    profitTargetPct: 0.25,
    stopPct: 0.175,
    manageShortDte: 21,
    closeByExpiry: "2026-08-02",
    thetaCapturePct: null,
  },
};

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useAnalyzeCalendar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("POSTs the request body and resolves {scored:true, candidate} on success", async () => {
    const response: AnalyzeAdHocCalendarResponse = { scored: true, candidate: SCORED_CANDIDATE, reason: null };
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(response));

    const { result } = renderHook(() => useAnalyzeCalendar(), { wrapper });

    let resolved: AnalyzeAdHocCalendarResponse | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync(REQUEST_BODY);
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/picker/analyze",
      expect.objectContaining({ method: "POST", body: JSON.stringify(REQUEST_BODY) }),
    );
    expect(resolved).toEqual(response);
  });

  it("resolves (does not throw) on {scored:false, reason} — binding #2", async () => {
    const response: AnalyzeAdHocCalendarResponse = { scored: false, candidate: null, reason: "no-snapshot" };
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(response));

    const { result } = renderHook(() => useAnalyzeCalendar(), { wrapper });

    let resolved: AnalyzeAdHocCalendarResponse | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync(REQUEST_BODY);
    });

    expect(resolved).toEqual(response);
    expect(result.current.isError).toBe(false);
  });

  it("throws on a non-ok HTTP status (network/auth failure)", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useAnalyzeCalendar(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(REQUEST_BODY)).rejects.toThrow();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
