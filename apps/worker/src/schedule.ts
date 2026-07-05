/**
 * schedule.ts — registerAllJobs (Plan 05-04 Task 3, JOB-01/D-12; updated 11-06 GW-03; 13-05
 * COT-01; 19-08 PICK-01/PICK-03; JRNL-01 pnl-unit-mismatch fix; journal-pnl-opennetdebit-units
 * round 3: wipe-derived-fills).
 *
 * Extracts all pg-boss createQueue / schedule / work calls from main.ts into a single
 * exported function. main.ts imports and calls registerAllJobs; inline blocks removed.
 *
 * Registers all 14 queues (GW-03: refresh-tokens retired — sidecar is sole token writer):
 *   fetch-schwab-chain, fetch-rates, compute-bsm-greeks, snapshot-calendars (no cron — D-03),
 *   compute-analytics (no cron — chain-triggered by snapshot-calendars, 06-04),
 *   compute-gex-snapshot (no cron — chain-triggered by compute-analytics, 08-06 D-01),
 *   sync-transactions (every 10 min RTH, +5 min ahead of sync-fills), sync-fills (every 10 min RTH),
 *   rebuild-journal (no cron — on-demand only),
 *   fetch-cot (weekly Friday 17:00 ET — COT-01/D-07),
 *   compute-picker (no cron — chain-triggered by compute-gex-snapshot, 19-08 D-04),
 *   fetch-economic-events (weekly Friday 17:00 ET — 19-08 D-14),
 *   recompute-snapshot-pnl (no cron — on-demand only, JRNL-01 data-correction path),
 *   wipe-derived-fills (no cron — on-demand only, account-wide fills-side-correction follow-up)
 *
 * CRITICAL (RESEARCH Pitfall 2):
 *   snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (D-03 / Pitfall 2)
 *   compute-analytics: NO schedule — chain-triggered only by snapshot-calendars (06-04)
 *   compute-gex-snapshot: NO schedule — chain-triggered only by compute-analytics (08-06 D-01)
 *   compute-picker: NO schedule — chain-triggered only by compute-gex-snapshot (19-08 D-04)
 *   rebuild-journal: NO schedule — on-demand via trigger_job
 *   recompute-snapshot-pnl: NO schedule — on-demand via trigger_job (JRNL-01)
 *   wipe-derived-fills: NO schedule — on-demand via trigger_job (destructive account-wide op)
 *   refresh-tokens: RETIRED (GW-03) — Python sidecar is the sole Schwab token refresher
 *
 * createQueue → schedule → work order enforced (CR-01: FK constraint on pg-boss schedule table).
 * All calls are idempotent — safe to call on every boot.
 *
 * Architecture: pg-boss specifics confined here; main.ts is composition-only (architecture-boundaries.md §3).
 */

import type { PgBoss, Job, WorkOptions } from "pg-boss";

/** Handler type shared by all 12 job queues (pg-boss v12 array pattern) */
export type PgBossHandler = (jobs: ReadonlyArray<Job | undefined>) => Promise<void>;

/**
 * JobScheduler — minimal interface for the pg-boss operations used by registerAllJobs.
 * Exposes only the exact call forms used in this file so tests can inject a plain fake.
 * PgBoss satisfies this interface structurally (createQueue/schedule/work shapes match).
 */
export type JobScheduler = {
  createQueue(name: string): Promise<unknown>;
  schedule(
    name: string,
    cron: string,
    data: null,
    opts: { tz: string; key?: string },
  ): Promise<unknown>;
  work(name: string, opts: WorkOptions, handler: PgBossHandler): Promise<unknown>;
};

/**
 * AllHandlers — typed handler map for all 14 queues.
 * Plans 05-05/05-07/05-08 wire the original handlers; 08-06 adds computeGexSnapshot.
 * 11-06 (GW-03): refreshTokens removed — sidecar is sole token writer.
 * 13-05 (COT-01): fetchCot added — weekly CFTC COT report (Friday 17:00 ET).
 * 19-08 (PICK-01/PICK-03): computePicker (chain-triggered, D-04) + fetchEconomicEvents
 * (weekly cron, D-14) added.
 * JRNL-01 (pnl-unit-mismatch fix): recomputeSnapshotPnl added (on-demand only, mirrors
 * rebuildJournal — re-derives frozen historical pnl_open after an openNetDebit correction).
 * journal-pnl-opennetdebit-units round 3: wipeDerivedFills added (on-demand only,
 * account-wide — deletes fills/calendar_events/orphan_fills so a re-ingest writes fresh data).
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
  readonly rebuildJournal: PgBossHandler;
  readonly fetchCot: PgBossHandler;
  readonly computePicker: PgBossHandler;
  readonly fetchEconomicEvents: PgBossHandler;
  readonly recomputeSnapshotPnl: PgBossHandler;
  readonly wipeDerivedFills: PgBossHandler;
};

const POLLING_INTERVAL = { pollingIntervalSeconds: 30 };

/**
 * registerAllJobs — create 14 queues, schedule 8 crons (7 jobs, fetch-rates twice), register 14 handlers.
 *
 * Order: createQueue (all 14) → schedule (8 crons) → work (all 14).
 * The createQueue phase must complete before schedule/work — pg-boss FK constraint (CR-01).
 * GW-03: refresh-tokens queue/cron/handler retired — sidecar is sole Schwab token writer.
 * COT-01: fetch-cot added — weekly Friday 17:00 ET cron (D-07).
 * 14-05 (D-06): fetch-rates scheduled TWICE (09:00 ET + 18:30 ET, Mon-Fri) — single queue,
 * two cron registrations serving the same handler.
 * 19-08: compute-picker added (chain-triggered only, no cron, D-04); fetch-economic-events
 * added (weekly Friday 17:00 ET cron, D-14).
 * JRNL-01 (pnl-unit-mismatch fix): recompute-snapshot-pnl added (on-demand only, no cron —
 * mirrors rebuild-journal).
 * journal-pnl-opennetdebit-units round 3: wipe-derived-fills added (on-demand only, no cron,
 * account-wide — deletes fills/calendar_events/orphan_fills for the fills-side-correction
 * follow-up).
 */
export async function registerAllJobs(boss: JobScheduler, handlers: AllHandlers): Promise<void> {
  // ── Phase 1: create queues (idempotent — safe on every boot) ──────────────────
  // Order matters: all createQueue calls must precede schedule/work (CR-01). 14 queues.
  await boss.createQueue("fetch-schwab-chain");
  await boss.createQueue("fetch-rates");
  await boss.createQueue("compute-bsm-greeks");
  await boss.createQueue("snapshot-calendars"); // chain-triggered only; no cron (D-03)
  await boss.createQueue("compute-analytics"); // 06-04: chain-triggered by snapshot-calendars; no cron
  await boss.createQueue("compute-gex-snapshot"); // 08-06: chain-triggered by compute-analytics; no cron (D-01)
  await boss.createQueue("sync-transactions"); // A4: fills source — runs before sync-fills
  await boss.createQueue("sync-fills");
  await boss.createQueue("rebuild-journal"); // on-demand only; no cron
  await boss.createQueue("fetch-cot"); // COT-01: weekly CFTC COT report (Friday 17:00 ET, D-07)
  await boss.createQueue("compute-picker"); // 19-08: chain-triggered by compute-gex-snapshot; no cron (D-04)
  await boss.createQueue("fetch-economic-events"); // 19-08: weekly FRED+FOMC events refresh (D-14)
  await boss.createQueue("recompute-snapshot-pnl"); // JRNL-01 pnl-unit-mismatch fix: on-demand only; no cron
  await boss.createQueue("wipe-derived-fills"); // journal-pnl-opennetdebit-units round 3: on-demand only, account-wide; no cron
  // refresh-tokens: RETIRED (GW-03) — sidecar auto-refreshes both Schwab apps; no TS refresher

  // ── Phase 2: schedules (idempotent — safe on every boot) ─────────────────────
  // Existing 3 crons preserved from main.ts:
  await boss.schedule(
    "fetch-schwab-chain",
    "*/30 * * * 1-5", // every 30 min Mon-Fri ET
    null,
    { tz: "America/New_York" },
  );
  // Review CR-01: pg-boss v12 UPSERTS schedules on (name, key) with key defaulting to ''
  // (timekeeper.js `key = ''`; plans.js ON CONFLICT (name, key) DO UPDATE). The two
  // fetch-rates crons MUST carry distinct keys or the second call silently overwrites the
  // first and only the 18:30 ET run ever fires (D-06 broken).
  // NOTE (prod cleanup): the pre-fix keyless ("fetch-rates", '') row is NOT removed by this
  // code and will keep firing at whatever cron it last held. Delete it once at deploy:
  //   DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';
  await boss.schedule(
    "fetch-rates",
    "0 9 * * 1-5", // daily 09:00 ET Mon-Fri (morning — catches SOFR's T+1 lag)
    null,
    { tz: "America/New_York", key: "morning" },
  );
  // 14-05 (D-06): second daily fetch-rates run — evening catches same-day VIXCLS/treasury
  // prints. Idempotent (same-key re-schedule upserts in place); safe on every boot. Same
  // queue, no new handler — registerAllJobs still creates exactly one fetch-rates queue.
  await boss.schedule(
    "fetch-rates",
    "30 18 * * 1-5", // daily 18:30 ET Mon-Fri (evening)
    null,
    { tz: "America/New_York", key: "evening" },
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

  // COT-01 (13-05): weekly CFTC COT report — Friday after close (D-07)
  await boss.schedule(
    "fetch-cot",
    "0 17 * * 5", // weekly Friday 17:00 ET (after market close, D-07)
    null,
    { tz: "America/New_York" },
  );

  // 19-08 (D-14): weekly economic-events refresh (FRED CPI/NFP release dates + FOMC seed) —
  // identical cron/tz to fetch-cot (own queue name, own handler; CR-01 distinct-key discipline
  // n/a here since this is the ONLY schedule() call for this queue name).
  await boss.schedule(
    "fetch-economic-events",
    "0 17 * * 5", // weekly Friday 17:00 ET (D-14 default, matches fetch-cot's slot)
    null,
    { tz: "America/New_York" },
  );

  // snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (D-03 / Pitfall 2)
  // compute-analytics: NO schedule — chain-triggered only by snapshot-calendars (06-04)
  // compute-gex-snapshot: NO schedule — chain-triggered only by compute-analytics (08-06 D-01)
  // compute-picker: NO schedule — chain-triggered only by compute-gex-snapshot (19-08 D-04)
  // rebuild-journal: NO schedule — on-demand via trigger_job
  // recompute-snapshot-pnl: NO schedule — on-demand via trigger_job (JRNL-01, mirrors rebuild-journal)
  // wipe-derived-fills: NO schedule — on-demand via trigger_job (journal-pnl-opennetdebit-units
  //   round 3; destructive account-wide op — must never run on a cron)
  // refresh-tokens: RETIRED (GW-03) — sidecar handles Schwab token refresh; no TS scheduled job

  // ── Phase 3: register handlers (work) ─────────────────────────────────────────
  // 12 handlers (GW-03: refresh-tokens retired; 13-05: fetchCot added; 19-08: computePicker +
  // fetchEconomicEvents added)
  await boss.work("fetch-schwab-chain", POLLING_INTERVAL, handlers.fetchSchwabChain);
  await boss.work("fetch-rates", POLLING_INTERVAL, handlers.fetchRates);
  await boss.work("compute-bsm-greeks", POLLING_INTERVAL, handlers.computeBsmGreeks);
  await boss.work("snapshot-calendars", POLLING_INTERVAL, handlers.snapshotCalendars);
  await boss.work("compute-analytics", POLLING_INTERVAL, handlers.computeAnalytics);
  await boss.work("compute-gex-snapshot", POLLING_INTERVAL, handlers.computeGexSnapshot);
  await boss.work("sync-transactions", POLLING_INTERVAL, handlers.syncTransactions);
  await boss.work("sync-fills", POLLING_INTERVAL, handlers.syncFills);
  await boss.work("rebuild-journal", POLLING_INTERVAL, handlers.rebuildJournal);
  await boss.work("fetch-cot", POLLING_INTERVAL, handlers.fetchCot);
  await boss.work("compute-picker", POLLING_INTERVAL, handlers.computePicker);
  await boss.work("fetch-economic-events", POLLING_INTERVAL, handlers.fetchEconomicEvents);
  await boss.work("recompute-snapshot-pnl", POLLING_INTERVAL, handlers.recomputeSnapshotPnl);
  await boss.work("wipe-derived-fills", POLLING_INTERVAL, handlers.wipeDerivedFills);
}
