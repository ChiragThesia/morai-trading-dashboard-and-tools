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
} from "@morai/core";
import { PgBoss } from "pg-boss";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet } from "jose";
import { makeSupabaseJwtAuth } from "./adapters/http/supabase-auth.ts";
import { bearerAuth } from "./adapters/mcp/bearer.ts";
import { statusRoutes } from "./adapters/http/status.routes.ts";
import { calendarRoutes } from "./adapters/http/calendar.routes.ts";
import { journalRoutes } from "./adapters/http/journal.routes.ts";
import { brokerageRoutes } from "./adapters/http/brokerage.routes.ts";
import { analyticsRoutes } from "./adapters/http/analytics.routes.ts";
import { gexRoutes } from "./adapters/http/gex.routes.ts";
import { jobsRoutes } from "./adapters/http/jobs.routes.ts";
import { makeMcpRouter } from "./adapters/mcp/server.ts";

const config = bootConfig();

// Build the Postgres pool + Drizzle instance
const db = makeDb(config.DATABASE_URL);

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
const jobBoss = new PgBoss(config.DATABASE_URL);
await jobBoss.start();
const pgBossJobQueue = makePgBossJobQueue(jobBoss);
const enqueueJob = makeEnqueueJobUseCase({
  jobQueue: pgBossJobQueue.enqueue,
  now: () => new Date(),
});

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
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

// SC-4 / AUTH-01 / RPC-01: Chain all read routes into one sub-router so hc<AppType>()
// inference works (RESEARCH A5 / Pattern 6). The chained form is REQUIRED for AppType;
// the statement-style app.route() calls are NOT chainable and break type inference.
const apiRouter = new Hono()
  .route("/", statusRoutes(getStatus))
  .route("/", calendarRoutes(registerCalendar, listCalendars, closeCalendar))
  .route("/", journalRoutes(getJournal))
  // BRK-02: positions, transactions, orders read endpoints
  .route("/", brokerageRoutes(getPositions, getTransactions, getOrders))
  // ANLY-03 (06-04/06-05): GET /api/analytics/term-structure + GET /api/analytics/skew
  .route("/", analyticsRoutes(getTermStructure, getSkew))
  // GEX-01 (08-07): GET /api/analytics/gex — stored-row read (D-01, never recomputed)
  .route("/analytics", gexRoutes(getGex));

// Wrap the read router in a Supabase-Auth JWT group (asymmetric JWKS verify — ES256).
// D20 / D-02 scope: ONLY /api/analytics/* + /api/status + /api/journal + /api/positions etc.
// The /api/jobs/* bearerAuth group and /mcp mount are NOT in this group (D-02 anti-pattern).
const supabaseJwksUrl = new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
const authReadGroup = new Hono();
authReadGroup.use("/*", makeSupabaseJwtAuth({ getKey: createRemoteJWKSet(supabaseJwksUrl) }));
authReadGroup.route("/", apiRouter);
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
const mcpRouter = makeMcpRouter(
  config,
  getStatus,
  listCalendars,
  getJournal,
  getLiveGreeks,
  getTermStructure,
  getSkew,
  getGex,
  getPositions,
  getTransactions,
  getOrders,
  enqueueJob,
);
app.route("", mcpRouter);

// Start server
const port = config.PORT;
console.warn(`morai server listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};

// RPC-01 / SC-3: Export AppType for typed hc<AppType>() client inference.
// hono/client: `hc<AppType>("http://base")` resolves route types at compile time.
// Placing this AFTER the default export is correct — it is a type-level export only.
export type AppType = typeof app;
