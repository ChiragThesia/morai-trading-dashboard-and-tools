/**
 * useRuleTags.test.ts — TDD suite for the RULE-01 data hook.
 *
 * Behaviors under test (plan 20-11 Task 1):
 *   1. Fetch → GET /api/journal/:calendarId/rules, parses + exposes events+tags.
 *   2. Save success → PUT /api/journal/events/:hash/rules, then the events data reflects the
 *      server-confirmed tags (non-optimistic: no local flip before the PUT resolves).
 *   3. Save failure → surfaces an error keyed by fillIdsHash; retry(hash) resubmits the SAME
 *      payload and clears the error on success.
 *
 * Mirrors usePicker.test.ts's apiFetch-mock harness.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { GetEventsWithRulesResponse, SetRuleTagsResponse } from "@morai/contracts";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useRuleTags } from "./useRuleTags.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HASH = "a".repeat(64);

const EVENTS_RESPONSE: GetEventsWithRulesResponse = {
  events: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      eventType: "OPEN",
      eventedAt: "2026-06-12T14:00:00.000Z",
      fillIdsHash: HASH,
      legOccSymbol: "SPXW  260712P07375000",
      tags: [],
      otherNote: null,
    },
  ],
};

function withTags(tags: ReadonlyArray<string>): GetEventsWithRulesResponse {
  const event = EVENTS_RESPONSE.events[0];
  if (event === undefined) throw new Error("fixture missing event");
  return { events: [{ ...event, tags: [...tags] }] };
}

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function makeSetResponse(tags: ReadonlyArray<string>): SetRuleTagsResponse {
  return { fillIdsHash: HASH, tags: [...tags], otherNote: null, updatedAt: "2026-07-05T14:00:00.000Z" };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRuleTags", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("fetches and parses the combined events+rule-tag payload", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(EVENTS_RESPONSE));

    const { result } = renderHook(() => useRuleTags("cal-1"), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.events).toEqual(EVENTS_RESPONSE.events);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/journal/cal-1/rules");
  });

  it("save is non-optimistic — events reflect the new tags only after the PUT resolves + refetch", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(EVENTS_RESPONSE)) // initial GET
      .mockResolvedValueOnce(makeOkResponse(makeSetResponse(["profit-target"]))) // PUT
      .mockResolvedValueOnce(makeOkResponse(withTags(["profit-target"]))); // refetch GET

    const { result } = renderHook(() => useRuleTags("cal-1"), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.events[0]?.tags).toEqual([]);

    await act(async () => {
      await result.current.save(HASH, ["profit-target"]);
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/api/journal/events/${HASH}/rules`,
      expect.objectContaining({ method: "PUT" }),
    );
    await waitFor(() => expect(result.current.events[0]?.tags).toEqual(["profit-target"]));
    expect(result.current.errors[HASH]).toBeUndefined();
  });

  it("save failure surfaces an error keyed by fillIdsHash; retry resubmits the same payload", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(EVENTS_RESPONSE)) // initial GET
      .mockResolvedValueOnce(makeErrorResponse(500)) // PUT fails
      .mockResolvedValueOnce(makeOkResponse(makeSetResponse(["max-loss"]))) // retry PUT succeeds
      .mockResolvedValueOnce(makeOkResponse(withTags(["max-loss"]))); // refetch after retry

    const { result } = renderHook(() => useRuleTags("cal-1"), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    await act(async () => {
      await result.current.save(HASH, ["max-loss"]);
    });

    expect(result.current.errors[HASH]).toBe("Couldn't save rule tags.");

    act(() => {
      result.current.retry(HASH);
    });

    await waitFor(() => expect(result.current.errors[HASH]).toBeUndefined());
    await waitFor(() => expect(result.current.events[0]?.tags).toEqual(["max-loss"]));

    // retry resubmitted the exact same payload as the original save
    expect(mockApiFetch).toHaveBeenCalledTimes(4);
  });
});
