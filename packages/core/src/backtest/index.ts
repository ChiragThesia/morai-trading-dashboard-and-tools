// Backtest bounded context barrel (Phase 27, Plan 01) — re-exports domain types + driven
// ports for consumption by ./index.ts (the top-level @morai/core barrel). StorageError is
// NOT re-exported here — structurally identical to (and already exported under the same
// name by) the journal context; re-exporting a second type under an existing name would
// collide (exits/index.ts precedent, see its own header comment).

export type {
  ReplayMismatchKind,
  CohortMismatch,
  ReplayMismatch,
  DirectionalAttributionRow,
  AblationRow,
  CoverageDay,
  TradeReproduction,
  BacktestReport,
} from "./domain/types.ts";

export type {
  BacktestRunRow,
  ForPersistingBacktestRun,
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StoredPickerSnapshotRow,
  ForReadingPickerSnapshotsInRange,
  FullHistorySnapshotRow,
  ForReadingFullSnapshotHistoryForCalendar,
} from "./application/ports.ts";
