/**
 * sync-fills handler tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - RTH gate fires: use-case NOT called outside RTH or on NYSE holiday
 *   - Normal RTH: handler delegates to syncFillsUseCase
 *   - Use-case error: handler throws (signals failure to pg-boss for retry)
 *   - pg-boss v12 guard: undefined job in array → no-op
 *   - Zod payload parse error → throws with informative message
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-07 implements makeSyncFillsHandler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeSyncFillsHandler } from "./sync-fills.ts";

describe("makeSyncFillsHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(): Job<object> {
    return {
      id: "test-sync-job",
      name: "sync-fills",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("when now is a NYSE holiday: use-case NOT called (RTH gate)", async () => {
    // 2026-01-01 (New Year's Day) at 14:00 UTC = 09:00 ET — inside RTH hours but a holiday
    const holidayRth = new Date("2026-01-01T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => holidayRth,
    });

    await handler([makeJob()]);
    expect(syncFillsUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("when outside RTH (weekend): use-case NOT called", async () => {
    // Saturday 2026-06-13 14:00 UTC — weekend
    const outsideRth = new Date("2026-06-13T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => outsideRth,
    });

    await handler([makeJob()]);
    expect(syncFillsUseCase).not.toHaveBeenCalled();
  });

  it("when inside RTH on a normal weekday + success: use-case called once", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => normalRth,
    });

    await handler([makeJob()]);
    expect(syncFillsUseCase).toHaveBeenCalledOnce();
  });

  it("when use-case returns err: handler throws (signals failure to pg-boss)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "DB write failed" }),
    );

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => normalRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => normalRth,
    });

    await handler([undefined]);
    expect(syncFillsUseCase).not.toHaveBeenCalled();
  });
});

describe("makeSyncFillsHandler — null job.data (prod regression 2026-07-09/10)", () => {
  // pg-boss cron fires deliver data:null on some paths; Zod's object schema rejects null
  // with "expected object, received null" — the exact recurring prod error. A null/absent
  // payload IS the normal full-sweep payload; the handler must treat it as {}.
  it("runs the use-case when job.data is null instead of throwing", async () => {
    const rth = new Date("2026-06-11T15:00:00Z"); // Thursday 11:00 ET, inside RTH
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const handler = makeSyncFillsHandler({ syncFillsUseCase, now: () => rth });

    const job: Job<unknown> = {
      id: "test-null-payload",
      name: "sync-fills",
      data: null,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
    await handler([job]);
    expect(syncFillsUseCase).toHaveBeenCalledOnce();
  });
});
