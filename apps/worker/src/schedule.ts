/**
 * schedule.ts — registerAllJobs (Plan 05-04 Task 3, JOB-01/D-12).
 *
 * Extracts all pg-boss createQueue / schedule / work calls from main.ts into a single
 * exported function. main.ts imports and calls registerAllJobs; inline blocks removed.
 *
 * Registers all 10 queues:
 *   fetch-schwab-chain, fetch-rates, compute-bsm-greeks, snapshot-calendars (no cron — D-03),
 *   compute-analytics (no cron — chain-triggered by snapshot-calendars, 06-04),
 *   compute-gex-snapshot (no cron — chain-triggered by compute-analytics, 08-06 D-01),
 *   sync-transactions (every 10 min RTH, +5 min ahead of sync-fills), sync-fills (every 10 min RTH),
 *   refresh-tokens (04:00 ET daily), rebuild-journal (no cron — on-demand only)
 *
 * CRITICAL (RESEARCH Pitfall 2):
 *   snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (D-03 / Pitfall 2)
 *   compute-analytics: NO schedule — chain-triggered only by snapshot-calendars (06-04)
 *   compute-gex-snapshot: NO schedule — chain-triggered only by compute-analytics (08-06 D-01)
 *   rebuild-journal: NO schedule — on-demand via trigger_job
 *
 * createQueue → schedule → work order enforced (CR-01: FK constraint on pg-boss schedule table).
 * All calls are idempotent — safe to call on every boot.
 *
 * Architecture: pg-boss specifics confined here; main.ts is composition-only (architecture-boundaries.md §3).
 */

import type { PgBoss, Job, WorkOptions } from "pg-boss";

/** Handler type shared by all 10 job queues (pg-boss v12 array pattern) */
export type PgBossHandler = (jobs: ReadonlyArray<Job | undefined>) => Promise<void>;

/**
 * JobScheduler — minimal interface for the pg-boss operations used by registerAllJobs.
 * Exposes only the exact call forms used in this file so tests can inject a plain fake.
 * PgBoss satisfies this interface structurally (createQueue/schedule/work shapes match).
 */
export type JobScheduler = {
  createQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data: null, opts: { tz: string }): Promise<unknown>;
  work(name: string, opts: WorkOptions, handler: PgBossHandler): Promise<unknown>;
};

/**
 * AllHandlers — typed handler map for all 10 queues.
 * Plans 05-05/05-07/05-08 wire the original handlers; 08-06 adds computeGexSnapshot.
 */
export type AllHandlers = {
  readonly fetchSchwabChain: PgBossHandler;
  readonly fetchRates: PgBossHandler;
  readonly computeBsmGreeks: PgBossHandler;
  readonly snapshotCalendars: PgBossHandler;
  readonly computeAnalytics: PgBossHandler;
  readonly computeGexSnapshot: PgBossHandler;
  readonly syncTransactions: PgBossHandler;
  readonly syncFills: PgBossHandler;
  readonly refreshTokens: PgBossHandler;
  readonly rebuildJournal: PgBossHandler;
};

const POLLING_INTERVAL = { pollingIntervalSeconds: 30 };

/**
 * registerAllJobs — create 10 queues, schedule 6 crons, register 10 handlers.
 *
 * Order: createQueue (all 10) → schedule (6 crons) → work (all 10).
 * The createQueue phase must complete before schedule/work — pg-boss FK constraint (CR-01).
 */
export async function registerAllJobs(boss: JobScheduler, handlers: AllHandlers): Promise<void> {
  // ── Phase 1: create queues (idempotent — safe on every boot) ──────────────────
  // Order matters: all createQueue calls must precede schedule/work (CR-01). 10 queues.
  await boss.createQueue("fetch-schwab-chain");
  await boss.createQueue("fetch-rates");
  await boss.createQueue("compute-bsm-greeks");
  await boss.createQueue("snapshot-calendars"); // chain-triggered only; no cron (D-03)
  await boss.createQueue("compute-analytics"); // 06-04: chain-triggered by snapshot-calendars; no cron
  await boss.createQueue("compute-gex-snapshot"); // 08-06: chain-triggered by compute-analytics; no cron (D-01)
  await boss.createQueue("sync-transactions"); // A4: fills source — runs before sync-fills
  await boss.createQueue("sync-fills");
  await boss.createQueue("refresh-tokens");
  await boss.createQueue("rebuild-journal"); // on-demand only; no cron

  // ── Phase 2: schedules (idempotent — safe on every boot) ─────────────────────
  // Existing 3 crons preserved from main.ts:
  await boss.schedule(
    "fetch-schwab-chain",
    "*/30 * * * 1-5", // every 30 min Mon-Fri ET
    null,
    { tz: "America/New_York" },
  );
  await boss.schedule(
    "fetch-rates",
    "0 9 * * 1-5", // daily 09:00 ET Mon-Fri
    null,
    { tz: "America/New_York" },
  );
  await boss.schedule(
    "compute-bsm-greeks",
    "0 10-16 * * 1-5", // sparse fallback: hourly 10:00-16:00 ET Mon-Fri
    null,
    { tz: "America/New_York" },
  );

  // Crons added in Phase 5:
  // A4: ingest broker transactions into fills BEFORE sync-fills pairs them. Offset 5 min
  // earlier in each 10-min slot so fresh fills are present when sync-fills runs.
  await boss.schedule(
    "sync-transactions",
    "5,15,25,35,45,55 9-16 * * 1-5", // every 10 min RTH, offset +5 min ahead of sync-fills
    null,
    { tz: "America/New_York" },
  );
  await boss.schedule(
    "sync-fills",
    "*/10 9-16 * * 1-5", // every 10 min RTH (D-12 / D-13)
    null,
    { tz: "America/New_York" },
  );
  await boss.schedule(
    "refresh-tokens",
    "0 4 * * *", // daily 04:00 ET (D-13 — outside RTH by design)
    null,
    { tz: "America/New_York" },
  );

  // snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (D-03 / Pitfall 2)
  // compute-analytics: NO schedule — chain-triggered only by snapshot-calendars (06-04)
  // compute-gex-snapshot: NO schedule — chain-triggered only by compute-analytics (08-06 D-01)
  // rebuild-journal: NO schedule — on-demand via trigger_job

  // ── Phase 3: register handlers (work) ─────────────────────────────────────────
  await boss.work("fetch-schwab-chain", POLLING_INTERVAL, handlers.fetchSchwabChain);
  await boss.work("fetch-rates", POLLING_INTERVAL, handlers.fetchRates);
  await boss.work("compute-bsm-greeks", POLLING_INTERVAL, handlers.computeBsmGreeks);
  await boss.work("snapshot-calendars", POLLING_INTERVAL, handlers.snapshotCalendars);
  await boss.work("compute-analytics", POLLING_INTERVAL, handlers.computeAnalytics);
  await boss.work("compute-gex-snapshot", POLLING_INTERVAL, handlers.computeGexSnapshot);
  await boss.work("sync-transactions", POLLING_INTERVAL, handlers.syncTransactions);
  await boss.work("sync-fills", POLLING_INTERVAL, handlers.syncFills);
  await boss.work("refresh-tokens", POLLING_INTERVAL, handlers.refreshTokens);
  await boss.work("rebuild-journal", POLLING_INTERVAL, handlers.rebuildJournal);
}
