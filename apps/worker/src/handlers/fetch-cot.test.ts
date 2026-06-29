/**
 * fetch-cot handler tests (COT-01).
 *
 * Covers:
 *   - use-case ok → handler resolves (no throw)
 *   - use-case err → handler throws (pg-boss marks job failed for retry)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - No RTH gate (weekly CFTC job — no isWithinRth call)
 *   - No NYSE holiday gate (CFTC publishes regardless of NYSE calendar)
 *
 * Test doubles are plain stubs injected via deps — no real network/DB.
 */

import { describe, it, expect } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import type { ForRunningFetchCot } from "@morai/core";
import { makeFetchCotHandler } from "./fetch-cot.ts";

// Helper: create a minimal pg-boss Job
function makeJob(): Job<object> {
  return {
    id: "test-job-id",
    name: "fetch-cot",
    data: {},
    expireInSeconds: 900,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

describe("makeFetchCotHandler", () => {
  it("resolves without throwing when the fetchCot use-case returns ok", async () => {
    const fetchCot: ForRunningFetchCot = async () => ok(undefined);

    const handler = makeFetchCotHandler({ fetchCot });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
  });

  it("throws when the fetchCot use-case returns err (pg-boss retry)", async () => {
    const fetchCot: ForRunningFetchCot = async () =>
      err({ kind: "fetch-error" as const, message: "CFTC unavailable" });

    const handler = makeFetchCotHandler({ fetchCot });

    await expect(handler([makeJob()])).rejects.toThrow("CFTC unavailable");
  });

  it("throws with storage-error message when persistCotObservation fails", async () => {
    const fetchCot: ForRunningFetchCot = async () =>
      err({ kind: "storage-error" as const, message: "disk full" });

    const handler = makeFetchCotHandler({ fetchCot });

    await expect(handler([makeJob()])).rejects.toThrow("disk full");
  });

  it("no-ops when the pg-boss array element is undefined (array-guard, T-02-18)", async () => {
    let called = false;
    const fetchCot: ForRunningFetchCot = async () => {
      called = true;
      return ok(undefined);
    };

    const handler = makeFetchCotHandler({ fetchCot });

    await expect(handler([undefined])).resolves.toBeUndefined();
    expect(called).toBe(false);
  });
});
