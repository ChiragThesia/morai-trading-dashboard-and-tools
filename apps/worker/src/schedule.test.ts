// schedule.ts — registerAllJobs tests (TDD RED phase, Plan 05-04 Task 3)
//
// Behaviors tested:
//   - createQueue called for all 7 job names
//   - schedule called for exactly 5 jobs (sync-fills, refresh-tokens + existing 3)
//   - snapshot-calendars NOT scheduled (chain-triggered only, D-03 / Pitfall 2)
//   - rebuild-journal NOT scheduled (on-demand only)
//   - sync-fills cron is every 10 min RTH tz America/New_York
//   - refresh-tokens cron is 04:00 ET daily tz America/New_York
//   - work() registered for all 7 queues
//   - createQueue calls precede schedule/work calls (CR-01 ordering)

import { describe, it, expect, vi } from "vitest";
import { registerAllJobs } from "./schedule.ts";
import type { AllHandlers } from "./schedule.ts";

// Fake boss that records all method calls
function makeFakeBoss() {
  const createQueueCalls: string[] = [];
  const scheduleCalls: Array<{ name: string; cron: string; tz: string }> = [];
  const workCalls: string[] = [];
  const callOrder: string[] = [];

  const boss = {
    createQueue: vi.fn(async (name: string) => {
      createQueueCalls.push(name);
      callOrder.push(`createQueue:${name}`);
    }),
    schedule: vi.fn(async (name: string, cron: string, _data: unknown, opts: { tz: string }) => {
      scheduleCalls.push({ name, cron, tz: opts.tz });
      callOrder.push(`schedule:${name}`);
    }),
    work: vi.fn(async (name: string, _opts: unknown, _handler: unknown) => {
      workCalls.push(name);
      callOrder.push(`work:${name}`);
    }),
  };

  return { boss, createQueueCalls, scheduleCalls, workCalls, callOrder };
}

function makeFakeHandlers(): AllHandlers {
  const handler = vi.fn(async () => undefined);
  return {
    fetchSchwabChain: handler,
    fetchRates: handler,
    computeBsmGreeks: handler,
    snapshotCalendars: handler,
    syncFills: handler,
    refreshTokens: handler,
    rebuildJournal: handler,
  };
}

const ALL_7_QUEUES = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "sync-fills",
  "refresh-tokens",
  "rebuild-journal",
];

const SCHEDULED_5 = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "sync-fills",
  "refresh-tokens",
];

describe("registerAllJobs", () => {
  it("calls createQueue for all 7 job names", async () => {
    const { boss, createQueueCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    expect(createQueueCalls.sort()).toEqual(ALL_7_QUEUES.sort());
  });

  it("calls schedule for exactly 5 jobs", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    expect(scheduleCalls).toHaveLength(5);
    const scheduledNames = scheduleCalls.map((c) => c.name).sort();
    expect(scheduledNames).toEqual(SCHEDULED_5.sort());
  });

  it("does NOT schedule snapshot-calendars (chain-triggered only, Pitfall 2)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("snapshot-calendars");
  });

  it("does NOT schedule rebuild-journal (on-demand only)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("rebuild-journal");
  });

  it("sync-fills cron is '*/10 9-16 * * 1-5' tz America/New_York", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    const syncFills = scheduleCalls.find((c) => c.name === "sync-fills");
    expect(syncFills).toBeDefined();
    expect(syncFills?.cron).toBe("*/10 9-16 * * 1-5");
    expect(syncFills?.tz).toBe("America/New_York");
  });

  it("refresh-tokens cron is '0 4 * * *' tz America/New_York", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    const refreshTokens = scheduleCalls.find((c) => c.name === "refresh-tokens");
    expect(refreshTokens).toBeDefined();
    expect(refreshTokens?.cron).toBe("0 4 * * *");
    expect(refreshTokens?.tz).toBe("America/New_York");
  });

  it("calls work() for all 7 queues", async () => {
    const { boss, workCalls } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    expect(workCalls.sort()).toEqual(ALL_7_QUEUES.sort());
  });

  it("createQueue calls precede all schedule and work calls (CR-01 ordering)", async () => {
    const { boss, callOrder } = makeFakeBoss();
    await registerAllJobs(boss as never, makeFakeHandlers());

    const lastCreateQueueIdx = callOrder.reduce(
      (max, call, idx) => (call.startsWith("createQueue:") ? idx : max),
      -1,
    );
    const firstScheduleIdx = callOrder.findIndex((c) => c.startsWith("schedule:"));
    const firstWorkIdx = callOrder.findIndex((c) => c.startsWith("work:"));

    // All createQueue calls must complete before any schedule or work
    expect(lastCreateQueueIdx).toBeLessThan(firstScheduleIdx);
    expect(lastCreateQueueIdx).toBeLessThan(firstWorkIdx);
  });
});
