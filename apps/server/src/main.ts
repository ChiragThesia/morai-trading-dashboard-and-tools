// Server composition root — wires config → db → adapters → use-cases → routes + MCP.
//
// Architecture law (architecture-boundaries.md):
// - process.env read ONCE here; typed config flows inward.
// - No business logic in this file; only composition.
// - TDD exempt: pure wiring (tdd.md Scope).

import { bootConfig } from "./config.ts";
import {
  makeDb,
  makePostgresCalendarsRepo,
  makePostgresCalendarSnapshotsRepo,
  makePostgresLegObservationsRepo,
  makePostgresJobRunsRepo,
  makePostgresBrokerTokensRepo,
  makeAccountHashResolver,
  makeSchwabPositionsAdapter,
  makeSchwabTransactionsAdapter,
  makeSchwabOrdersAdapter,
  makePgBossJobQueue,
  makePostgresTermStructureObservationsRepo,
  makePostgresRiskReversalObservationsRepo,
  makePostgresGexSnapshotRepo,
  makePostgresCotObservationsRepo,
  makePostgresMacroObservationsRepo,
  makePostgresPickerSnapshotRepo,
  makePostgresCalendarEventsRepo,
  makePostgresCalendarEventAnnotationsRepo,
  makePostgresExitVerdictsRepo,
  makePostgresRuleOverridesRepo,
  makePostgresEconomicEventsRepo,
  makePostgresPickerHistoryRepo,
} from "@morai/adapters";
import {
  makeGetStatusUseCase,
  makeRegisterCalendarUseCase,
  makeListCalendarsUseCase,
  makeCloseCalendarUseCase,
  makeGetJournalUseCase,
  makeGetLiveGreeksUseCase,
  makeGetPositionsUseCase,
  makeGetTransactionsUseCase,
  makeGetOrdersUseCase,
  makeEnqueueJobUseCase,
  makeGetTermStructureUseCase,
  makeGetSkewUseCase,
  makeGetGexUseCase,
  makeGetCotUseCase,
  makeGetMacroUseCase,
  makeGetRegimeBoardUseCase,
  makeGetPickerUseCase,
  makeGetCalendarEventsWithRulesUseCase,
  makeSetRuleTagsUseCase,
  makeSpotObserver,
  makeGetCalendarLifecycleUseCase,
  makeGetExitAdviceUseCase,
  makeGetRuleSettingsUseCase,
  makeSetRuleOverridesUseCase,
  makeAnalyzeAdHocCalendarUseCase,
  makePreviewPickerRuleOverridesUseCase,
  makePreviewExitRuleOverridesUseCase,
  makePreviewRuleOverridesUseCase,
  resolvePickerRuleConfig,
  resolveExitRuleConfig,
  resolveRegimeRuleConfig,
  makeStartReauth,
  makeExchangeReauth,
} from "@morai/core";
import type {
  Calendar,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  LatestSnapshotForOpenCalendar,
  GexContextForPicker,
  GexSnapshotRow,
} from "@morai/core";
import { ok } from "@morai/shared";
import { PgBoss } from "pg-boss";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet } from "jose";
import { makeSupabaseJwtAuth } from "./adapters/http/supabase-auth.ts";
import { CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./adapters/http/cors-policy.ts";
import { bearerAuth } from "./adapters/mcp/bearer.ts";
import { statusRoutes } from "./adapters/http/status.routes.ts";
import { withRefreshExpiryWarning } from "./adapters/refresh-expiry-warner.ts";
import { calendarRoutes } from "./adapters/http/calendar.routes.ts";
import { journalRoutes } from "./adapters/http/journal.routes.ts";
import { journalRulesRoutes } from "./adapters/http/journal-rules.routes.ts";
import { settingsRoutes } from "./adapters/http/settings.routes.ts";
import { reauthRoutes } from "./adapters/http/reauth.routes.ts";
import { journalLifecycleRoutes } from "./adapters/http/journal-lifecycle.routes.ts";
import { brokerageRoutes } from "./adapters/http/brokerage.routes.ts";
import { analyticsRoutes } from "./adapters/http/analytics.routes.ts";
import { gexRoutes } from "./adapters/http/gex.routes.ts";
import { pickerRoutes } from "./adapters/http/picker.routes.ts";
import { exitRoutes } from "./adapters/http/exits.routes.ts";
import { jobsRoutes } from "./adapters/http/jobs.routes.ts";
import { makeMcpRouter } from "./adapters/mcp/server.ts";
import { streamRoutes, makeStreamSseRouter } from "./adapters/http/stream.routes.ts";
import { startFlushInterval, bufferTick, bufferSpot, bufferIndices } from "./adapters/http/stream-fan-out.ts";
import { runSidecarStreamWithReconnect } from "./adapters/http/sidecar-sse.ts";
import { recomputeLiveGreek } from "@morai/core";
import { makeSidecarPositionReconciler, makeSidecarReauthAdapter } from "@morai/adapters";

const config = bootConfig();

// Build the Postgres pool + Drizzle instance.
// max:4 — bounded so server + worker pools fit under the Supavisor session-pooler
// ceiling (see db.ts). Low-traffic read API needs only a few concurrent connections.
const db = makeDb(config.DATABASE_URL, { max: 4 });

// Build the calendars repo which also implements ForPingingDb
const calendarsRepo = makePostgresCalendarsRepo(db);

// Build the job-runs repo (reads pgboss.job for D-10 lastJobRuns status)
const jobRunsRepo = makePostgresJobRunsRepo(db);

// AUTH-02: build the broker-tokens repo (pgcrypto encryption at rest via TOKEN_ENCRYPTION_KEY)
const brokerTokensRepo = makePostgresBrokerTokensRepo(db, config.TOKEN_ENCRYPTION_KEY);

// Build the calendar-snapshots repo (readJournal) and leg-observations repo (getLatestLegObs)
// Both are scoped here as named consts for plan 07 MCP tool injection
const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);
const legObsRepo = makePostgresLegObservationsRepo(db);

// Build the get_status use-case — injecting the DB ping + version + start time
const startedAt = new Date();
const version = "0.0.1";

const getStatus = makeGetStatusUseCase({
  pingDb: calendarsRepo.pingDb,
  readJobRuns: jobRunsRepo.readJobRuns,
  // AUTH-04: per-app token freshness for /api/status (reads timestamp columns only)
  readTokenFreshness: brokerTokensRepo.readTokenFreshness,
  version,
  startedAt,
});

// AUTH-05: single composition-root choke point for the T-24h warning-log side
// effect — wrap getStatus ONCE and inject the wrapped port into both
// statusRoutes and makeMcpRouter below, so the warning fires once per crossing
// regardless of transport (RESEARCH Anti-Pattern: no per-adapter duplication).
const statusPort = withRefreshExpiryWarning(getStatus);

// Build the calendar use-cases
const registerCalendar = makeRegisterCalendarUseCase({
  persistCalendar: calendarsRepo.registerCalendar,
  now: () => new Date(),
});
const listCalendars = makeListCalendarsUseCase({
  listCalendars: calendarsRepo.listCalendars,
});
const closeCalendar = makeCloseCalendarUseCase({
  closeCalendar: calendarsRepo.closeCalendar,
});

// Build the journal read use-cases (plan 06)
// Named consts so plan 07 MCP tools can inject them without re-construction.
const getJournal = makeGetJournalUseCase({
  readJournal: calendarSnapshotsRepo.readJournal,
});
// JRNL-01 (22-03): getCalendarLifecycle — enriched-series read use-case, shared by the HTTP
// route + MCP tool over the ONE lifecycleResponse contract (MCP-02).
const getCalendarLifecycle = makeGetCalendarLifecycleUseCase({
  readJournal: calendarSnapshotsRepo.readJournal,
});
const getLiveGreeks = makeGetLiveGreeksUseCase({
  getCalendar: calendarsRepo.getCalendarById,
  getLatestLegObs: legObsRepo.getLatestLegObs,
});

// ANLY-03 (06-04): term-structure read use-case — shared by the HTTP route + MCP tool (MCP-02).
const termStructureRepo = makePostgresTermStructureObservationsRepo(db);
const getTermStructure = makeGetTermStructureUseCase({
  readTermStructureSeries: termStructureRepo.readTermStructureSeries,
});

// ANLY-03 (06-05): skew (headline risk-reversal) read use-case — shared by the HTTP route + MCP
// tool over the ONE skewResponse contract (MCP-02).
const riskReversalRepo = makePostgresRiskReversalObservationsRepo(db);
const getSkew = makeGetSkewUseCase({
  readSkewSeries: riskReversalRepo.readRiskReversalSeries,
});

// GEX-01 / SC-1 (08-05/08-07): get-gex read use-case — shared by GET /api/analytics/gex + get_gex
// MCP tool over the ONE gexSnapshotResponse contract (MCP-02). Pure stored-row read (D-01).
const gexSnapshotRepo = makePostgresGexSnapshotRepo(db);
const getGex = makeGetGexUseCase({
  readGexSnapshot: gexSnapshotRepo.readGexSnapshot,
});

// COT-02 / MCP-02 (13-06): get-cot read use-case — shared by GET /api/analytics/cot + get_cot
// MCP tool over the ONE cotResponse contract. Weekly CFTC TFF series (public data, no auth gate).
const cotObservationsRepo = makePostgresCotObservationsRepo(db);
const getCot = makeGetCotUseCase({
  readCotObservations: cotObservationsRepo.listCotObservations,
});

// MAC-02 / MCP-02 (14-06): get-macro read use-case — shared by GET /api/analytics/macro + get_macro
// MCP tool over the ONE macroResponse contract. rate_observations/readRate/BSM path untouched (D-02).
const macroObservationsRepo = makePostgresMacroObservationsRepo(db);
const getMacro = makeGetMacroUseCase({
  readMacroObservations: macroObservationsRepo.readMacroObservations,
});

// 29-12 (RUNTIME-*): runtime rule-settings overrides repo — the regime board reads this FRESH
// on every request (never cached here); constructing the repo function once at boot is
// composition-root wiring, not caching the data itself. Single instance, reused by the
// settings surface (29-13) when it lands.
const ruleOverridesRepo = makePostgresRuleOverridesRepo(db);

// BOARD-01/02/03 / MCP-02 (24-04): get-regime-board read use-case — shared by
// GET /api/analytics/regime + get_regime MCP tool over the ONE regimeResponse contract.
// Reuses the EXISTING macroObservationsRepo (zero new repo, 24-RESEARCH.md).
const getRegimeBoard = makeGetRegimeBoardUseCase({
  readMacroObservations: macroObservationsRepo.readMacroObservations,
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
});

// RUNTIME-* / MCP-02 (29-13): get/set-rule-settings use-cases — shared by GET/PUT
// /api/settings/rules + the get_rule_settings/set_rule_overrides MCP tools. `defaults` is
// computed ONCE at boot by calling each engine's own resolve function with NO overrides,
// then flattened into the contracts' flat ruleConfig shape — the ONE apps→core wiring point
// (architecture-boundaries.md allows apps → core) so the displayed defaults never drift from
// the compile-time constants (T-29-18). Reuses the SAME ruleOverridesRepo as the regime board.
const pickerRuleDefaults = resolvePickerRuleConfig();
const exitRuleDefaults = resolveExitRuleConfig();
const regimeRuleDefaults = resolveRegimeRuleConfig();

function findVixLadderMin(tier: "normal" | "elevated" | "crisis"): number {
  const row = pickerRuleDefaults.vixLadder.find((r) => r.tier === tier);
  if (row === undefined) throw new Error(`vix ladder default missing the ${tier} tier`);
  return row.min;
}

function findExitRung(rungs: typeof exitRuleDefaults.takeRungs, label: string) {
  const rung = rungs.find((r) => r.label === label);
  if (rung === undefined) throw new Error(`exit rung default missing label ${label}`);
  return rung;
}

const take15 = findExitRung(exitRuleDefaults.takeRungs, "+15%");
const take10 = findExitRung(exitRuleDefaults.takeRungs, "+10%");
const take5 = findExitRung(exitRuleDefaults.takeRungs, "+5%");
const stop50 = findExitRung(exitRuleDefaults.stopRungs, "-50%");
const stop25 = findExitRung(exitRuleDefaults.stopRungs, "-25%");

const ruleSettingsDefaults = {
  picker: {
    deltaBandMin: pickerRuleDefaults.deltaBand.min,
    deltaBandMax: pickerRuleDefaults.deltaBand.max,
    frontDteMin: pickerRuleDefaults.frontDte.min,
    frontDteMax: pickerRuleDefaults.frontDte.max,
    backDteMinGap: pickerRuleDefaults.backDteGap.min,
    backDteMaxGap: pickerRuleDefaults.backDteGap.max,
    weights: pickerRuleDefaults.weights,
    debitIdealMin: pickerRuleDefaults.debitBand.idealMin,
    debitIdealMax: pickerRuleDefaults.debitBand.idealMax,
    vixLadder: {
      normalMin: findVixLadderMin("normal"),
      elevatedMin: findVixLadderMin("elevated"),
      crisisMin: findVixLadderMin("crisis"),
    },
    maxOpenCalendars: pickerRuleDefaults.maxOpenCalendars,
    sizingContracts: pickerRuleDefaults.sizingContracts,
  },
  exits: {
    take: {
      plus15Arm: take15.arm,
      plus15Disarm: take15.disarm,
      plus10Arm: take10.arm,
      plus10Disarm: take10.disarm,
      plus5Arm: take5.arm,
      plus5Disarm: take5.disarm,
    },
    stop: {
      minus50Arm: stop50.arm,
      minus50Disarm: stop50.disarm,
      minus25Arm: stop25.arm,
      minus25Disarm: stop25.disarm,
    },
  },
  regime: {
    vixTermStructureWarn: regimeRuleDefaults.vixTermStructure.warn,
    vixTermStructureCrisis: regimeRuleDefaults.vixTermStructure.crisis,
    vvixWarn: regimeRuleDefaults.vvix.warn,
    vvixCrisis: regimeRuleDefaults.vvix.crisis,
    vix9dRatioWarn: regimeRuleDefaults.vix9dRatio.warn,
    vix9dRatioCrisis: regimeRuleDefaults.vix9dRatio.crisis,
    hyOasWarn: regimeRuleDefaults.hyOas.warn,
    hyOasCrisis: regimeRuleDefaults.hyOas.crisis,
  },
};

const getRuleSettings = makeGetRuleSettingsUseCase({
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  defaults: ruleSettingsDefaults,
});
const setRuleOverrides = makeSetRuleOverridesUseCase({
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  writeRuleOverrides: ruleOverridesRepo.writeRuleOverrides,
  defaults: ruleSettingsDefaults,
});

// PICK-02 / MCP-02 (19-07): get-picker read use-case — shared by GET /api/picker/candidates +
// get_picker_candidates MCP tool over the ONE pickerSnapshotResponse contract. Pure stored-row
// read (D-04) — never recomputed on read.
const pickerSnapshotRepo = makePostgresPickerSnapshotRepo(db);
const getPicker = makeGetPickerUseCase({
  readPickerSnapshot: pickerSnapshotRepo.readPickerSnapshot,
});

// D-02 / MCP-02 (30-05): analyze-ad-hoc-calendar use-case — shared by POST /picker/analyze +
// the analyze_ad_hoc_calendar MCP tool. Reuses the EXISTING gexSnapshotRepo + pickerSnapshotRepo
// + ruleOverridesRepo instances built above; economicEventsRepo/pickerHistoryRepo are the two
// repos this route needs that no prior server use-case built yet — mirrors
// apps/worker/src/main.ts's readGexContextForPicker/economicEventsRepo/pickerHistoryRepo wiring
// (:544-591) exactly, so ad-hoc scoring reads the SAME shapes the engine's own compute-picker
// job reads.
function toAbsGammaStrike(row: GexSnapshotRow): number | null {
  if (row.strikes.length === 0) return null;
  const strongest = row.strikes.reduce((max, s) => (Math.abs(s.gex) > Math.abs(max.gex) ? s : max));
  return strongest.k;
}
const readGexContextForPicker = async () => {
  const result = await gexSnapshotRepo.readGexSnapshot();
  if (!result.ok) return result;
  if (result.value === null) return ok(null);
  const row = result.value;
  const context: GexContextForPicker = {
    flip: row.flip,
    callWall: row.callWall,
    putWall: row.putWall,
    netGammaAtSpot: row.netGammaAtSpot,
    absGammaStrike: toAbsGammaStrike(row),
    nearTermFlip: row.nearTerm?.flip ?? null,
    nearTermCallWall: row.nearTerm?.callWall ?? null,
    nearTermPutWall: row.nearTerm?.putWall ?? null,
    computedAt: row.computedAt,
  };
  return ok(context);
};
const economicEventsRepo = makePostgresEconomicEventsRepo(db);
const pickerHistoryRepo = makePostgresPickerHistoryRepo(db);
const analyzeAdHocCalendar = makeAnalyzeAdHocCalendarUseCase({
  readPickerSnapshot: pickerSnapshotRepo.readPickerSnapshot,
  readGexContext: readGexContextForPicker,
  readEconomicEvents: economicEventsRepo.readEconomicEvents,
  readDailySpotCloses: pickerHistoryRepo.readDailySpotCloses,
  readPickerSlopeHistory: pickerHistoryRepo.readPickerSlopeHistory,
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  rate: config.BSM_RATE_FALLBACK,
  dividendYield: config.BSM_DIVIDEND_YIELD,
});

// EXIT-08 / MCP-02 (26-05): get-exit-advice read use-case — shared by GET /api/exits +
// get_exit_advice MCP tool over the ONE exitsResponse contract. Reuses calendarsRepo +
// calendarSnapshotsRepo (already built above), adapted into the exits-owned
// HeldPosition/LatestSnapshotForCalendar shapes at this composition root — mirrors
// apps/worker/src/main.ts's mapCalendarToHeldPosition/mapSnapshotToLatestSnapshotForCalendar
// closures exactly (26-04 precedent), since each app composes its own root.
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

const getExitAdvice = makeGetExitAdviceUseCase({
  readHeldPositions: readHeldPositionsForExits,
  readLatestSnapshotPerOpenCalendar: readLatestSnapshotForExits,
  readLatestVerdictsPerCalendar: exitVerdictsRepo.readLatestVerdictsPerCalendar,
  now: () => new Date(),
});

// B4/B7/B8 (32-04): staged-change dry-run preview — shared by POST /api/settings/rules/preview
// + the preview_rule_overrides MCP tool. Reuses the ALREADY-BUILT pickerSnapshotRepo/
// ruleOverridesRepo/calendarsRepo/exit-read closures above; zero new repos, never persists
// (T-32-01/T-32-02 — neither preview deps type carries a write port).
const previewPicker = makePreviewPickerRuleOverridesUseCase({
  readPickerSnapshot: pickerSnapshotRepo.readPickerSnapshot,
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  readOpenCalendars: calendarsRepo.getOpenCalendars,
});
const previewExit = makePreviewExitRuleOverridesUseCase({
  readHeldPositions: readHeldPositionsForExits,
  readLatestSnapshotPerOpenCalendar: readLatestSnapshotForExits,
  readLatestVerdictsPerCalendar: exitVerdictsRepo.readLatestVerdictsPerCalendar,
  readEconomicEvents: economicEventsRepo.readEconomicEvents,
  readRuleOverrides: ruleOverridesRepo.readRuleOverrides,
  now: () => new Date(),
});
const previewRuleOverrides = makePreviewRuleOverridesUseCase({ previewPicker, previewExit });

// RULE-01 / MCP-02 (20-10): get-events-with-rules read use-case + set-rule-tags write
// use-case — shared by GET/PUT /api/journal/*/rules and the get_rule_tags/set_rule_tags
// MCP tools over the ONE journal-rules contract schema set (D-13).
const calendarEventsRepo = makePostgresCalendarEventsRepo(db);
const calendarEventAnnotationsRepo = makePostgresCalendarEventAnnotationsRepo(db);
const getEventsWithRules = makeGetCalendarEventsWithRulesUseCase({
  readCalendarEvents: calendarEventsRepo.readCalendarEvents,
  readAnnotations: calendarEventAnnotationsRepo,
});
const setRuleTags = makeSetRuleTagsUseCase({
  readEventByHash: calendarEventsRepo.readCalendarEventByHash,
  writeAnnotations: calendarEventAnnotationsRepo.upsertAnnotation,
});

// BRK-02: build trader adapters — reads from broker_tokens for the trader app.
// getAccessToken closure reads broker_tokens at call time (on-demand refresh deferred to JOB-02).
const USER_AGENT = "Morai-Server/1.0";

const traderGetAccessToken = async () => {
  const result = await brokerTokensRepo.readTokens("trader");
  if (!result.ok) {
    return { ok: false as const, error: { kind: "auth-expired" as const, appId: "trader" as const } };
  }
  if (result.value === null) {
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
const positionsAdapter = makeSchwabPositionsAdapter(traderDeps);
const transactionsAdapter = makeSchwabTransactionsAdapter(traderDeps);
const ordersAdapter = makeSchwabOrdersAdapter(traderDeps);

const getPositions = makeGetPositionsUseCase({
  resolveAccountHash: accountHashResolver.resolveAccountHash,
  fetchPositions: positionsAdapter.fetchPositions,
});
const getTransactions = makeGetTransactionsUseCase({
  resolveAccountHash: accountHashResolver.resolveAccountHash,
  fetchTransactions: transactionsAdapter.fetchTransactions,
});
const getOrders = makeGetOrdersUseCase({
  resolveAccountHash: accountHashResolver.resolveAccountHash,
  fetchOrders: ordersAdapter.fetchOrders,
});

// JOB-01 / MCP-02: enqueueJob use-case — shared by HTTP route + MCP tool (trigger_job).
// PgBoss instance for job enqueueing only (the worker is responsible for processing).
// Uses DATABASE_URL (direct connection); pg-boss manages its own pool for enqueueing.
// max:2 — the server only enqueues (trigger_job); it never processes jobs, so a tiny
// pool suffices and keeps the total under the Supavisor session-pooler ceiling.
const jobBoss = new PgBoss({ connectionString: config.DATABASE_URL, max: 2 });
await jobBoss.start();
const pgBossJobQueue = makePgBossJobQueue(jobBoss);
const enqueueJob = makeEnqueueJobUseCase({
  jobQueue: pgBossJobQueue.enqueue,
  now: () => new Date(),
});

// REAUTH-05 (37-05): sidecar re-auth adapter + use-cases — shared by POST /api/reauth/{start,exchange}
// (mounted below in the apiRouter chain, JWT-gated). Deliberately NOT registered as an MCP tool
// (CONTEXT decision) — a tool that mints Schwab authorize URLs is a privileged surface kept HTTP-only.
const reauthAdapter = makeSidecarReauthAdapter({
  fetch: globalThis.fetch,
  baseUrl: config.SIDECAR_URL,
  adminToken: config.SIDECAR_ADMIN_TOKEN,
});
const startReauth = makeStartReauth({ startReauth: reauthAdapter.startReauth });
const exchangeReauth = makeExchangeReauth({ exchangeReauth: reauthAdapter.exchangeReauth });

// Build the Hono app
const app = new Hono();

// SC-4 / AUTH-01 / Pitfall 7: CORS must be the FIRST middleware applied — before the JWT group.
// Preflight OPTIONS must return CORS headers before the JWT gate can reject the request.
// Exact WEB_ORIGIN only — NEVER '*' with credentials:true (T-08-AUTH3 EoP threat).
app.use(
  "/*",
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    allowHeaders: CORS_ALLOW_HEADERS,
    allowMethods: CORS_ALLOW_METHODS,
  }),
);

// PUBLIC: /api/status — no JWT required.
// Railway's healthcheckPath = "/api/status" hits this endpoint without any auth token;
// mounting it outside the JWT group ensures healthchecks pass and deploys are not rejected.
app.route("/api", statusRoutes(statusPort));

// SC-4 / AUTH-01 / RPC-01: Chain all data read routes into one sub-router so hc<AppType>()
// inference works (RESEARCH A5 / Pattern 6). The chained form is REQUIRED for AppType;
// the statement-style app.route() calls are NOT chainable and break type inference.
// NOTE: statusRoutes is NOT in this group — it is public (see above).
const apiRouter = new Hono()
  .route("/", calendarRoutes(registerCalendar, listCalendars, closeCalendar))
  .route("/", journalRoutes(getJournal))
  // RULE-01 (20-10): GET/PUT /api/journal/*/rules — event read + rule-tag write (D-13)
  .route("/", journalRulesRoutes(calendarsRepo.getCalendarById, getEventsWithRules, setRuleTags))
  // JRNL-01 (22-03): GET /api/journal/:calendarId/lifecycle — enriched series (forward vol +
  // P&L attribution), JWT-gated via this apiRouter mount (T-22-05, never mount on `app`).
  .route("/", journalLifecycleRoutes(getCalendarLifecycle))
  // BRK-02: positions, transactions, orders read endpoints
  .route("/", brokerageRoutes(getPositions, getTransactions, getOrders))
  // ANLY-03 (06-04/06-05): GET /api/analytics/term-structure + GET /api/analytics/skew
  // COT-02 (13-06): GET /api/analytics/cot — CFTC TFF weekly series (MCP-02)
  // MAC-02 (14-06): GET /api/analytics/macro — FRED + VVIX series (MCP-02)
  // BOARD-01/02/03 (24-04): GET /api/analytics/regime — regime/breadth board (MCP-02)
  .route("/", analyticsRoutes(getTermStructure, getSkew, getCot, getMacro, getRegimeBoard))
  // GEX-01 (08-07): GET /api/analytics/gex — stored-row read (D-01, never recomputed)
  .route("/analytics", gexRoutes(getGex))
  // PICK-02 (19-07): GET /api/picker/candidates — stored-row read (D-04, never recomputed)
  // D-02 (30-05): POST /api/picker/analyze — ad-hoc pasted-calendar scoring
  .route("/", pickerRoutes(getPicker, analyzeAdHocCalendar))
  // EXIT-08 (26-05): GET /api/exits — read-time exit-advice snapshot (MCP-02)
  .route("/", exitRoutes(getExitAdvice))
  // RUNTIME-* (29-13): GET/PUT /api/settings/rules — curated rule-override surface (MCP-02)
  // B4/B7 (32-04): POST /api/settings/rules/preview — staged-change dry-run, never persists
  .route("/", settingsRoutes(getRuleSettings, setRuleOverrides, previewRuleOverrides))
  // REAUTH-05 (37-05): POST /api/reauth/{start,exchange} — JWT-gated proxy to the sidecar admin
  // surface (operator-only, any authed user). MCP intentionally excluded (HTTP-only surface).
  .route("/", reauthRoutes(startReauth, exchangeReauth));

// Phase 12 (12-05): streaming — build shared deps before route mounts.
const sidecarReconciler = makeSidecarPositionReconciler({
  fetch: globalThis.fetch,
  baseUrl: config.SIDECAR_URL,
});
const streamRouteDeps = {
  reconcilePositions: sidecarReconciler,
  sidecarUrl: config.SIDECAR_URL,
};

// GET /api/stream OUTSIDE authReadGroup — EventSource cannot send JWT headers (Pitfall 7, D-01).
// makeStreamSseRouter() only registers GET /stream (no POST routes), so POST requests
// are not matched here and fall through to the authReadGroup mount below.
// MUST be mounted BEFORE app.route("/api", authReadGroup) — Hono first-match-wins.
app.route("/api", makeStreamSseRouter(streamRouteDeps));

// Wrap the data read router in a Supabase-Auth JWT group (asymmetric JWKS verify — ES256).
// D20 / D-02 scope: /api/calendars + /api/journal + /api/positions + /api/analytics/* etc.
// /api/status is intentionally EXCLUDED from this group (public healthcheck — see above).
// The /api/jobs/* bearerAuth group and /mcp mount are NOT in this group (D-02 anti-pattern).
const supabaseJwksUrl = new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
const authReadGroup = new Hono();
authReadGroup.use("/*", makeSupabaseJwtAuth({ getKey: createRemoteJWKSet(supabaseJwksUrl) }));
authReadGroup.route("/", apiRouter);
// POST /api/stream/ticket + POST /api/stream/subscribe INSIDE JWT group (Pitfall 7).
// GET /api/stream from streamRoutes() is also in the router but never matched here —
// it is already served by the outer makeStreamSseRouter mount above.
authReadGroup.route("/", streamRoutes(streamRouteDeps));
app.route("/api", authReadGroup);

// JOB-01 / MCP-02: on-demand job trigger — bearer-guarded (T-05-21, Security Domain).
// Mounted as a SEPARATE bearer-protected group outside the JWT authReadGroup.
// D-02: /api/jobs/* must NOT be gated by Supabase Auth — it uses the MCP bearer token.
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);

// Mount MCP transport at /mcp (bearer-protected, stateless) — UNCHANGED (D-02 scope).
// MCP-01: base tools + BRK-02 trader tools + MCP-02 trigger_job tool + GEX-02 get_gex tool.
// COT-02 / MCP-02 (13-06): get_cot tool added here — same getCot use-case as the HTTP route.
// MAC-02 / MCP-02 (14-06): get_macro tool added here — same getMacro use-case as the HTTP route.
// PICK-02 / MCP-02 (19-07): get_picker_candidates tool added here — same getPicker use-case
// as the HTTP route.
// D-02 / MCP-02 (30-05): analyze_ad_hoc_calendar tool added here — same analyzeAdHocCalendar
// use-case as POST /api/picker/analyze.
// BOARD-03 / MCP-02 (24-04): get_regime tool added here — same getRegimeBoard use-case as the
// HTTP route.
// B4/B8 / MCP-02 (32-04): preview_rule_overrides tool added here — same combined
// previewRuleOverrides use-case as POST /api/settings/rules/preview.
const mcpRouter = makeMcpRouter(
  config,
  statusPort,
  listCalendars,
  getJournal,
  getLiveGreeks,
  getTermStructure,
  getSkew,
  getGex,
  getCot,
  getMacro,
  getPicker,
  getPositions,
  getTransactions,
  getOrders,
  enqueueJob,
  getEventsWithRules,
  setRuleTags,
  getCalendarLifecycle,
  getRegimeBoard,
  getExitAdvice,
  getRuleSettings,
  setRuleOverrides,
  analyzeAdHocCalendar,
  previewRuleOverrides,
);
app.route("", mcpRouter);

// Phase 12 (12-05): start streaming infrastructure at boot.

// D-07: 1-second coalescing flush interval — runs indefinitely; no cleanup needed
// (Railway SIGTERM kills the process). Returns NodeJS.Timer, not a Promise.
startFlushInterval();

// SNAP-01 (20-06): headless event-triggered supplemental snapshot (D-04 — detection must not
// depend on a browser tab being open). The observe→detect→cooldown→enqueue orchestration lives
// in @morai/core's makeSpotObserver (REVIEW WR-04 — extracted from this composition root so it
// is a tested unit; CR-01 — a bad sidecar timestamp is guarded there and can never throw into
// the tick loop). This root only wires the DB cooldown read (Pitfall 2 — cross-process ground
// truth) and the enqueue side effect onto the existing enqueue-only jobBoss client.
const spotObserver = makeSpotObserver({
  readLatestSnapshotTime: calendarSnapshotsRepo.readLatestSnapshotTime,
  enqueueEventMoveSnapshot: async () => {
    await jobBoss.send(
      "snapshot-calendars",
      { trigger: "event-move" },
      { singletonKey: "event-move" },
    );
  },
  onWarn: (message, detail) => {
    console.warn(message, detail);
  },
});

// SSE consumer: reads the sidecar's /sidecar/events stream, recomputes BSM greeks (D-02),
// and buffers ticks for the 1-second fan-out. runSidecarStreamWithReconnect is the self-healing
// backoff loop (REVIEW WR-02) — a disconnect reconnects instead of killing the stream. void-ed
// per floating-promise rule (typescript.md); the loop never rejects.
void runSidecarStreamWithReconnect(config.SIDECAR_URL, {
  fetch: globalThis.fetch,
  recompute: recomputeLiveGreek,
  bufferTick,
  observeSpot: (spot, tsIso) => void spotObserver.observe(spot, tsIso),
  // LIVE-02 (Phase 38): dedicated fan-out lanes, siblings of observeSpot above —
  // observeSpot keeps feeding SNAP-01 (a different consumer); these feed the new
  // browser-facing "spot"/"indices" SSE events via the existing 1s flush interval.
  broadcastSpot: (spot, ts) => bufferSpot(spot, ts),
  broadcastIndices: (values, ts) => bufferIndices(values, ts),
  riskFreeRate: 0.045, // ponytail: SOFR proxy; add config field if FRED integration added
  dividendYield: 0.013, // ponytail: SPX 12m trailing yield proxy
  now: () => new Date(),
});

// Start server
const port = config.PORT;
console.warn(`morai server listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
  // GET /api/stream holds a long-lived SSE connection. Bun's default idleTimeout is
  // 10s, which closed idle SSE before the 30s keep-alive ping could fire (browser
  // badge stuck STALE; "[Bun.serve]: request timed out after 10 seconds"). Max is
  // 255s; the 30s ping keeps the connection warm well under it.
  idleTimeout: 255,
};

// RPC-01 / SC-3: Export AppType for typed hc<AppType>() client inference.
// hono/client: `hc<AppType>("http://base")` resolves route types at compile time.
// Placing this AFTER the default export is correct — it is a type-level export only.
export type AppType = typeof app;
