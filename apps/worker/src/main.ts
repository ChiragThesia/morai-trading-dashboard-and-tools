// Worker composition root — pg-boss scheduling.
// Boot: parse config → run migrations → boot pg-boss → register all 9 jobs via registerAllJobs.
//
// Architecture law (architecture-boundaries.md):
// - process.env read ONCE here via bootWorkerConfig; typed config flows inward.
// - No business logic in this file; only composition.
// - TDD exempt: pure wiring (tdd.md Scope).

import { randomUUID, createHash } from "node:crypto";
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
  makePostgresBrokerTokensRepo,
  makePostgresCalendarEventsRepo,
  makePostgresOrphanFillsRepo,
  makePostgresFillsRepo,
  makeCboeChainAdapter,
  makeSchwabChainAdapter,
  makeSchwabOAuthClient,
  makeSchwabTransactionsAdapter,
  makeAccountHashResolver,
  makeFredRateAdapter,
  makePostgresTermStructureObservationsRepo,
  makePostgresSkewObservationsRepo,
  makePostgresRiskReversalObservationsRepo,
  makePostgresGexSnapshotRepo,
} from "@morai/adapters";
import {
  makeFetchChainUseCase,
  makeFetchRateUseCase,
  makeComputeBsmGreeksUseCase,
  makeSnapshotCalendarsUseCase,
  makeComputeAnalyticsUseCase,
  makeComputeGexSnapshotUseCase,
  makeSyncFillsUseCase,
  makeSyncFillsForCalendarUseCase,
  makeSyncTransactionsUseCase,
  hashFillIds,
  makeRebuildJournalUseCase,
  selectChainSource,
  makeRefreshTokenUseCase,
  makeRefreshTokensUseCase,
} from "@morai/core";
import { makeFetchSchwabChainHandler } from "./handlers/fetch-schwab-chain.ts";
import { makeFetchRatesHandler } from "./handlers/fetch-rates.ts";
import { makeComputeBsmGreeksHandler } from "./handlers/compute-bsm-greeks.ts";
import { makeSnapshotCalendarsHandler } from "./handlers/snapshot-calendars.ts";
import { makeComputeAnalyticsHandler } from "./handlers/compute-analytics.ts";
import { makeComputeGexSnapshotHandler } from "./handlers/compute-gex-snapshot.ts";
import { makeSyncFillsHandler } from "./handlers/sync-fills.ts";
import { makeSyncTransactionsHandler } from "./handlers/sync-transactions.ts";
import { makeRefreshTokensHandler } from "./handlers/refresh-tokens.ts";
import { makeRebuildJournalHandler } from "./handlers/rebuild-journal.ts";
import { registerAllJobs } from "./schedule.ts";

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
// AUTH-04: broker-tokens repo for per-app freshness (used by selectChainSource + T-04-26 logging)
const brokerTokensRepo = makePostgresBrokerTokensRepo(db, config.TOKEN_ENCRYPTION_KEY);

// JRNL-01: calendar-events + orphan-fills + fills repos (sync-fills, rebuild-journal).
// A5/A1: the real fills data-path repo replaces the prior stubs — sync-fills now reads
// actual unprocessed fills, rebuild re-pairs from real per-calendar fills, and amounts
// reconcile via recomputeCalendarAmounts (WR-08).
const calendarEventsRepo = makePostgresCalendarEventsRepo(db);
const orphanFillsRepo = makePostgresOrphanFillsRepo(db);
const fillsRepo = makePostgresFillsRepo(db);

const USER_AGENT = "morai-worker/0.0.1";

// Build HTTP adapters
const cboeAdapter = makeCboeChainAdapter({
  fetch: globalThis.fetch,
  userAgent: USER_AGENT,
});

// BRK-01: Schwab market chain adapter — getAccessToken reads broker_tokens for the market app
// On-demand; no pre-cached token (same pattern as server traderGetAccessToken)
const marketGetAccessToken = async () => {
  const result = await brokerTokensRepo.readTokens("market");
  if (!result.ok) {
    return { ok: false as const, error: { kind: "auth-expired" as const, appId: "market" as const } };
  }
  if (result.value === null) {
    return { ok: false as const, error: { kind: "auth-expired" as const, appId: "market" as const } };
  }
  return { ok: true as const, value: result.value.accessToken };
};

// SC3: scope the Schwab chain request to avoid HTTP 502 "Body buffer overflow".
// The full SPX chain (all expirations × all strikes) exceeds the gateway buffer.
// strikeCount=50 NTM strikes + 90-day expiry window captures near-term + calendar back months.
// fromDate/toDate computed at boot (not hardcoded) so the window slides correctly.
const schwabChainFromDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD today
const schwabChainToDate = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD today+90d
})();

const schwabMarketAdapter = makeSchwabChainAdapter({
  fetch: globalThis.fetch,
  getAccessToken: marketGetAccessToken,
  userAgent: USER_AGENT,
  symbol: "$SPX",
  strikeCount: 50,
  range: "NTM",
  fromDate: schwabChainFromDate,
  toDate: schwabChainToDate,
});

const fredAdapter = makeFredRateAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
  fallbackRate: config.BSM_RATE_FALLBACK,
});

// D-07/D-08: selectChainSource — Schwab-primary, CBOE-fallback.
// Called at job-execution time so freshness is checked per invocation (not at boot).
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: (root) =>
    selectChainSource({
      readTokenFreshness: brokerTokensRepo.readTokenFreshness,
      schwabFetchChain: schwabMarketAdapter.fetchChain,
      cboeFetchChain: cboeAdapter.fetchChain,
    }).then((fetchChain) => fetchChain(root)),
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

// ANLY-01/ANLY-02 (06-04 + 06-05): compute-analytics use-case — BOTH halves now live.
// Term-structure: readSnapshots → writeTerm (term_slope passthrough). Skew/RR (06-05): readSmile
// reads the per-strike smile from leg_observations; writeSkew persists the full smile; writeRr
// persists the 25Δ risk-reversal + trailing-window rank; readRrHistory feeds the rank window.
const termStructureRepo = makePostgresTermStructureObservationsRepo(db);
const skewRepo = makePostgresSkewObservationsRepo(db);
const riskReversalRepo = makePostgresRiskReversalObservationsRepo(db);
const computeAnalyticsUseCase = makeComputeAnalyticsUseCase({
  // term-structure half (live):
  readSnapshots: calendarSnapshotsRepo.readSnapshotsForCycle,
  writeTerm: termStructureRepo.storeTermStructureObservations,
  // skew/RR half (06-05) — real adapters:
  readSmile: legObsRepo.readSmile,
  writeSkew: skewRepo.storeSkewObservations,
  writeRr: riskReversalRepo.storeRiskReversalObservations,
  readRrHistory: riskReversalRepo.readRiskReversalHistory,
  now: () => new Date(),
});

// GEX-01 (08-05/08-06): computeGexSnapshot use-case — chain-triggered by compute-analytics.
// gexRepo provides readLegObsForGex (JOIN leg_observations × contracts) + persistGexSnapshot
// (SC-4 idempotency via onConflictDoNothing on cycle_time PK) + readGexSnapshot (used by server).
const gexRepo = makePostgresGexSnapshotRepo(db);
const computeGexSnapshotUseCase = makeComputeGexSnapshotUseCase({
  readLegObsForGex: gexRepo.readLegObsForGex,
  persistGexSnapshot: gexRepo.persistGexSnapshot,
  now: () => new Date(),
});

// Build handlers (thin adapters — zero business logic)
// D-07/D-08: Schwab-primary handler replaces the CBOE-only handler.
// fetchChainUseCase is pre-wired with selectChainSource above (Schwab→CBOE fallback).
// T-04-26: readTokenFreshness + logAuthExpiredFallback enable the operator-visible warning.
const fetchSchwabChainHandler = makeFetchSchwabChainHandler({
  fetchChainUseCase,
  boss,
  now: () => new Date(),
  readTokenFreshness: brokerTokensRepo.readTokenFreshness,
  logAuthExpiredFallback: true,
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
  // 06-04: snapshot success chain-triggers compute-analytics (mirrors compute-bsm-greeks → snapshot).
  boss,
  now: () => new Date(),
});

// 08-06: compute-analytics chain-triggers compute-gex-snapshot on success (D-01).
// boss dep added here — mirrors snapshotCalendarsHandler adding boss in 06-04.
const computeAnalyticsHandler = makeComputeAnalyticsHandler({
  computeAnalyticsUseCase,
  boss,
  now: () => new Date(),
});

const computeGexSnapshotHandler = makeComputeGexSnapshotHandler({
  computeGexSnapshotUseCase,
  now: () => new Date(),
});

// JRNL-01 (A5): sync-fills use-case — composed with the REAL fills, calendar-events, and
// orphan-fills repos. No fills stubs remain: readUnprocessedFills / readCalendarLegs /
// resetCalendarAmounts come from makePostgresFillsRepo.
// C1: id/hash adapters supplied at the composition root (node:crypto stays out of core).
const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

const syncFillsUseCase = makeSyncFillsUseCase({
  readUnprocessedFills: fillsRepo.readUnprocessedFills,
  readCalendarLegs: fillsRepo.readCalendarLegs,
  storeCalendarEvent: calendarEventsRepo.storeCalendarEvent,
  storeOrphanFill: orphanFillsRepo.storeOrphanFill,
  resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
  // B1: prior-OPEN lookup uses the real calendar_events repo.
  readCalendarEvents: calendarEventsRepo.readCalendarEvents,
  // WR-A2: stamp processed fills so re-sync never re-pairs them.
  markFillsProcessed: fillsRepo.markFillsProcessed,
  // C1: injected id minter + fill-ids hasher (reference algorithm + node sha256).
  newId: () => randomUUID(),
  hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
  now: () => new Date(),
});

const syncFillsHandler = makeSyncFillsHandler({
  syncFillsUseCase,
  now: () => new Date(),
});

// A2/CR-04 (A5): calendar-scoped sync — rebuild-journal re-pairs ONLY the target calendar
// (delete scope == sync scope). Now reads the REAL per-calendar unprocessed fills from the
// fills repo; no stub remains.
const syncFillsForCalendarUseCase = makeSyncFillsForCalendarUseCase({
  readUnprocessedFillsForCalendar: fillsRepo.readUnprocessedFillsForCalendar,
  readCalendarLegs: fillsRepo.readCalendarLegs,
  storeCalendarEvent: calendarEventsRepo.storeCalendarEvent,
  storeOrphanFill: orphanFillsRepo.storeOrphanFill,
  resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
  readCalendarEvents: calendarEventsRepo.readCalendarEvents,
  // WR-A2: stamp processed fills so per-calendar re-sync never re-pairs them.
  markFillsProcessed: fillsRepo.markFillsProcessed,
  newId: () => randomUUID(),
  hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
  now: () => new Date(),
});

// A4 (A5): sync-transactions SOURCE — populate the fills table from Schwab trader
// transactions so sync-fills has real input to pair. Uses the trader app's on-demand token
// (same pattern as the server). The trader adapter resolves the account hash itself; the
// use-case's static accountHash/from/to are computed at boot (the adapter reads them per call).
const traderGetAccessToken = async () => {
  const result = await brokerTokensRepo.readTokens("trader");
  if (!result.ok || result.value === null) {
    return { ok: false as const, error: { kind: "auth-expired" as const, appId: "trader" as const } };
  }
  return { ok: true as const, value: result.value.accessToken };
};

const traderDeps = {
  fetch: globalThis.fetch,
  getAccessToken: traderGetAccessToken,
  userAgent: USER_AGENT,
};

const accountHashResolver = makeAccountHashResolver(traderDeps);
const transactionsAdapter = makeSchwabTransactionsAdapter(traderDeps);

// fetchTransactions resolves the real account hash, then calls the adapter. The accountHash
// argument from the use-case is ignored (the resolver is authoritative — Pitfall 5).
const fetchTransactionsResolved = async (
  _accountHash: string,
  from: string,
  to: string,
) => {
  const hashResult = await accountHashResolver.resolveAccountHash();
  if (!hashResult.ok) return hashResult;
  return transactionsAdapter.fetchTransactions(hashResult.value, from, to);
};

// Window: last 7 days through today (YYYY-MM-DD). Re-syncing the same window is idempotent
// (deterministic fill ids + onConflictDoNothing), so an overlapping window is safe.
const txWindowTo = new Date().toISOString().slice(0, 10);
const txWindowFrom = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
})();

const syncTransactionsUseCase = makeSyncTransactionsUseCase({
  fetchTransactions: fetchTransactionsResolved,
  writeFills: fillsRepo.writeFills,
  // C1: injected sha256 hasher → deterministic UUID fill ids.
  hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
  accountHash: "resolved-at-call-time", // ignored by fetchTransactionsResolved (resolver wins)
  from: txWindowFrom,
  to: txWindowTo,
  now: () => new Date(),
});

const syncTransactionsHandler = makeSyncTransactionsHandler({
  syncTransactionsUseCase,
  now: () => new Date(),
});

// JOB-02 / D-13: refresh both Schwab apps independently via Promise.allSettled (plan 05-05).
// Each app has its own OAuth client built from the app-specific key/secret/callbackUrl.
// recordRefreshOutcome persists per-app refresh failure on broker_tokens.last_refresh_error
// so GET /api/status surfaces the failure flag via readTokenFreshness (D-14, flag-only).
const traderOAuthClient = makeSchwabOAuthClient({
  appKey: config.SCHWAB_TRADER_APP_KEY,
  appSecret: config.SCHWAB_TRADER_APP_SECRET,
  callbackUrl: config.SCHWAB_TRADER_CALLBACK_URL,
  fetch: globalThis.fetch,
});

const marketOAuthClient = makeSchwabOAuthClient({
  appKey: config.SCHWAB_MARKET_APP_KEY,
  appSecret: config.SCHWAB_MARKET_APP_SECRET,
  callbackUrl: config.SCHWAB_MARKET_CALLBACK_URL,
  fetch: globalThis.fetch,
});

const refreshTraderTokenUseCase = makeRefreshTokenUseCase({
  readTokens: brokerTokensRepo.readTokens,
  writeTokens: brokerTokensRepo.writeTokens,
  refreshTokens: traderOAuthClient.refreshTokens,
});

const refreshMarketTokenUseCase = makeRefreshTokenUseCase({
  readTokens: brokerTokensRepo.readTokens,
  writeTokens: brokerTokensRepo.writeTokens,
  refreshTokens: marketOAuthClient.refreshTokens,
});

const refreshTokensUseCase = makeRefreshTokensUseCase({
  refreshTraderToken: refreshTraderTokenUseCase,
  refreshMarketToken: refreshMarketTokenUseCase,
  readTokenFreshness: brokerTokensRepo.readTokenFreshness,
  now: () => new Date(),
});

const refreshTokensHandler = makeRefreshTokensHandler({
  refreshTokensUseCase,
  recordRefreshOutcome: brokerTokensRepo.recordRefreshOutcome,
  now: () => new Date(),
});

// JRNL-01 / D-10 (A5): rebuildJournal use-case — delete-then-reinsert from fills (idempotent).
// All ports are now real: deleteCalendarEvents + the calendar-scoped sync (CR-04) re-pair ONLY
// the target calendar, resetCalendarAmounts clears the aggregates, and recomputeCalendarAmounts
// repopulates openNetDebit/closeNetCredit from the rebuilt events (WR-08 / SC5 reconciliation).
const rebuildJournalUseCase = makeRebuildJournalUseCase({
  deleteCalendarEvents: calendarEventsRepo.deleteCalendarEvents,
  resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
  // WR-A2: un-mark the calendar's fills processed so the scoped re-pair re-reads them.
  resetFillsProcessedForCalendar: fillsRepo.resetFillsProcessedForCalendar,
  // CR-04: genuinely calendar-scoped — re-pairs only the target calendar (not a full sweep).
  syncFillsForCalendar: syncFillsForCalendarUseCase,
  // WR-08: recompute calendar aggregates from the rebuilt events (final reconciliation step).
  recomputeCalendarAmounts: fillsRepo.recomputeCalendarAmounts,
  now: () => new Date(),
});

const rebuildJournalHandler = makeRebuildJournalHandler({
  rebuildJournalUseCase,
  now: () => new Date(),
});

// Register all 10 queues, 6 crons, and 10 work handlers via registerAllJobs (Plan 05-04 + 08-06).
// Inline createQueue/schedule/work blocks removed — all scheduling logic is in schedule.ts.
await registerAllJobs(boss, {
  fetchSchwabChain: fetchSchwabChainHandler,
  fetchRates: fetchRatesHandler,
  computeBsmGreeks: computeBsmGreeksHandler,
  snapshotCalendars: snapshotCalendarsHandler,
  computeAnalytics: computeAnalyticsHandler,
  computeGexSnapshot: computeGexSnapshotHandler,
  syncTransactions: syncTransactionsHandler,
  syncFills: syncFillsHandler,
  refreshTokens: refreshTokensHandler,
  rebuildJournal: rebuildJournalHandler,
});

console.warn(
  "morai worker: pg-boss started; 10 queues created, 6 jobs scheduled (fetch-schwab-chain, fetch-rates, compute-bsm-greeks, sync-transactions, sync-fills, refresh-tokens); snapshot-calendars + compute-analytics + compute-gex-snapshot chain-triggered only; rebuild-journal on-demand only",
);
