/**
 * snapshot-calendars handler tests.
 *
 * Covers:
 *   - Holiday: use-case NOT called, warn issued (CAL-05)
 *   - Outside RTH (weekend): use-case NOT called, warn issued
 *   - Normal RTH instant: use-case IS called and result ok → no throw
 *   - Normal RTH instant: use-case err → handler throws
 *   - 06-04: on success, compute-analytics is chain-enqueued (boss.send with singletonKey)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeSnapshotCalendarsHandler } from "./snapshot-calendars.ts";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";
import type { ForRunningSnapshotCalendars } from "@morai/core";

// Fake boss capturing chain-trigger sends (06-04: snapshot → compute-analytics).
function makeFakeBoss(): BossForChainHandler & {
  readonly sends: Array<{ name: string; singletonKey: string }>;
} {
  const sends: Array<{ name: string; singletonKey: string }> = [];
  return {
    sends,
    send: async (name, _data, options) => {
      sends.push({ name, singletonKey: options.singletonKey });
      return "fake-job-id";
    },
  };
}

describe("makeSnapshotCalendarsHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Helper: create a pg-boss Job<object>
  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "snapshot-calendars",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("when now is a NYSE holiday: journal write skipped BUT compute-analytics still chained", async () => {
    // 2026-01-01 (New Year's Day) at 14:00 UTC = 09:00 EST — inside RTH hours but a holiday
    const holidayRth = new Date("2026-01-01T14:00:00Z");

    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => holidayRth,
    });

    await handler([makeJob()]);

    expect(snapshotCalendarsUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    // 24/7 compute: the journal gate must NOT sever the analytics→gex→picker chain.
    expect(boss.sends).toEqual([
      { name: "compute-analytics", singletonKey: "triggered-by-snapshot" },
    ]);
  });

  it("when now is outside RTH (weekend): journal write skipped BUT compute-analytics still chained", async () => {
    // Saturday 2026-06-13 14:00 UTC — weekend, outside RTH
    const outsideRth = new Date("2026-06-13T14:00:00Z");

    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => outsideRth,
    });

    await handler([makeJob()]);

    expect(snapshotCalendarsUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(boss.sends).toEqual([
      { name: "compute-analytics", singletonKey: "triggered-by-snapshot" },
    ]);
  });

  it("when inside RTH on a normal weekday: use-case IS called and no throw on ok", async () => {
    // Monday 2026-06-15 14:00 UTC = 10:00 EDT — inside RTH
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    await handler([makeJob()]);

    expect(snapshotCalendarsUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
    // 06-04: success chain-triggers compute-analytics with the singleton key.
    expect(boss.sends).toEqual([
      { name: "compute-analytics", singletonKey: "triggered-by-snapshot" },
    ]);
  });

  it("does NOT enqueue compute-analytics when the use-case errors", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const snapshotCalendarsUseCase: ForRunningSnapshotCalendars = async () =>
      err({ kind: "storage-error", message: "boom" });

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("boom");
    expect(boss.sends).toEqual([]);
  });

  it("when inside RTH + use-case err: handler throws Error (pg-boss marks job failed)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const snapshotCalendarsUseCase: ForRunningSnapshotCalendars = async () =>
      err({ kind: "storage-error", message: "DB write failed" });

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("DB write failed");
  });

  it("propagates {trigger:'event-move'} job payload to the use-case", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    const job: Job<object> = {
      id: "test-job-id",
      name: "snapshot-calendars",
      data: { trigger: "event-move" },
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };

    await handler([job]);

    expect(snapshotCalendarsUseCase).toHaveBeenCalledWith({ trigger: "event-move" });
  });

  it("defaults to trigger:'scheduled' when the job payload has no trigger field", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    await handler([makeJob()]);

    expect(snapshotCalendarsUseCase).toHaveBeenCalledWith({ trigger: "scheduled" });
  });

  it("defaults to trigger:'scheduled' when the job payload has an invalid trigger value", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    const job: Job<object> = {
      id: "test-job-id",
      name: "snapshot-calendars",
      data: { trigger: "not-a-real-trigger" },
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };

    await handler([job]);

    expect(snapshotCalendarsUseCase).toHaveBeenCalledWith({ trigger: "scheduled" });
  });

  it("an event-move trigger payload still skips the journal write off-hours (RTH gate on the write only)", async () => {
    const outsideRth = new Date("2026-06-13T14:00:00Z");
    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => outsideRth,
    });

    const job: Job<object> = {
      id: "test-job-id",
      name: "snapshot-calendars",
      data: { trigger: "event-move" },
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };

    await handler([job]);

    expect(snapshotCalendarsUseCase).not.toHaveBeenCalled();
  });

  it("when job array element is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");

    const snapshotCalendarsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const boss = makeFakeBoss();
    const handler = makeSnapshotCalendarsHandler({
      snapshotCalendarsUseCase,
      boss,
      now: () => normalRth,
    });

    // pg-boss v12 can pass undefined as first element
    await handler([undefined]);

    expect(snapshotCalendarsUseCase).not.toHaveBeenCalled();
  });
});
