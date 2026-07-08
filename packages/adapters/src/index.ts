// @morai/adapters — driven adapters (Postgres, memory).
// Hexagonal law: adapters import core ports + shared only.
// Drizzle confined to postgres/ subdirectory.

// Schema
export * from "./postgres/schema.ts";

// DB factory
export { makeDb } from "./postgres/db.ts";
export type { Db } from "./postgres/db.ts";

// Drizzle sql tag — re-exported so integration tests in other packages (e.g. apps/server)
// can run raw SQL queries against a makeDb instance without a direct drizzle-orm import.
// drizzle-orm is confined to adapters (architecture rule) but tests need the sql tag.
export { sql } from "drizzle-orm";

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

// RULE-01 (20-08, barrel gap closed 20-10): calendar-event-annotations Postgres repo +
// in-memory twin (D-09/D-10/D24). Structurally matches @morai/core's ForReadingAnnotations/
// ForWritingAnnotations exactly (20-09) — no wiring changes needed beyond the barrel export.
export { makePostgresCalendarEventAnnotationsRepo } from "./postgres/repos/calendar-event-annotations.ts";
export type { PostgresCalendarEventAnnotationsRepo } from "./postgres/repos/calendar-event-annotations.ts";
export { makeMemoryCalendarEventAnnotationsRepo } from "./memory/calendar-event-annotations.ts";
export type { MemoryCalendarEventAnnotationsRepo } from "./memory/calendar-event-annotations.ts";

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

// Phase 8 (08-05/08-06): GEX snapshot repo — postgres + in-memory twin (WR-07: §8 "ship the twin")
export { makePostgresGexSnapshotRepo } from "./postgres/gex-snapshot.repo.ts";
export type { PostgresGexSnapshotRepo } from "./postgres/gex-snapshot.repo.ts";
export { makeMemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";
export type { MemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";

// HTTP adapters (external data sources)
export { makeCboeChainAdapter } from "./http/cboe.ts";
export type { CboeChainAdapter } from "./http/cboe.ts";

// Sidecar HTTP adapter (ForFetchingChain via Python sidecar — JRNL-02, D-08)
export { makeSidecarChainAdapter, SidecarChainResponseSchema } from "./sidecar/chain-adapter.ts";
export type { SidecarChainAdapter } from "./sidecar/chain-adapter.ts";

// Phase 12 (12-05): real ForReconcilingPositions over GET /sidecar/positions (STRM-05)
export { makeSidecarPositionReconciler } from "./sidecar/positions-reconciler.ts";
export type { SidecarPositionReconcilerDeps } from "./sidecar/positions-reconciler.ts";
export { makeFredRateAdapter, makeFredSeriesAdapter } from "./http/fred.ts";
// Phase 14 (14-03): CBOE VVIX index-quote adapter — ForFetchingVvixQuote (MAC-01, D-15)
export { makeCboeVvixAdapter } from "./http/cboe-vvix.ts";
// Phase 13 (13-02): CFTC Socrata TFF adapter — ForFetchingCotReport over gpe5-46if.json (COT-01)
export { makeCftcCotAdapter } from "./http/cftc.ts";
// Phase 13 (13-03): COT observations repo — ForPersistingCotObservation + ForReadingCotObservations
export { makePostgresCotObservationsRepo } from "./postgres/repos/cot-observations.ts";
export type { PostgresCotObservationsRepo } from "./postgres/repos/cot-observations.ts";
// Phase 13 (13-03): in-memory twin for cot-observations (architecture-boundaries §8)
export { makeMemoryCotObservationsRepo } from "./memory/cot-observations.ts";
export type { MemoryCotObservationsRepo } from "./memory/cot-observations.ts";
// Phase 14 (14-03): macro-observations repo — ForPersistingMacroObservation + ForReadingMacroObservations (MAC-01)
export { makePostgresMacroObservationsRepo } from "./postgres/repos/macro-observations.ts";
export type { PostgresMacroObservationsRepo } from "./postgres/repos/macro-observations.ts";
// Phase 14 (14-03): in-memory twin for macro-observations (architecture-boundaries §8)
export { makeMemoryMacroObservationsRepo } from "./memory/macro-observations.ts";
export type { MemoryMacroObservationsRepo } from "./memory/macro-observations.ts";

// Phase 19 (19-07): picker-snapshot repo — postgres + in-memory twin (architecture-boundaries §8)
export { makePostgresPickerSnapshotRepo } from "./postgres/repos/picker-snapshot.ts";
export type { PostgresPickerSnapshotRepo } from "./postgres/repos/picker-snapshot.ts";
export { makeMemoryPickerSnapshotRepo } from "./memory/picker-snapshot.ts";
export type { MemoryPickerSnapshotRepo } from "./memory/picker-snapshot.ts";

// Picker rule engine: history reads for the experimental vrp/slopePercentile rules —
// postgres + in-memory twin (architecture-boundaries §8)
export { makePostgresPickerHistoryRepo } from "./postgres/repos/picker-history.ts";
export type { PostgresPickerHistoryRepo } from "./postgres/repos/picker-history.ts";
export { makeMemoryPickerHistoryRepo } from "./memory/picker-history.ts";
export type { MemoryPickerHistoryRepo } from "./memory/picker-history.ts";

// Phase 19 (19-04/19-08): economic-events adapter (FRED+FOMC seed) + repo — postgres + in-memory twin
export { makeEconomicEventsAdapter, FOMC_SEED } from "./http/economic-events.ts";
export { makePostgresEconomicEventsRepo } from "./postgres/repos/economic-events.ts";
export type { PostgresEconomicEventsRepo } from "./postgres/repos/economic-events.ts";
export { makeMemoryEconomicEventsRepo } from "./memory/economic-events.ts";
export type { MemoryEconomicEventsRepo } from "./memory/economic-events.ts";

// Phase 19 (19-05/19-08): picker-chain repo (ForReadingChainForPicker) — postgres + in-memory twin
export { makePostgresPickerChainRepo } from "./postgres/repos/picker-chain.ts";
export type { PostgresPickerChainRepo } from "./postgres/repos/picker-chain.ts";
export { makeMemoryPickerChainRepo } from "./memory/picker-chain.ts";
export type { MemoryPickerChainRepo } from "./memory/picker-chain.ts";

// In-memory adapters (test doubles; also usable in development)
export { makeMemoryCalendarsRepo } from "./memory/calendars.ts";
export { makeMemoryCalendarSnapshotsRepo } from "./memory/calendar-snapshots.ts";
export type { MemoryCalendarSnapshotsRepo } from "./memory/calendar-snapshots.ts";
export type { MemoryCalendarsRepo } from "./memory/calendars.ts";
export { makeMemoryLegObservationsRepo } from "./memory/leg-observations.ts";
export type { MemoryLegObservationsRepo } from "./memory/leg-observations.ts";
export { makeMemoryChainAdapter } from "./memory/chain.ts";
export type { MemoryChainAdapter } from "./memory/chain.ts";
export { makeMemorySidecarChainAdapter } from "./memory/sidecar-chain.ts";
export type { MemorySidecarChainAdapter } from "./memory/sidecar-chain.ts";
export { makeMemoryRateAdapter } from "./memory/rate.ts";
export type { MemoryRateAdapter } from "./memory/rate.ts";
// Phase 13 (13-02): in-memory twin for ForFetchingCotReport (COT-01, architecture-boundaries §8)
export { makeMemoryCotReportAdapter } from "./memory/cot.ts";
export type { MemoryCotReportAdapter } from "./memory/cot.ts";
// Phase 14 (review WR-03): in-memory twins for ForFetchingFredSeries + ForFetchingVvixQuote
// (MAC-01, architecture-boundaries §8 — every driven port ships its memory twin)
export { makeMemoryFredSeriesAdapter } from "./memory/fred-series.ts";
export type { MemoryFredSeriesAdapter } from "./memory/fred-series.ts";
export { makeMemoryVvixAdapter } from "./memory/vvix.ts";
export type { MemoryVvixAdapter } from "./memory/vvix.ts";
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

// Phase 12 (12-01): in-memory position reconciler twin (ForReconcilingPositions port)
export { makeMemoryPositionReconciler } from "./memory/position-reconciler.ts";
export type { MemoryPositionReconciler } from "./memory/position-reconciler.ts";

// Note: contract test harness in src/__contract__/ is excluded from tsconfig emit
// (test-only code using vitest). Import directly from the file path in test code.
