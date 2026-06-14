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
} from "@morai/adapters";
import {
  makeGetStatusUseCase,
  makeRegisterCalendarUseCase,
  makeListCalendarsUseCase,
  makeCloseCalendarUseCase,
  makeGetJournalUseCase,
  makeGetLiveGreeksUseCase,
} from "@morai/core";
import { Hono } from "hono";
import { statusRoutes } from "./adapters/http/status.routes.ts";
import { calendarRoutes } from "./adapters/http/calendar.routes.ts";
import { journalRoutes } from "./adapters/http/journal.routes.ts";
import { makeMcpRouter } from "./adapters/mcp/server.ts";

const config = bootConfig();

// Build the Postgres pool + Drizzle instance
const db = makeDb(config.DATABASE_URL);

// Build the calendars repo which also implements ForPingingDb
const calendarsRepo = makePostgresCalendarsRepo(db);

// Build the job-runs repo (reads pgboss.job for D-10 lastJobRuns status)
const jobRunsRepo = makePostgresJobRunsRepo(db);

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

// Build the Hono app
const app = new Hono();

// Mount HTTP routes
app.route("/api", statusRoutes(getStatus));
app.route("/api", calendarRoutes(registerCalendar, listCalendars, closeCalendar));
app.route("/api", journalRoutes(getJournal));

// Mount MCP transport at /mcp (bearer-protected, stateless)
// MCP-01: all six tools wired — getStatus, listCalendars, getJournal, getLiveGreeks
//         + typed-empty registerGetTermStructureTool + registerGetSkewTool (no use-case).
// D-08: trigger_job NOT passed (deferred to Phase 5).
const mcpRouter = makeMcpRouter(config, getStatus, listCalendars, getJournal, getLiveGreeks);
app.route("", mcpRouter);

// Start server
const port = config.PORT;
console.warn(`morai server listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
