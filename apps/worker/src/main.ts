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
  makeSchwabPositionsAdapter,
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
  makeCboeVix9dAdapter,
  makePostgresMacroObservationsRepo,
  makeEconomicEventsAdapter,
  FOMC_SEED,
  makePostgresEconomicEventsRepo,
  makePostgresPickerChainRepo,
  makePostgresPickerSnapshotRepo,
  makePostgresPickerHistoryRepo,
  makePostgresExitVerdictsRepo,
  makePostgresRuleOverridesRepo,
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
  makeWipeDerivedFillsUseCase,
  selectChainSources,
  makeFetchCot,
  makeFetchMacroSeries,
  makeComputePickerSnapshotUseCase,
  makeGetPositionsUseCase,
  makeRegisterCalendarUseCase,
  makeRegisterOpenCalendarsUseCase,
  makeComputeExitAdviceUseCase,
} from "@morai/core";
import type { PositionLeg } from "@morai/core";
import type { GexContextForPicker, GexSnapshotRow } from "@morai/core";
import type {
  Calendar,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingChainForRoll,
  LatestSnapshotForOpenCalendar,
} from "@morai/core";
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
import { makeWipeDerivedFillsHandler } from "./handlers/wipe-derived-fills.ts";
import { makeRegisterOpenCalendarsHandler } from "./handlers/register-open-calendars.ts";
import { makeComputePickerHandler } from "./handlers/compute-picker.ts";
import { makeComputeExitAdviceHandler } from "./handlers/compute-exit-advice.ts";
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
// AUTH-04: broker-tokens repo for per-app freshness (used by selectChainSources + T-04-26 logging)
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
// Dual-source (selectChainSources): CBOE runs every cycle; AUTH_EXPIRED → CBOE only.
const sidecarAdapter = makeSidecarChainAdapter({
  fetch: globalThis.fetch,
  sidecarUrl: config.SIDECAR_URL,
});

const fredAdapter = makeFredRateAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
  fallbackRate: config.BSM_RATE_FALLBACK,
});

// chain-window-narrow-regression: selectChainSources — dual-source (Schwab freshness +
// CBOE breadth) when the market token is healthy; CBOE-only on AUTH_EXPIRED (D-08).
// Called at job-execution time so freshness is checked per invocation (not at boot).
// 11-06 (GW-03): sidecarAdapter is the Schwab boundary (schwab-py handles auth + fetch).
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChains: () =>
    selectChainSources({
      readTokenFreshness: brokerTokensRepo.readTokenFreshness,
      schwabFetchChain: sidecarAdapter.fetchChain,
      cboeFetchChain: cboeAdapter.fetchChain,
    }),
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

// MAC-01 (14-05): macro fetch — 9 FRED series (parameterized, no-fallback adapter) + VVIX +
// VIX9D (CBOE) into macro_observations. D-02: fully additive — does NOT touch fredAdapter/
// fetchRateUseCase/rateObsRepo above (DGS3MO→rate_observations/BSM path stays untouched).
// VIX9D added Phase 24 (MACRO-02/03) — FRED does not publish it (24-RESEARCH.md).
const fetchFredSeries = makeFredSeriesAdapter({
  fetch: globalThis.fetch,
  apiKey: config.FRED_API_KEY,
});
const fetchVvixQuote = makeCboeVvixAdapter({
  fetch: globalThis.fetch,
  userAgent: USER_AGENT,
});
const fetchVix9dQuote = makeCboeVix9dAdapter({
  fetch: globalThis.fetch,
  userAgent: USER_AGENT,
});
const macroObsRepo = makePostgresMacroObservationsRepo(db);
// 29-10 (RUNTIME-*): runtime rule-settings overrides repo — the use-case reads this FRESH on
// every compute-picker run (never cached here); constructing the repo function once at boot
// is composition-root wiring, not caching the data itself.
const ruleOverridesRepo = makePostgresRuleOverridesRepo(db);
const fetchMacroSeriesUseCase = makeFetchMacroSeries({
  fetchFredSeries,
  fetchVvixQuote,
  fetchVix9dQuote,
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
  // 34-04 (TOSP-02): per-expiry implied carry resolves r from the live FRED curve
  // already ingested by the macro job — same macroObsRepo used above.
  readMacroObservations: macroObsRepo.readMacroObservations,
  now: () => new Date(),
});

// Build handlers (thin adapters — zero business logic)
// D-07/D-08: Schwab-primary handler replaces the CBOE-only handler.
// fetchChainUseCase is pre-wired with selectChainSources above (dual-source: Schwab + CBOE).
// T-04-26: readTokenFreshness + logAuthExpiredFallback enable the operator-visible warning.
const fetchSchwabChainHandler = makeFetchSchwabChainHandler({
  fetchChainUseCase,
  boss,
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
});

// 19-08 (D-04): compute-gex-snapshot chain-triggers compute-picker on success — boss dep added
// here (mirrors computeAnalyticsHandler adding boss in 08-06).
const computeGexSnapshotHandler = makeComputeGexSnapshotHandler({
  computeGexSnapshotUseCase,
  boss,
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
  // journal-pnl-opennetdebit-units round 5 (bug 2): auto-transition a calendar's status once
  // its rebuilt events prove it's fully closed.
  transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
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
  // journal-pnl-opennetdebit-units round 5 (bug 2): auto-transition a calendar's status once
  // its rebuilt events prove it's fully closed.
  transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
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

// Window: last 7 days through today (YYYY-MM-DD), computed PER RUN — boot-time constants
// froze the window for the process lifetime, so fills after boot day were never pulled
// and closed calendars stayed open (unlinked-verdicts pile-up, fixed 2026-07-10).
// Re-syncing an overlapping window is idempotent (deterministic fill ids +
// onConflictDoNothing), so the trailing window self-heals missed cycles.
const trailingTxWindow = (): { from: string; to: string } => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

const syncTransactionsUseCase = makeSyncTransactionsUseCase({
  fetchTransactions: fetchTransactionsResolved,
  writeFills: fillsRepo.writeFills,
  // C1: injected sha256 hasher → deterministic UUID fill ids.
  hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
  accountHash: "resolved-at-call-time", // ignored by fetchTransactionsResolved (resolver wins)
  window: trailingTxWindow,
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

// journal-pnl-opennetdebit-units round 3 (fills-side-correction follow-up): wipeDerivedFills
// use-case — account-wide DELETE of fills/calendar_events/orphan_fills so a subsequent
// backfill-transactions re-ingest writes fresh, correctly-signed fills. Does NOT touch
// calendars or calendar_snapshots.
const wipeDerivedFillsUseCase = makeWipeDerivedFillsUseCase({
  wipeDerivedFills: fillsRepo.wipeDerivedFills,
});

const wipeDerivedFillsHandler = makeWipeDerivedFillsHandler({
  wipeDerivedFillsUseCase,
  now: () => new Date(),
});

// JRNL-02: register-open-calendars — auto-register calendars from the current open position
// book. Reuses the trader app's positions adapter (mirrors apps/server/src/main.ts's getPositions
// wiring) + accountHashResolver/traderDeps already built above for sync-transactions.
const positionsAdapter = makeSchwabPositionsAdapter(traderDeps);
const getPositionsUseCase = makeGetPositionsUseCase({
  resolveAccountHash: accountHashResolver.resolveAccountHash,
  fetchPositions: positionsAdapter.fetchPositions,
});

// Maps brokerage's BrokerPosition (+ its own AuthExpiredError) into journal's minimal
// PositionLeg + FetchError shape — registerOpenCalendars stays decoupled from the brokerage
// bounded context (architecture-boundaries §7: cross bounded contexts via application ports;
// this mapping IS that composition-root port adaptation).
const fetchOpenPositionLegs = async () => {
  const result = await getPositionsUseCase();
  if (!result.ok) {
    const message =
      result.error.kind === "auth-expired"
        ? `brokerage auth expired for app ${result.error.appId}`
        : result.error.message;
    return { ok: false as const, error: { kind: "fetch-error" as const, message } };
  }
  const legs: PositionLeg[] = result.value.map((p) => ({
    occSymbol: p.occSymbol,
    underlyingSymbol: p.underlyingSymbol,
    longQty: p.longQty,
    shortQty: p.shortQty,
    averagePrice: p.averagePrice,
  }));
  return { ok: true as const, value: legs };
};

const registerCalendarUseCase = makeRegisterCalendarUseCase({
  persistCalendar: calendarsRepo.registerCalendar,
  now: () => new Date(),
});

const registerOpenCalendarsUseCase = makeRegisterOpenCalendarsUseCase({
  fetchOpenPositions: fetchOpenPositionLegs,
  listCalendars: calendarsRepo.listCalendars,
  readFillsByOccSymbols: fillsRepo.readFillsByOccSymbols,
  registerCalendar: registerCalendarUseCase,
  now: () => new Date(),
});

const registerOpenCalendarsHandler = makeRegisterOpenCalendarsHandler({
  registerOpenCalendarsUseCase,
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
    // Near-term (≤45d) level set — the gexFit rule prefers these walls (rules.ts);
    // null on pre-0019 snapshots → gexFit falls back to the all-expiry set above.
    nearTermFlip: row.nearTerm?.flip ?? null,
    nearTermCallWall: row.nearTerm?.callWall ?? null,
    nearTermPutWall: row.nearTerm?.putWall ?? null,
    computedAt: row.computedAt,
  };
  return ok(context);
};

// Picker rule engine: history reads feeding the experimental vrp/slopePercentile rules.
const pickerHistoryRepo = makePostgresPickerHistoryRepo(db);

// 28-03 (PLAY-01/PLAY-02): entry-gate deps — reuses the EXISTING macroObsRepo/calendarsRepo/
// calendarEventsRepo/pickerSnapshotRepo instances already built above (macro fetch, JRNL-01,
// PICK-02) — zero new adapter wiring for the gate.
const computePickerSnapshotUseCase = makeComputePickerSnapshotUseCase({
  readChainForPicker: pickerChainRepo.readChainForPicker,
  readGexContext: readGexContextForPicker,
  readEconomicEvents: economicEventsRepo.readEconomicEvents,
  persistPickerSnapshot: pickerSnapshotRepo.insertPickerSnapshot,
  readDailySpotCloses: pickerHistoryRepo.readDailySpotCloses,
  readPickerSlopeHistory: pickerHistoryRepo.readPickerSlopeHistory,
  readMacroObservations: macroObsRepo.readMacroObservations,
  readOpenCalendars: calendarsRepo.getOpenCalendars,
  readRecentClosedCalendars: calendarEventsRepo.readRecentClosedCalendars,
  readPickerSnapshot: pickerSnapshotRepo.readPickerSnapshot,
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  rate: config.BSM_RATE_FALLBACK,
  dividendYield: config.BSM_DIVIDEND_YIELD,
  now: () => new Date(),
});

// 26-04 (EXIT-01): compute-picker gains a boss dep — enqueues compute-exit-advice on success
// (mirrors computeGexSnapshotHandler adding boss in 19-08).
const computePickerHandler = makeComputePickerHandler({
  computePickerUseCase: computePickerSnapshotUseCase,
  boss,
});

const fetchEconomicEventsHandler = makeFetchEconomicEventsHandler({
  fetchEconomicEvents: economicEventsAdapter,
  persistEconomicEvents: economicEventsRepo.persistEconomicEvents,
});

// 26-04 (EXIT-01): exits context wiring — reuses the picker-chain + economic-events adapters
// above (structural compatibility: EconomicEvent/ChainQuoteForPicker are structurally wider
// than exits' own Tier1Event/ChainQuoteForRoll re-declarations, so the SAME functions satisfy
// both port shapes with no wrapper) and adapts calendarsRepo/calendarSnapshotsRepo into the
// exits-owned HeldPosition/LatestSnapshotForCalendar shapes at the composition root — mirrors
// the toAbsGammaStrike/readGexContextForPicker mapping-closure precedent above.
const exitVerdictsRepo = makePostgresExitVerdictsRepo(db);

function mapCalendarToHeldPosition(calendar: Calendar) {
  return {
    calendarId: calendar.id,
    name: `${calendar.strike / 1000}${calendar.optionType} ${calendar.frontExpiry} / ${calendar.backExpiry}`,
    strike: calendar.strike / 1000, // Calendar.strike is the ×1000 convention; exits reads points
    optionType: calendar.optionType,
    qty: calendar.qty,
    openNetDebit: calendar.openNetDebit,
    frontExpiry: calendar.frontExpiry,
    backExpiry: calendar.backExpiry,
  };
}

const readHeldPositionsForExits: ForReadingHeldPositions = async () => {
  const result = await calendarsRepo.getOpenCalendars();
  if (!result.ok) return result;
  return ok(result.value.map(mapCalendarToHeldPosition));
};

function mapSnapshotToLatestSnapshotForCalendar(row: LatestSnapshotForOpenCalendar) {
  return {
    calendarId: row.calendarId,
    time: row.snapshot.time,
    // journal's SnapshotRow carries Drizzle-numeric strings ('NaN' is a valid sentinel,
    // D-06) — Number('NaN') is JS NaN, which the evaluator's indicative gate already checks.
    netMark: Number(row.snapshot.netMark),
    pnlOpen: Number(row.snapshot.pnlOpen),
    spot: Number(row.snapshot.spot),
    frontIv: Number(row.snapshot.frontIv),
    backIv: Number(row.snapshot.backIv),
    dteFront: row.snapshot.dteFront,
    dteBack: row.snapshot.dteBack,
  };
}

const readLatestSnapshotForExits: ForReadingLatestSnapshotPerOpenCalendar = async () => {
  const result = await calendarSnapshotsRepo.readLatestSnapshotPerOpenCalendar();
  if (!result.ok) return result;
  return ok(result.value.map(mapSnapshotToLatestSnapshotForCalendar));
};

// ChainQuoteForRoll declares strike in points; the reused picker-chain adapter returns the
// ×1000 chain convention (ChainQuoteForPicker) — convert here, not at the use-case boundary,
// so a bare pass-through never silently compares points to ×1000 and fails to match a
// calendar's own strike. The `strike` param is accepted for the port's own filtering contract
// but unused here — readChainForPicker has no server-side filter; computeExitAdvice.ts filters
// the returned array client-side per calendar.
const readChainForRollForExits: ForReadingChainForRoll = async (_strike) => {
  const result = await pickerChainRepo.readChainForPicker();
  if (!result.ok) return result;
  return ok(
    result.value.map((quote) => ({
      strike: quote.strike / 1000,
      expiration: quote.expiration,
      contractType: quote.contractType,
      bid: quote.bid,
      ask: quote.ask,
    })),
  );
};

const computeExitAdviceUseCase = makeComputeExitAdviceUseCase({
  readHeldPositions: readHeldPositionsForExits,
  readLatestSnapshotPerOpenCalendar: readLatestSnapshotForExits,
  readLatestVerdictsPerCalendar: exitVerdictsRepo.readLatestVerdictsPerCalendar,
  readEconomicEvents: economicEventsRepo.readEconomicEvents,
  readChainForRoll: readChainForRollForExits,
  persistExitVerdict: exitVerdictsRepo.insertExitVerdict,
  // 29-11 (RUNTIME-*): reuses the single ruleOverridesRepo instance constructed above (shared
  // with the compute-picker wiring at line 588) — pure composition-root wiring, no new repo.
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  now: () => new Date(),
});

const computeExitAdviceHandler = makeComputeExitAdviceHandler({
  computeExitAdviceUseCase,
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
  computeExitAdvice: computeExitAdviceHandler,
  fetchEconomicEvents: fetchEconomicEventsHandler,
  recomputeSnapshotPnl: recomputeSnapshotPnlHandler,
  wipeDerivedFills: wipeDerivedFillsHandler,
  registerOpenCalendars: registerOpenCalendarsHandler,
});

console.warn(
  "morai worker: pg-boss started; 16 queues created, 7 jobs scheduled (fetch-schwab-chain, fetch-rates, compute-bsm-greeks, sync-transactions, sync-fills, fetch-cot, fetch-economic-events); snapshot-calendars + compute-analytics + compute-gex-snapshot + compute-picker + compute-exit-advice chain-triggered only; rebuild-journal + recompute-snapshot-pnl + wipe-derived-fills + register-open-calendars on-demand only; refresh-tokens RETIRED (GW-03 — sidecar sole writer)",
);
