// Worker composition root — pg-boss scheduling.
// Boot: parse config → run migrations → boot pg-boss → register all 13 jobs via registerAllJobs.
//
// Architecture law (architecture-boundaries.md):
// - process.env read ONCE here via bootWorkerConfig; typed config flows inward.
// - No business logic in this file; only composition.
// - TDD exempt: pure wiring (tdd.md Scope).
// 11-06 (GW-03/JRNL-02): refresh-tokens job retired; chain source swapped to sidecar adapter.
// 13-05 (COT-01): fetch-cot job added — weekly CFTC COT report (Friday 17:00 ET, D-07).
// 19-08 (PICK-01/PICK-03): compute-picker (chain-triggered by compute-gex-snapshot, D-04) +
// fetch-economic-events (weekly cron, D-14) jobs added.

import { randomUUID, createHash } from "node:crypto";
import { PgBoss } from "pg-boss";
import { ok } from "@morai/shared";
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
  makeSidecarChainAdapter,
  makeSchwabTransactionsAdapter,
  makeAccountHashResolver,
  makeFredRateAdapter,
  makePostgresTermStructureObservationsRepo,
  makePostgresSkewObservationsRepo,
  makePostgresRiskReversalObservationsRepo,
  makePostgresGexSnapshotRepo,
  makeCftcCotAdapter,
  makePostgresCotObservationsRepo,
  makeFredSeriesAdapter,
  makeCboeVvixAdapter,
  makePostgresMacroObservationsRepo,
  makeEconomicEventsAdapter,
  FOMC_SEED,
  makePostgresEconomicEventsRepo,
  makePostgresPickerChainRepo,
  makePostgresPickerSnapshotRepo,
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
  makeRecomputeSnapshotPnlUseCase,
  selectChainSource,
  makeFetchCot,
  makeFetchMacroSeries,
  makeComputePickerSnapshotUseCase,
} from "@morai/core";
import type { GexContextForPicker, GexSnapshotRow } from "@morai/core";
import { makeFetchCotHandler } from "./handlers/fetch-cot.ts";
import { makeFetchSchwabChainHandler } from "./handlers/fetch-schwab-chain.ts";
import { makeFetchRatesHandler } from "./handlers/fetch-rates.ts";
import { makeComputeBsmGreeksHandler } from "./handlers/compute-bsm-greeks.ts";
import { makeSnapshotCalendarsHandler } from "./handlers/snapshot-calendars.ts";
import { makeComputeAnalyticsHandler } from "./handlers/compute-analytics.ts";
import { makeComputeGexSnapshotHandler } from "./handlers/compute-gex-snapshot.ts";
import { makeSyncFillsHandler } from "./handlers/sync-fills.ts";
import { makeSyncTransactionsHandler } from "./handlers/sync-transactions.ts";
import { makeRebuildJournalHandler } from "./handlers/rebuild-journal.ts";
import { makeRecomputeSnapshotPnlHandler } from "./handlers/recompute-snapshot-pnl.ts";
import { makeComputePickerHandler } from "./handlers/compute-picker.ts";
import { makeFetchEconomicEventsHandler } from "./handlers/fetch-economic-events.ts";
import { registerAllJobs } from "./schedule.ts";

const config = bootWorkerConfig();

// DATA-02: idempotent boot migration over the direct connection.
// runMigrations creates a dedicated max:1 client (Pitfall 3) and closes it.
await runMigrations(config.DATABASE_URL);

// pg-boss: use DATABASE_POOL_URL if provided (preferred for job workers);
// fall back to DATABASE_URL (direct connection). pg-boss creates its own pool.
// NOTE: boss.start() creates the pgboss schema if it doesn't exist.
const bossConnectionString = config.DATABASE_POOL_URL ?? config.DATABASE_URL;
// max:4 — bounded pool for the 10 low-frequency cron queues (30s polling). Keeps the
// worker's pg-boss + Drizzle pools under the Supavisor session-pooler ceiling (see db.ts).
const boss = new PgBoss({ connectionString: bossConnectionString, max: 4 });
await boss.start();

// Build Drizzle DB instance (direct connection for repos).
// max:3 — job handlers run sequentially; a small pool is ample and bounds total usage.
const db = makeDb(config.DATABASE_URL, { max: 3 });

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

// JRNL-02 / 11-06: sidecar chain adapter — fetches the SPX option chain from the Python sidecar.
// The sidecar (schwab-py) is the sole Schwab boundary; it handles auth + chain fetch.
// CBOE fallback (selectChainSource) remains unchanged: AUTH_EXPIRED → CBOE source.
const sidecarAdapter = makeSidecarChainAdapter({
  fetch: globalThis.fetch,
  sidecarUrl: config.SIDECAR_URL,
});

const fredAdapter = makeFredRateAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
  fallbackRate: config.BSM_RATE_FALLBACK,
});

// D-07/D-08: selectChainSource — sidecar-primary (JRNL-02), CBOE-fallback (D-08).
// Called at job-execution time so freshness is checked per invocation (not at boot).
// 11-06 (GW-03): schwabMarketAdapter replaced by sidecarAdapter as schwabFetchChain input.
// selectChainSource + cboeFetchChain wiring unchanged — CBOE fallback intact on AUTH_EXPIRED.
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: (root) =>
    selectChainSource({
      readTokenFreshness: brokerTokensRepo.readTokenFreshness,
      schwabFetchChain: sidecarAdapter.fetchChain,
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

// MAC-01 (14-05): macro fetch — 7 FRED series (parameterized, no-fallback adapter) + VVIX
// (CBOE) into macro_observations. D-02: fully additive — does NOT touch fredAdapter/
// fetchRateUseCase/rateObsRepo above (DGS3MO→rate_observations/BSM path stays untouched).
const fetchFredSeries = makeFredSeriesAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
});
const fetchVvixQuote = makeCboeVvixAdapter({
  fetch: globalThis.fetch,
  userAgent: USER_AGENT,
});
const macroObsRepo = makePostgresMacroObservationsRepo(db);
const fetchMacroSeriesUseCase = makeFetchMacroSeries({
  fetchFredSeries,
  fetchVvixQuote,
  persistMacroObservation: macroObsRepo.insertMacroObservation,
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
  fetchMacroSeriesUseCase,
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

// 19-08 (D-04): compute-gex-snapshot chain-triggers compute-picker on success — boss dep added
// here (mirrors computeAnalyticsHandler adding boss in 08-06).
const computeGexSnapshotHandler = makeComputeGexSnapshotHandler({
  computeGexSnapshotUseCase,
  boss,
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

// GW-03 (11-06): refresh-tokens TS job retired — Python sidecar is the sole Schwab token refresher.
// The Schwab OAuth dance and both app (trader + market) token rotations now live in apps/sidecar.
// This worker still reads broker_tokens for freshness via brokerTokensRepo (TOKEN_ENCRYPTION_KEY
// kept in config for that purpose — D-01/D-08). No makeSchwabOAuthClient wiring here.

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

// JRNL-01 (pnl-unit-mismatch fix): recomputeSnapshotPnl use-case — re-derives the frozen
// historical pnl_open on every calendar_snapshots row for a calendar from its CURRENT
// openNetDebit + qty (data-correction path, run after an openNetDebit correction).
const recomputeSnapshotPnlUseCase = makeRecomputeSnapshotPnlUseCase({
  getCalendarById: calendarsRepo.getCalendarById,
  recomputeSnapshotPnl: calendarSnapshotsRepo.recomputeSnapshotPnl,
});

const recomputeSnapshotPnlHandler = makeRecomputeSnapshotPnlHandler({
  recomputeSnapshotPnlUseCase,
  now: () => new Date(),
});

// COT-01 (13-05): weekly CFTC Commitment of Traders report (Friday 17:00 ET, D-07).
// CFTC Socrata endpoint — anonymous access, no auth required (landmine 7).
// Idempotent: ON CONFLICT (contract_code, as_of) DO NOTHING in the repo (D-09).
const fetchCotReport = makeCftcCotAdapter({ fetch: globalThis.fetch });
const cotObsRepo = makePostgresCotObservationsRepo(db);
const fetchCot = makeFetchCot({
  fetchCotReport,
  persistCotObservation: cotObsRepo.insertCotObservation,
  now: () => new Date(),
  contractCode: "13874A", // E-mini S&P 500 TFF futures-only contract code
});
const fetchCotHandler = makeFetchCotHandler({ fetchCot });

// PICK-01/PICK-03 (19-08): picker engine + economic-events wiring.
// compute-picker is chain-triggered by compute-gex-snapshot (D-04) — it needs the GEX context
// (criterion 7) computed just before it runs. fetch-economic-events refreshes economic_events
// weekly (D-14) from the unified FRED CPI/NFP + FOMC-seed adapter (19-04).
const economicEventsAdapter = makeEconomicEventsAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
  fomcSeed: FOMC_SEED,
});
const economicEventsRepo = makePostgresEconomicEventsRepo(db);
const pickerChainRepo = makePostgresPickerChainRepo(db);
const pickerSnapshotRepo = makePostgresPickerSnapshotRepo(db);

// gex-context adapter — maps GexSnapshotRow → GexContextForPicker at the composition root,
// keeping the picker core free of an analytics-context import (architecture-boundaries §7:
// cross bounded contexts through application ports only). absGammaStrike is derived here from
// the persisted per-strike gex profile — the strike with the largest |gex| magnitude.
function toAbsGammaStrike(row: GexSnapshotRow): number | null {
  if (row.strikes.length === 0) return null;
  const strongest = row.strikes.reduce((max, s) => (Math.abs(s.gex) > Math.abs(max.gex) ? s : max));
  return strongest.k;
}

const readGexContextForPicker = async () => {
  const result = await gexRepo.readGexSnapshot();
  if (!result.ok) return result;
  if (result.value === null) return ok(null);
  const row = result.value;
  const context: GexContextForPicker = {
    flip: row.flip,
    callWall: row.callWall,
    putWall: row.putWall,
    netGammaAtSpot: row.netGammaAtSpot,
    absGammaStrike: toAbsGammaStrike(row),
    computedAt: row.computedAt,
  };
  return ok(context);
};

const computePickerSnapshotUseCase = makeComputePickerSnapshotUseCase({
  readChainForPicker: pickerChainRepo.readChainForPicker,
  readGexContext: readGexContextForPicker,
  readEconomicEvents: economicEventsRepo.readEconomicEvents,
  persistPickerSnapshot: pickerSnapshotRepo.insertPickerSnapshot,
  rate: config.BSM_RATE_FALLBACK,
  dividendYield: config.BSM_DIVIDEND_YIELD,
  now: () => new Date(),
});

const computePickerHandler = makeComputePickerHandler({
  computePickerUseCase: computePickerSnapshotUseCase,
  now: () => new Date(),
});

const fetchEconomicEventsHandler = makeFetchEconomicEventsHandler({
  fetchEconomicEvents: economicEventsAdapter,
  persistEconomicEvents: economicEventsRepo.persistEconomicEvents,
});

// Register all 12 queues, 8 crons, and 12 work handlers via registerAllJobs (Plan 05-04 + 08-06 + 13-05 + 19-08).
// 11-06 (GW-03): refresh-tokens retired. 13-05 (COT-01): fetch-cot added. 19-08: compute-picker +
// fetch-economic-events added — 12 queues, 7 scheduled jobs.
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
  rebuildJournal: rebuildJournalHandler,
  fetchCot: fetchCotHandler,
  computePicker: computePickerHandler,
  fetchEconomicEvents: fetchEconomicEventsHandler,
  recomputeSnapshotPnl: recomputeSnapshotPnlHandler,
});

console.warn(
  "morai worker: pg-boss started; 13 queues created, 7 jobs scheduled (fetch-schwab-chain, fetch-rates, compute-bsm-greeks, sync-transactions, sync-fills, fetch-cot, fetch-economic-events); snapshot-calendars + compute-analytics + compute-gex-snapshot + compute-picker chain-triggered only; rebuild-journal + recompute-snapshot-pnl on-demand only; refresh-tokens RETIRED (GW-03 — sidecar sole writer)",
);
