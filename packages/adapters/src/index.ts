// @morai/adapters — driven adapters (Postgres, memory).
// Hexagonal law: adapters import core ports + shared only.
// Drizzle confined to postgres/ subdirectory.

// Schema
export * from "./postgres/schema.ts";

// DB factory
export { makeDb } from "./postgres/db.ts";
export type { Db } from "./postgres/db.ts";

// Migrator
export { runMigrations } from "./postgres/migrate.ts";

// Postgres adapters
export { makePostgresCalendarsRepo } from "./postgres/repos/calendars.ts";
export { makePostgresLegObservationsRepo } from "./postgres/repos/leg-observations.ts";
export type { PostgresLegObservationsRepo } from "./postgres/repos/leg-observations.ts";

// HTTP adapters (external data sources)
export { makeCboeChainAdapter } from "./http/cboe.ts";
export type { CboeChainAdapter } from "./http/cboe.ts";

// In-memory adapters (test doubles; also usable in development)
export { makeMemoryCalendarsRepo } from "./memory/calendars.ts";
export { makeMemoryChainAdapter } from "./memory/chain.ts";
export type { MemoryChainAdapter } from "./memory/chain.ts";

// Note: contract test harness in src/__contract__/ is excluded from tsconfig emit
// (test-only code using vitest). Import directly from the file path in test code.
