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

/** Boss spy for the D-03-style success chain — records send calls. */
function makeBossSpy(): {
  readonly boss: { readonly send: (name: string, data: object, options: { readonly singletonKey: string }) => Promise<string | null> };
  readonly calls: Array<{ name: string; options: { singletonKey: string } }>;
} {
  const calls: Array<{ name: string; options: { singletonKey: string } }> = [];
  return {
    calls,
    boss: {
      send: (name, _data, options) => {
        calls.push({ name, options });
        return Promise.resolve(null);
      },
    },
  };
}

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
      boss: makeBossSpy().boss,
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
      boss: makeBossSpy().boss,
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
      boss: makeBossSpy().boss,
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
      boss: makeBossSpy().boss,
    });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncFillsHandler({
      syncFillsUseCase,
      now: () => normalRth,
      boss: makeBossSpy().boss,
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
    const handler = makeSyncFillsHandler({ syncFillsUseCase, now: () => rth, boss: makeBossSpy().boss });

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

// ─── Broker-book-as-source-of-truth chain (2026-07-20 user directive) ─────────────────
//
// Rolls create new broker legs; the calendar registry (exit advisor, journal) only
// learns about them via register-open-calendars, which was on-demand only — after the
// 07-10/07-16 rolls the whole registry sat closed and the exit advisor said "No open
// positions" against a live book. Every successful sync-fills now enqueues
// register-open-calendars (fire-and-forget, singletonKey dedup) so the registry
// follows the broker book automatically.
describe("makeSyncFillsHandler — register-open-calendars success chain", () => {
  const normalRth = new Date("2026-06-15T14:00:00Z");

  function makeChainJob(): Job<object> {
    return {
      id: "test-sync-job",
      name: "sync-fills",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("on success: enqueues register-open-calendars with a singletonKey", async () => {
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const spy = makeBossSpy();
    const handler = makeSyncFillsHandler({ syncFillsUseCase, now: () => normalRth, boss: spy.boss });

    await handler([makeChainJob()]);

    expect(spy.calls).toEqual([
      { name: "register-open-calendars", options: { singletonKey: "triggered-by-sync-fills" } },
    ]);
  });

  it("on use-case failure: does NOT enqueue register-open-calendars", async () => {
    const syncFillsUseCase = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "DB write failed" }),
    );
    const spy = makeBossSpy();
    const handler = makeSyncFillsHandler({ syncFillsUseCase, now: () => normalRth, boss: spy.boss });

    await expect(handler([makeChainJob()])).rejects.toThrow();
    expect(spy.calls).toEqual([]);
  });

  it("outside RTH: does NOT enqueue register-open-calendars", async () => {
    const weekend = new Date("2026-06-14T14:00:00Z"); // Sunday
    const syncFillsUseCase = vi.fn().mockResolvedValue(ok(undefined));
    const spy = makeBossSpy();
    const handler = makeSyncFillsHandler({ syncFillsUseCase, now: () => weekend, boss: spy.boss });

    await handler([makeChainJob()]);
    expect(spy.calls).toEqual([]);
  });
});
