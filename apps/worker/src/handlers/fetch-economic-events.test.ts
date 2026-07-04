/**
 * fetch-economic-events handler tests (Phase 19, Plan 08 — PICK-03, D-14).
 *
 * Covers:
 *   - fetch ok + persist ok → handler resolves (no throw), persist called with fetched rows
 *   - fetch err → handler throws (pg-boss retry); persist NOT called
 *   - persist err → handler throws (pg-boss retry)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - No RTH gate (weekly cron job — runs regardless of RTH, like fetch-cot)
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import type { ForFetchingEconomicEvents, ForPersistingEconomicEvents } from "@morai/core";
import { makeFetchEconomicEventsHandler } from "./fetch-economic-events.ts";

// Helper: create a minimal pg-boss Job
function makeJob(): Job<object> {
  return {
    id: "test-job-id",
    name: "fetch-economic-events",
    data: {},
    expireInSeconds: 900,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

const SAMPLE_EVENTS = [
  { date: "2026-07-29", name: "FOMC" as const, source: "seed" as const },
  { date: "2026-07-14", name: "CPI" as const, source: "fred" as const },
];

describe("makeFetchEconomicEventsHandler", () => {
  it("resolves without throwing when fetch ok + persist ok, and persists the fetched rows", async () => {
    const persistEconomicEvents = vi.fn().mockResolvedValue(ok(undefined));
    const fetchEconomicEvents: ForFetchingEconomicEvents = async () => ok(SAMPLE_EVENTS);

    const handler = makeFetchEconomicEventsHandler({
      fetchEconomicEvents,
      persistEconomicEvents,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
    expect(persistEconomicEvents).toHaveBeenCalledWith(SAMPLE_EVENTS);
  });

  it("throws when the fetch use-case returns err (pg-boss retry); persist NOT called", async () => {
    const persistEconomicEvents = vi.fn().mockResolvedValue(ok(undefined));
    const fetchEconomicEvents: ForFetchingEconomicEvents = async () =>
      err({ kind: "fetch-error" as const, message: "FRED API key missing" });

    const handler = makeFetchEconomicEventsHandler({
      fetchEconomicEvents,
      persistEconomicEvents,
    });

    await expect(handler([makeJob()])).rejects.toThrow("FRED API key missing");
    expect(persistEconomicEvents).not.toHaveBeenCalled();
  });

  it("throws when the persist port returns err (pg-boss retry)", async () => {
    const fetchEconomicEvents: ForFetchingEconomicEvents = async () => ok(SAMPLE_EVENTS);
    const persistEconomicEvents: ForPersistingEconomicEvents = async () =>
      err({ kind: "storage-error" as const, message: "disk full" });

    const handler = makeFetchEconomicEventsHandler({
      fetchEconomicEvents,
      persistEconomicEvents,
    });

    await expect(handler([makeJob()])).rejects.toThrow("disk full");
  });

  it("no-ops when the pg-boss array element is undefined (array-guard, T-02-18)", async () => {
    const fetchEconomicEvents = vi.fn().mockResolvedValue(ok(SAMPLE_EVENTS));
    const persistEconomicEvents = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeFetchEconomicEventsHandler({
      fetchEconomicEvents,
      persistEconomicEvents,
    });

    await expect(handler([undefined])).resolves.toBeUndefined();
    expect(fetchEconomicEvents).not.toHaveBeenCalled();
    expect(persistEconomicEvents).not.toHaveBeenCalled();
  });
});
