// Server composition root — wires config → db → adapters → use-cases → routes + MCP.
//
// Architecture law (architecture-boundaries.md):
// - process.env read ONCE here; typed config flows inward.
// - No business logic in this file; only composition.
// - TDD exempt: pure wiring (tdd.md Scope).

import { bootConfig } from "./config.ts";
import { makeDb, makePostgresCalendarsRepo } from "@morai/adapters";
import { makeGetStatusUseCase } from "@morai/core";
import { Hono } from "hono";
import { statusRoutes } from "./adapters/http/status.routes.ts";
import { makeMcpRouter } from "./adapters/mcp/server.ts";

const config = bootConfig();

// Build the Postgres pool + Drizzle instance
const db = makeDb(config.DATABASE_URL);

// Build the calendars repo which also implements ForPingingDb
const calendarsRepo = makePostgresCalendarsRepo(db);

// Build the get_status use-case — injecting the DB ping + version + start time
const startedAt = new Date();
const version = "0.0.1";

const getStatus = makeGetStatusUseCase({
  pingDb: calendarsRepo.pingDb,
  version,
  startedAt,
});

// Build the Hono app
const app = new Hono();

// Mount HTTP routes
app.route("/api", statusRoutes(getStatus));

// Mount MCP transport at /mcp (bearer-protected, stateless)
const mcpRouter = makeMcpRouter(config, getStatus);
app.route("", mcpRouter);

// Start server
const port = config.PORT;
console.warn(`morai server listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
