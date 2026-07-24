/**
 * fetch-news handler tests (D28).
 *
 * Covers:
 *   - use-case ok → handler resolves (no throw)
 *   - use-case err → handler throws (pg-boss marks job failed for retry)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - No RTH gate (news flows 24/7; the cron fires every 5 minutes)
 *
 * Test doubles are plain stubs injected via deps — no real network/DB.
 */

import { describe, it, expect } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import type { ForRunningFetchNews } from "@morai/core";
import { makeFetchNewsHandler } from "./fetch-news.ts";

// Helper: create a minimal pg-boss Job
function makeJob(): Job<object> {
  return {
    id: "test-job-id",
    name: "fetch-news",
    data: {},
    expireInSeconds: 900,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

describe("makeFetchNewsHandler", () => {
  it("resolves without throwing when the fetchNews use-case returns ok", async () => {
    const fetchNews: ForRunningFetchNews = async () => ok(undefined);

    const handler = makeFetchNewsHandler({ fetchNews });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
  });

  it("throws when the fetchNews use-case returns err (pg-boss retry)", async () => {
    const fetchNews: ForRunningFetchNews = async () =>
      err({ kind: "fetch-error" as const, message: "alpaca unavailable" });

    const handler = makeFetchNewsHandler({ fetchNews });

    await expect(handler([makeJob()])).rejects.toThrow("alpaca unavailable");
  });

  it("throws with storage-error message when persistNewsItems fails", async () => {
    const fetchNews: ForRunningFetchNews = async () =>
      err({ kind: "storage-error" as const, message: "disk full" });

    const handler = makeFetchNewsHandler({ fetchNews });

    await expect(handler([makeJob()])).rejects.toThrow("disk full");
  });

  it("no-ops when the pg-boss array element is undefined (array-guard, T-02-18)", async () => {
    let called = false;
    const fetchNews: ForRunningFetchNews = async () => {
      called = true;
      return ok(undefined);
    };

    const handler = makeFetchNewsHandler({ fetchNews });

    await expect(handler([undefined])).resolves.toBeUndefined();
    expect(called).toBe(false);
  });
});
