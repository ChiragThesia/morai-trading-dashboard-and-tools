/**
 * usePicker.test.ts — TDD suite for the usePicker hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → returns the parsed PickerSnapshotResponse.
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *   3. 404 response (no snapshot computed yet, D-18 cold start) → resolves to `null`, NOT an
 *      error — Analyzer.tsx renders a distinct "Picker warming up" message for this case.
 *   4. Other non-2xx response → throws a generic Error.
 *
 * Mirrors useCot.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { PickerSnapshotResponse } from "@morai/contracts";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { usePicker } from "./usePicker.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SNAPSHOT: PickerSnapshotResponse = {
  asOf: "2026-07-02",
  observedAt: "2026-07-02T14:32:00.000Z",
  spot: 7498.85,
  source: "schwab",
  gexContextStatus: "ok",
  marketSession: "rth",
  eventsContextStatus: "ok",
  termStructure: [{ dte: 21, iv: 0.1249 }],
  gex: { flip: 7472.65, callWall: 7525, putWall: 7400, netGammaAtSpot: 26.23, absGammaStrike: 7500, nearTerm: null },
  events: [{ date: "2026-07-03", name: "NFP" }],
  candidates: [],
  ruleSet: [],
  gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
  // 28-03: the fixture predates the entry gate — matches the schema's read-seam default.
  gate: {
    vix: null,
    vix3m: null,
    ratio: null,
    asOf: null,
    state: "open",
    penaltyMultiplier: 1,
    brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
    reasons: [],
  },
  // 28-04: the fixture predates VIX-tiered sizing — matches the schema's read-seam default.
  sizing: { tier: null, contracts: null, vix: null },
};

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function make404Response(): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status: 404, json: () => Promise.resolve({ error: "no-snapshot" }) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePicker", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the parsed picker snapshot on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(SNAPSHOT));

    const { result } = renderHook(() => usePicker(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(SNAPSHOT);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/picker/candidates");
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => usePicker(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    expect(result.current.failureCount).toBe(1);
  });

  it("resolves to null (not an error) on 404 — cold start, no snapshot computed yet", async () => {
    mockApiFetch.mockResolvedValueOnce(make404Response());

    const { result } = renderHook(() => usePicker(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("throws a generic Error on a non-401/non-404 failure status", async () => {
    mockApiFetch.mockResolvedValue(makeErrorResponse(500));

    const { result } = renderHook(() => usePicker(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("GET /api/picker/candidates failed: 500");
  });
});
