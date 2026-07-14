// schedule.ts — registerAllJobs tests (Plan 05-04 Task 3; updated plan 05-13 for A4; updated 11-06 GW-03; 13-05 COT-01; 26-04 EXIT-01)
//
// Behaviors tested:
//   - createQueue called for all 10 job names (refresh-tokens retired GW-03; fetch-cot added COT-01)
//   - schedule called for exactly 6 jobs (sync-transactions, sync-fills + existing 3 + fetch-cot; refresh-tokens RETIRED)
//   - snapshot-calendars NOT scheduled (chain-triggered only, D-03 / Pitfall 2)
//   - compute-analytics NOT scheduled (chain-triggered by snapshot-calendars, 06-04)
//   - rebuild-journal NOT scheduled (on-demand only)
//   - refresh-tokens NOT scheduled (GW-03 sole-writer cutover: sidecar is sole refresher)
//   - sync-fills cron is every 10 min RTH tz America/New_York
//   - sync-transactions cron runs +5 min ahead of sync-fills (fills source before pairing)
//   - fetch-cot cron is weekly Friday 17:00 ET tz America/New_York (COT-01, D-07)
//   - fetch-rates is scheduled TWICE with distinct keys and BOTH rows survive the
//     pg-boss (name, key) upsert (09:00 ET + 18:30 ET, Mon-Fri, D-06/14-05, review CR-01)
//   - work() registered for all 10 queues
//   - createQueue calls precede schedule/work calls (CR-01 ordering)

import { describe, it, expect, vi } from "vitest";
import { registerAllJobs } from "./schedule.ts";
import type { AllHandlers, JobScheduler, PgBossHandler } from "./schedule.ts";
import type { WorkOptions } from "pg-boss";

// Fake boss that records all method calls — typed to satisfy JobScheduler (no as-casts needed).
// schedule() also models pg-boss v12 semantics: schedules are UPSERTED on (name, key) with
// key defaulting to '' (dist/plans.js ON CONFLICT (name, key) DO UPDATE). Two keyless calls
// for the same name leave ONE surviving row — the exact bug from review CR-01. Assertions
// about what production ends up with must read `scheduleStore`, not `scheduleCalls`.
function makeFakeBoss() {
  const createQueueCalls: string[] = [];
  const scheduleCalls: Array<{ name: string; cron: string; tz: string; key: string }> = [];
  // Surviving schedule rows after upserts — keyed by `${name}:${key}` like pg-boss's
  // (name, key) primary key. This is the state the pgboss.schedule table actually holds.
  const scheduleStore = new Map<string, { name: string; cron: string; tz: string; key: string }>();
  const workCalls: string[] = [];
  const callOrder: string[] = [];

  const boss: JobScheduler = {
    createQueue: vi.fn(async (name: string): Promise<void> => {
      createQueueCalls.push(name);
      callOrder.push(`createQueue:${name}`);
    }),
    schedule: vi.fn(
      async (
        name: string,
        cron: string,
        _data: null,
        opts: { tz: string; key?: string },
      ): Promise<void> => {
        const key = opts.key ?? ""; // pg-boss default: timekeeper.js `key = ''`
        const row = { name, cron, tz: opts.tz, key };
        scheduleCalls.push(row);
        scheduleStore.set(`${name}:${key}`, row); // upsert — second same-key call overwrites
        callOrder.push(`schedule:${name}`);
      },
    ),
    work: vi.fn(async (name: string, _opts: WorkOptions, _handler: PgBossHandler): Promise<void> => {
      workCalls.push(name);
      callOrder.push(`work:${name}`);
    }),
  };

  return { boss, createQueueCalls, scheduleCalls, scheduleStore, workCalls, callOrder };
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
    fetchCot: handler,
    computePicker: handler,
    computeExitAdvice: handler,
    fetchEconomicEvents: handler,
    recomputeSnapshotPnl: handler,
    wipeDerivedFills: handler,
    registerOpenCalendars: handler,
    selfHealJournal: handler,
  };
}

// GW-03: refresh-tokens retired; 13-05 COT-01: fetch-cot added; 19-08: compute-picker +
// fetch-economic-events added; JRNL-01 pnl-unit-mismatch fix: recompute-snapshot-pnl added
// (on-demand only, mirrors rebuild-journal); journal-pnl-opennetdebit-units round 3:
// wipe-derived-fills added (on-demand only, account-wide); JRNL-02: register-open-calendars
// added (on-demand only, account-wide); 26-04 EXIT-01: compute-exit-advice added
// (chain-triggered only); 40-06 HIST-03: self-heal-journal added (sparse hourly cron) —
// 17 queues, 8 crons.
const ALL_17_QUEUES = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "compute-analytics",
  "compute-gex-snapshot",
  "sync-transactions",
  "sync-fills",
  "rebuild-journal",
  "fetch-cot",
  "compute-picker",
  "compute-exit-advice",
  "fetch-economic-events",
  "recompute-snapshot-pnl",
  "wipe-derived-fills",
  "register-open-calendars",
  "self-heal-journal",
];

const SCHEDULED_8 = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "sync-transactions",
  "sync-fills",
  "fetch-cot",
  "fetch-economic-events",
  "self-heal-journal",
];

describe("registerAllJobs", () => {
  it("calls createQueue for all 17 job names (refresh-tokens retired GW-03; fetch-cot added COT-01; compute-picker + fetch-economic-events added 19-08; recompute-snapshot-pnl added JRNL-01; wipe-derived-fills added journal-pnl-opennetdebit-units round 3; register-open-calendars added JRNL-02; self-heal-journal added 40-06 HIST-03)", async () => {
    const { boss, createQueueCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(createQueueCalls.sort()).toEqual(ALL_17_QUEUES.sort());
  });

  it("calls schedule 9 times — 8 jobs, fetch-rates scheduled twice; all 9 rows survive the (name, key) upsert (14-05, D-06, CR-01)", async () => {
    const { boss, scheduleCalls, scheduleStore } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(scheduleCalls).toHaveLength(9);
    // Surviving rows must equal calls made — a keyless duplicate name would collapse to 8.
    expect(scheduleStore.size).toBe(9);
    const scheduledNames = [...new Set(scheduleCalls.map((c) => c.name))].sort();
    expect(scheduledNames).toEqual(SCHEDULED_8.sort());
  });

  it("schedules fetch-rates TWICE with distinct keys — both rows SURVIVE the pg-boss (name, key) upsert (D-06, 14-05, review CR-01)", async () => {
    const { boss, scheduleStore } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    // Read the surviving store, NOT the call log: pg-boss upserts on (name, key), so two
    // keyless schedule() calls leave one row and the 09:00 ET run never fires (CR-01).
    const surviving = [...scheduleStore.values()].filter((s) => s.name === "fetch-rates");
    expect(surviving).toHaveLength(2);
    expect(new Set(surviving.map((s) => s.key)).size).toBe(2);
    expect(surviving.map((s) => s.cron).sort()).toEqual(
      ["0 9 * * 1-5", "30 18 * * 1-5"].sort(),
    );
    for (const s of surviving) {
      expect(s.tz).toBe("America/New_York");
    }
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

  it("calls work() for all 17 queues (refresh-tokens retired GW-03; fetch-cot added COT-01; compute-picker + fetch-economic-events added 19-08; recompute-snapshot-pnl added JRNL-01; wipe-derived-fills added journal-pnl-opennetdebit-units round 3; register-open-calendars added JRNL-02; self-heal-journal added 40-06 HIST-03)", async () => {
    const { boss, workCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    expect(workCalls.sort()).toEqual(ALL_17_QUEUES.sort());
  });

  it("self-heal-journal cron is '0 * * * *' tz America/New_York (HIST-03, sparse hourly, no RTH gate — D-05)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const selfHeal = scheduleCalls.find((c) => c.name === "self-heal-journal");
    expect(selfHeal).toBeDefined();
    expect(selfHeal?.cron).toBe("0 * * * *");
    expect(selfHeal?.tz).toBe("America/New_York");
  });

  it("does NOT schedule recompute-snapshot-pnl (on-demand only, mirrors rebuild-journal — JRNL-01)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("recompute-snapshot-pnl");
  });

  it("does NOT schedule wipe-derived-fills (on-demand only, account-wide — journal-pnl-opennetdebit-units round 3)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("wipe-derived-fills");
  });

  it("does NOT schedule register-open-calendars (on-demand only, account-wide — JRNL-02)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("register-open-calendars");
  });

  it("does NOT schedule compute-picker (chain-triggered only by compute-gex-snapshot, 19-08 D-04)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("compute-picker");
  });

  it("does NOT schedule compute-exit-advice (chain-triggered only by compute-picker, 26-04 EXIT-01)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const names = scheduleCalls.map((c) => c.name);
    expect(names).not.toContain("compute-exit-advice");
  });

  it("fetch-economic-events cron is '0 17 * * 5' tz America/New_York (19-08, weekly Friday 17:00 ET, D-14)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const fetchEvents = scheduleCalls.find((c) => c.name === "fetch-economic-events");
    expect(fetchEvents).toBeDefined();
    expect(fetchEvents?.cron).toBe("0 17 * * 5");
    expect(fetchEvents?.tz).toBe("America/New_York");
  });

  it("fetch-cot cron is '0 17 * * 5' tz America/New_York (COT-01, Friday 17:00 ET, D-07)", async () => {
    const { boss, scheduleCalls } = makeFakeBoss();
    await registerAllJobs(boss, makeFakeHandlers());

    const fetchCot = scheduleCalls.find((c) => c.name === "fetch-cot");
    expect(fetchCot).toBeDefined();
    expect(fetchCot?.cron).toBe("0 17 * * 5");
    expect(fetchCot?.tz).toBe("America/New_York");
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
