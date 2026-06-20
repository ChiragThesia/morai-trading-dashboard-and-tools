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
export { makePostgresCalendarSnapshotsRepo } from "./postgres/repos/calendar-snapshots.ts";
export type { PostgresCalendarSnapshotsRepo } from "./postgres/repos/calendar-snapshots.ts";
export type { PostgresCalendarsRepo } from "./postgres/repos/calendars.ts";
export { makePostgresLegObservationsRepo } from "./postgres/repos/leg-observations.ts";
export type { PostgresLegObservationsRepo } from "./postgres/repos/leg-observations.ts";
export { makePostgresRateObservationsRepo } from "./postgres/repos/rate-observations.ts";
export type { PostgresRateObservationsRepo } from "./postgres/repos/rate-observations.ts";
export { makePostgresJobRunsRepo } from "./postgres/repos/job-runs.ts";
export type { PostgresJobRunsRepo } from "./postgres/repos/job-runs.ts";

// HTTP adapters (external data sources)
export { makeCboeChainAdapter } from "./http/cboe.ts";
export type { CboeChainAdapter } from "./http/cboe.ts";
export { makeFredRateAdapter } from "./http/fred.ts";

// In-memory adapters (test doubles; also usable in development)
export { makeMemoryCalendarsRepo } from "./memory/calendars.ts";
export { makeMemoryCalendarSnapshotsRepo } from "./memory/calendar-snapshots.ts";
export type { MemoryCalendarSnapshotsRepo } from "./memory/calendar-snapshots.ts";
export type { MemoryCalendarsRepo } from "./memory/calendars.ts";
export { makeMemoryLegObservationsRepo } from "./memory/leg-observations.ts";
export type { MemoryLegObservationsRepo } from "./memory/leg-observations.ts";
export { makeMemoryChainAdapter } from "./memory/chain.ts";
export type { MemoryChainAdapter } from "./memory/chain.ts";
export { makeMemoryRateAdapter } from "./memory/rate.ts";
export type { MemoryRateAdapter } from "./memory/rate.ts";
export { makeMemoryBrokerTokensRepo } from "./memory/broker-tokens.ts";
export type { MemoryBrokerTokensRepo } from "./memory/broker-tokens.ts";

// Note: contract test harness in src/__contract__/ is excluded from tsconfig emit
// (test-only code using vitest). Import directly from the file path in test code.
