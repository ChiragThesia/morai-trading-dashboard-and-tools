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
} from "@morai/core";
import { PgBoss } from "pg-boss";
import { Hono } from "hono";
import { bearerAuth } from "./adapters/mcp/bearer.ts";
import { statusRoutes } from "./adapters/http/status.routes.ts";
import { calendarRoutes } from "./adapters/http/calendar.routes.ts";
import { journalRoutes } from "./adapters/http/journal.routes.ts";
import { brokerageRoutes } from "./adapters/http/brokerage.routes.ts";
import { analyticsRoutes } from "./adapters/http/analytics.routes.ts";
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

// Mount HTTP routes
app.route("/api", statusRoutes(getStatus));
app.route("/api", calendarRoutes(registerCalendar, listCalendars, closeCalendar));
app.route("/api", journalRoutes(getJournal));
// BRK-02: positions, transactions, orders read endpoints
app.route("/api", brokerageRoutes(getPositions, getTransactions, getOrders));
// ANLY-03 (06-04): GET /api/analytics/term-structure (skew route added in 06-05)
app.route("/api", analyticsRoutes(getTermStructure));

// JOB-01 / MCP-02: on-demand job trigger — bearer-guarded (T-05-21, Security Domain).
// Mounted as a separate bearer-protected group so existing /api/* routes are unaffected.
// The /api/jobs/* sub-group requires the same MCP_BEARER_TOKEN used by the MCP transport.
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);

// Mount MCP transport at /mcp (bearer-protected, stateless)
// MCP-01: base tools + BRK-02 trader tools + MCP-02 trigger_job tool
const mcpRouter = makeMcpRouter(
  config,
  getStatus,
  listCalendars,
  getJournal,
  getLiveGreeks,
  getTermStructure,
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
