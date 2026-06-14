// Worker composition root — Phase 3 pg-boss scheduling.
// Boot: parse config → run migrations → boot pg-boss → schedule + work four jobs.
//
// Architecture law (architecture-boundaries.md):
// - process.env read ONCE here via bootWorkerConfig; typed config flows inward.
// - No business logic in this file; only composition.
// - TDD exempt: pure wiring (tdd.md Scope).

import { PgBoss } from "pg-boss";
import { bootWorkerConfig } from "./config.ts";
import {
  runMigrations,
  makeDb,
  makePostgresCalendarsRepo,
  makePostgresCalendarSnapshotsRepo,
  makePostgresJobRunsRepo,
  makePostgresLegObservationsRepo,
  makePostgresRateObservationsRepo,
  makeCboeChainAdapter,
  makeFredRateAdapter,
} from "@morai/adapters";
import {
  makeFetchChainUseCase,
  makeFetchRateUseCase,
  makeComputeBsmGreeksUseCase,
  makeSnapshotCalendarsUseCase,
} from "@morai/core";
import { makeFetchCboeChainHandler } from "./handlers/fetch-cboe-chain.ts";
import { makeFetchRatesHandler } from "./handlers/fetch-rates.ts";
import { makeComputeBsmGreeksHandler } from "./handlers/compute-bsm-greeks.ts";
import { makeSnapshotCalendarsHandler } from "./handlers/snapshot-calendars.ts";

const config = bootWorkerConfig();

// DATA-02: idempotent boot migration over the direct connection.
// runMigrations creates a dedicated max:1 client (Pitfall 3) and closes it.
await runMigrations(config.DATABASE_URL);

// pg-boss: use DATABASE_POOL_URL if provided (preferred for job workers);
// fall back to DATABASE_URL (direct connection). pg-boss creates its own pool.
// NOTE: boss.start() creates the pgboss schema if it doesn't exist.
const bossConnectionString = config.DATABASE_POOL_URL ?? config.DATABASE_URL;
const boss = new PgBoss(bossConnectionString);
await boss.start();

// Build Drizzle DB instance (direct connection for repos)
const db = makeDb(config.DATABASE_URL);

// Build repos
const calendarsRepo = makePostgresCalendarsRepo(db);
const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);
const _jobRunsRepo = makePostgresJobRunsRepo(db);
const legObsRepo = makePostgresLegObservationsRepo(db);
const rateObsRepo = makePostgresRateObservationsRepo(db);

// Build HTTP adapters
const cboeAdapter = makeCboeChainAdapter({
  fetch: globalThis.fetch,
  userAgent: "morai-worker/0.0.1",
});

const fredAdapter = makeFredRateAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
  fallbackRate: config.BSM_RATE_FALLBACK,
});

// Build the four use-cases with config-injected tunables (D-13)
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: cboeAdapter.fetchChain,
  persistObservations: legObsRepo.persistObservations,
  upsertContracts: legObsRepo.upsertContracts,
  // D-04: targeted-fetch — open calendar legs bypass the DTE/band filter
  getOpenCalendarLegs: calendarsRepo.getOpenCalendarLegs,
  maxDte: config.BSM_MAX_DTE,
  strikeBandPct: config.BSM_STRIKE_BAND_PCT,
  now: () => new Date(),
});

const fetchRateUseCase = makeFetchRateUseCase({
  fetchRate: fredAdapter,
  persistRate: rateObsRepo.persistRate,
});

const computeBsmGreeksUseCase = makeComputeBsmGreeksUseCase({
  readPending: legObsRepo.readPendingObs,
  writeBsm: legObsRepo.writeBsmResults,
  readRate: rateObsRepo.readRate,
  dividendYield: config.BSM_DIVIDEND_YIELD,
  fallbackRate: config.BSM_RATE_FALLBACK,
  now: () => new Date(),
});

const snapshotCalendarsUseCase = makeSnapshotCalendarsUseCase({
  getOpenCalendars: calendarsRepo.getOpenCalendars,
  resolveLegs: calendarSnapshotsRepo.resolveLegSnapshot,
  persistSnapshot: calendarSnapshotsRepo.persistSnapshot,
  now: () => new Date(),
});

// Build handlers (thin adapters — zero business logic)
const fetchCboeChainHandler = makeFetchCboeChainHandler({
  fetchChainUseCase,
  boss,
  now: () => new Date(),
});

const fetchRatesHandler = makeFetchRatesHandler({
  fetchRateUseCase,
  now: () => new Date(),
});

const computeBsmGreeksHandler = makeComputeBsmGreeksHandler({
  computeBsmGreeksUseCase,
  boss,
  now: () => new Date(),
});

const snapshotCalendarsHandler = makeSnapshotCalendarsHandler({
  snapshotCalendarsUseCase,
  now: () => new Date(),
});

// Create queues before scheduling/working — pg-boss v12 requires the queue row to exist
// (FK on the schedule table) before boss.schedule() or boss.work() (CR-01).
// createQueue is idempotent — safe to call on every boot.
// No fifth/manual-trigger queue (D-08).
await boss.createQueue("fetch-cboe-chain");
await boss.createQueue("fetch-rates");
await boss.createQueue("compute-bsm-greeks");
await boss.createQueue("snapshot-calendars"); // chain-triggered only; no schedule (D-03)

// Schedule three jobs in ET (D-06, D-07).
// snapshot-calendars is NOT scheduled — chain-triggered only via compute-bsm-greeks (D-03 / Pitfall 5).
// boss.schedule is idempotent — safe to call on every boot.
// No manual trigger registration (D-08).
await boss.schedule(
  "fetch-cboe-chain",
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

// Register handlers — pg-boss v12 array handler pattern (Pitfall 2)
await boss.work("fetch-cboe-chain", { pollingIntervalSeconds: 30 }, fetchCboeChainHandler);
await boss.work("fetch-rates", { pollingIntervalSeconds: 30 }, fetchRatesHandler);
await boss.work("compute-bsm-greeks", { pollingIntervalSeconds: 30 }, computeBsmGreeksHandler);
await boss.work("snapshot-calendars", { pollingIntervalSeconds: 30 }, snapshotCalendarsHandler);
// NO boss.schedule for snapshot-calendars — chain-triggered only (D-03 / Pitfall 5)

console.warn(
  "morai worker: pg-boss started, 4 queues created, 3 jobs scheduled (fetch-cboe-chain, fetch-rates, compute-bsm-greeks); snapshot-calendars chain-triggered only",
);
