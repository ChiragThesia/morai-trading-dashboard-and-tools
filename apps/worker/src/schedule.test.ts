// schedule.ts — registerAllJobs tests (Plan 05-04 Task 3; updated plan 05-13 for A4; updated 11-06 GW-03)
//
// Behaviors tested:
//   - createQueue called for all 9 job names (refresh-tokens retired, GW-03)
//   - schedule called for exactly 5 jobs (sync-transactions, sync-fills + existing 3; refresh-tokens RETIRED)
//   - snapshot-calendars NOT scheduled (chain-triggered only, D-03 / Pitfall 2)
//   - compute-analytics NOT scheduled (chain-triggered by snapshot-calendars, 06-04)
//   - rebuild-journal NOT scheduled (on-demand only)
//   - refresh-tokens NOT scheduled (GW-03 sole-writer cutover: sidecar is sole refresher)
//   - sync-fills cron is every 10 min RTH tz America/New_York
//   - sync-transactions cron runs +5 min ahead of sync-fills (fills source before pairing)
//   - work() registered for all 9 queues
//   - createQueue calls precede schedule/work calls (CR-01 ordering)

import { describe, it, expect, vi } from "vitest";
import { registerAllJobs } from "./schedule.ts";
import type { AllHandlers, JobScheduler, PgBossHandler } from "./schedule.ts";
import type { WorkOptions } from "pg-boss";

// Fake boss that records all method calls — typed to satisfy JobScheduler (no as-casts needed)
function makeFakeBoss() {
  const createQueueCalls: string[] = [];
  const scheduleCalls: Array<{ name: string; cron: string; tz: string }> = [];
  const workCalls: string[] = [];
  const callOrder: string[] = [];

  const boss: JobScheduler = {
    createQueue: vi.fn(async (name: string): Promise<void> => {
      createQueueCalls.push(name);
      callOrder.push(`createQueue:${name}`);
    }),
    schedule: vi.fn(async (name: string, cron: string, _data: null, opts: { tz: string }): Promise<void> => {
      scheduleCalls.push({ name, cron, tz: opts.tz });
      callOrder.push(`schedule:${name}`);
    }),
    work: vi.fn(async (name: string, _opts: WorkOptions, _handler: PgBossHandler): Promise<void> => {
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
    computeAnalytics: handler,
    computeGexSnapshot: handler,
    syncTransactions: handler,
    syncFills: handler,
    rebuildJournal: handler,
  };
}

// GW-03: refresh-tokens retired from schedule — 9 queues, 5 crons
const ALL_9_QUEUES = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "compute-analytics",
  "compute-gex-snapshot",
  "sync-transactions",
  "sync-fills",
  "rebuild-journal",
];

const SCHEDULED_5 = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "sync-transactions",
  "sync-fills",
];

describe("registerAllJobs", () => {
  it("calls createQueue for all 9 job names (refresh-tokens retired, GW-03)", async () => {
    const { boss, createQueueCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(createQueueCalls.sort()).toEqual(ALL_9_QUEUES.sort());
  });

  it("calls schedule for exactly 5 jobs (refresh-tokens retired, GW-03)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(scheduleCalls).toHaveLength(5);
    const scheduledNames = scheduleCalls.map((c) => c.name).sort();
    expect(scheduledNames).toEqual(SCHEDULED_5.sort());
  });

  it("sync-transactions cron runs +5 min ahead of sync-fills, tz America/New_York", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const syncTx = scheduleCalls.find((c) => c.name === "sync-transactions");
    expect(syncTx).toBeDefined();
    expect(syncTx?.cron).toBe("5,15,25,35,45,55 9-16 * * 1-5");
    expect(syncTx?.tz).toBe("America/New_York");
  });

  it("does NOT schedule snapshot-calendars (chain-triggered only, Pitfall 2)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("snapshot-calendars");
  });

  it("does NOT schedule compute-analytics (chain-triggered by snapshot-calendars, 06-04)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("compute-analytics");
  });

  it("does NOT schedule rebuild-journal (on-demand only)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("rebuild-journal");
  });

  it("sync-fills cron is '*/10 9-16 * * 1-5' tz America/New_York", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const syncFills = scheduleCalls.find((c) => c.name === "sync-fills");
    expect(syncFills).toBeDefined();
    expect(syncFills?.cron).toBe("*/10 9-16 * * 1-5");
    expect(syncFills?.tz).toBe("America/New_York");
  });

  it("does NOT schedule refresh-tokens (GW-03 sole-writer cutover: sidecar is sole refresher)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("refresh-tokens");
  });

  it("calls work() for all 9 queues (refresh-tokens retired, GW-03)", async () => {
    const { boss, workCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(workCalls.sort()).toEqual(ALL_9_QUEUES.sort());
  });

  it("does NOT schedule compute-gex-snapshot (chain-triggered only by compute-analytics, 08-06 D-01)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("compute-gex-snapshot");
  });

  it("createQueue calls precede all schedule and work calls (CR-01 ordering)", async () => {
    const { boss, callOrder } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

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
