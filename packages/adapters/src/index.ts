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
// AUTH-02: broker-tokens Postgres repo (pgcrypto encryption at rest)
export { makePostgresBrokerTokensRepo } from "./postgres/repos/broker-tokens.ts";
export type { PostgresBrokerTokensRepo } from "./postgres/repos/broker-tokens.ts";

// Phase 5: calendar-events + orphan-fills Postgres repos (JRNL-01 / SC4)
export { makePostgresCalendarEventsRepo } from "./postgres/repos/calendar-events.ts";
export type { PostgresCalendarEventsRepo } from "./postgres/repos/calendar-events.ts";
export { makePostgresOrphanFillsRepo } from "./postgres/repos/orphan-fills.ts";
export type { PostgresOrphanFillsRepo } from "./postgres/repos/orphan-fills.ts";

// Phase 5: in-memory twins for calendar-events + orphan-fills
export { makeMemoryCalendarEventsRepo } from "./memory/calendar-events.ts";
export type { MemoryCalendarEventsRepo } from "./memory/calendar-events.ts";
export { makeMemoryOrphanFillsRepo } from "./memory/orphan-fills.ts";
export type { MemoryOrphanFillsRepo } from "./memory/orphan-fills.ts";

// Phase 5 (gap round 05-12): fills data-path repo (A1 + A3) — postgres + memory twin
export { makePostgresFillsRepo } from "./postgres/repos/fills.ts";
export type { PostgresFillsRepo } from "./postgres/repos/fills.ts";
export { makeMemoryFillsRepo } from "./memory/fills.ts";
export type { MemoryFillsRepo } from "./memory/fills.ts";

// Phase 6 (06-04): term-structure observations repo (ANLY-02) — postgres + memory twin
export { makePostgresTermStructureObservationsRepo } from "./postgres/repos/term-structure-observations.ts";
export type { PostgresTermStructureObservationsRepo } from "./postgres/repos/term-structure-observations.ts";
export { makeMemoryTermStructureObservationsRepo } from "./memory/term-structure-observations.ts";
export type { MemoryTermStructureObservationsRepo } from "./memory/term-structure-observations.ts";

// Phase 6 (06-05): skew (per-strike smile) + risk-reversal repos (ANLY-01) — postgres + memory twin
export { makePostgresSkewObservationsRepo } from "./postgres/repos/skew-observations.ts";
export type { PostgresSkewObservationsRepo } from "./postgres/repos/skew-observations.ts";
export { makeMemorySkewObservationsRepo } from "./memory/skew-observations.ts";
export type { MemorySkewObservationsRepo } from "./memory/skew-observations.ts";
export { makePostgresRiskReversalObservationsRepo } from "./postgres/repos/risk-reversal-observations.ts";
export type { PostgresRiskReversalObservationsRepo } from "./postgres/repos/risk-reversal-observations.ts";
export { makeMemoryRiskReversalObservationsRepo } from "./memory/risk-reversal-observations.ts";
export type { MemoryRiskReversalObservationsRepo } from "./memory/risk-reversal-observations.ts";

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

// Schwab HTTP adapters (AUTH-01)
export { makeSchwabOAuthClient } from "./schwab/auth/oauth-client.ts";
export type {
  SchwabOAuthClient,
  SchwabTokens,
  OAuthError,
} from "./schwab/auth/oauth-client.ts";

// BRK-01: Schwab market chain adapter (ForFetchingChain implementor)
export { makeSchwabChainAdapter } from "./schwab/market/chain-adapter.ts";
export type { SchwabChainAdapter } from "./schwab/market/chain-adapter.ts";

// BRK-02: Schwab trader adapters (positions, transactions, orders, account hash)
export { makeAccountHashResolver } from "./schwab/trader/account-hash.ts";
export type { AccountHashResolver } from "./schwab/trader/account-hash.ts";
export { makeSchwabPositionsAdapter } from "./schwab/trader/positions-adapter.ts";
export type { SchwabPositionsAdapter } from "./schwab/trader/positions-adapter.ts";
export { makeSchwabTransactionsAdapter } from "./schwab/trader/transactions-adapter.ts";
export type { SchwabTransactionsAdapter } from "./schwab/trader/transactions-adapter.ts";
export { makeSchwabOrdersAdapter } from "./schwab/trader/orders-adapter.ts";
export type { SchwabOrdersAdapter } from "./schwab/trader/orders-adapter.ts";

// BRK-02: In-memory twin for Schwab trader ports
export { makeMemorySchwabTrader } from "./memory/schwab-trader.ts";
export type { MemorySchwabTrader } from "./memory/schwab-trader.ts";

// pg-boss adapters (job queue, JOB-01)
export { makePgBossJobQueue } from "./pgboss/job-queue.ts";
export type { PgBossJobQueue } from "./pgboss/job-queue.ts";

// In-memory job queue twin (JOB-01, architecture-boundaries.md §8)
export { makeMemoryJobQueue } from "./memory/job-queue.ts";
export type { MemoryJobQueue, MemoryJobQueueEntry } from "./memory/job-queue.ts";

// Note: contract test harness in src/__contract__/ is excluded from tsconfig emit
// (test-only code using vitest). Import directly from the file path in test code.
