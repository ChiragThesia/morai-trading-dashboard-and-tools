// Worker composition root — Phase 2 pg-boss scheduling.
// Boot: parse config → run migrations → boot pg-boss → schedule + work three jobs.
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
} from "@morai/core";
import { makeFetchCboeChainHandler } from "./handlers/fetch-cboe-chain.ts";
import { makeFetchRatesHandler } from "./handlers/fetch-rates.ts";
import { makeComputeBsmGreeksHandler } from "./handlers/compute-bsm-greeks.ts";

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
// calendarsRepo: available for status use-case; not used by job handlers
const _calendarsRepo = makePostgresCalendarsRepo(db);
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

// Build the three use-cases with config-injected tunables (D-13)
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: cboeAdapter.fetchChain,
  persistObservations: legObsRepo.persistObservations,
  upsertContracts: legObsRepo.upsertContracts,
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

// Build handlers (thin adapters — zero business logic)
const fetchCboeChainHandler = makeFetchCboeChainHandler({
  fetchChainUseCase,
  boss,
  now: () => new Date(),
});

const fetchRatesHandler = makeFetchRatesHandler({
  fetchRateUseCase,
});

const computeBsmGreeksHandler = makeComputeBsmGreeksHandler({
  computeBsmGreeksUseCase,
});

// Schedule three jobs in ET (D-06, D-07).
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

console.warn(
  "morai worker: pg-boss started, 3 jobs scheduled (fetch-cboe-chain, fetch-rates, compute-bsm-greeks)",
);
