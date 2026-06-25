/**
 * useCalendars.test.ts — TDD suite for the useCalendars hook.
 *
 * Behaviors under test:
 *   1. Successful fetch → returns parsed ListCalendarsResponse.
 *   2. 401 response → throws UnauthorizedError (non-retryable).
 *   3. Non-401 error → throws a generic Error.
 *
 * Mirrors the pattern of useGex.test.ts / usePositions usage pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Mock apiFetch ───────────────────────────────────────────────────────────
const { mockApiFetch } = vi.hoisted(() => ({
  // Typed as vi.fn returning unknown; actual shape matches what the queryFn reads
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

// ─── Import hook after vi.mock hoisting ─────────────────────────────────────
import { useCalendars } from "./useCalendars.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_CALENDAR_LIST = {
  calendars: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      underlying: "SPX",
      strike: 7425000,
      optionType: "P" as const,
      frontExpiry: "2026-08-08",
      backExpiry: "2026-09-19",
      qty: 1,
      openNetDebit: 5.8,
      status: "open" as const,
      openedAt: "2026-06-01T14:30:00.000Z",
      closedAt: null,
      notes: null,
    },
  ],
};

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useCalendars", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns parsed calendars list on success", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(SAMPLE_CALENDAR_LIST));

    const { result } = renderHook(() => useCalendars(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.calendars).toHaveLength(1);
    expect(result.current.data?.calendars[0]?.underlying).toBe("SPX");
    expect(result.current.data?.calendars[0]?.strike).toBe(7425000);
  });

  it("throws UnauthorizedError (non-retryable) on 401", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(401));

    const { result } = renderHook(() => useCalendars(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("UNAUTHORIZED");
    // retry count should be 0 — the hook does not retry 401s
    expect(result.current.failureCount).toBe(1);
  });

});
