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
  BootstrapCiRow,
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

// ─── Report kernel (Phase 27, Plan 04) — pure, no I/O, reused by 06's runBacktest ──────
export {
  directionalAttribution,
  type AttributionSample,
  type AttributionVerdict,
  type AttributionResult,
} from "./domain/directional-attribution.ts";
export { ablationDelta } from "./domain/ablation-delta.ts";
export { bootstrapCi, quantile, type BootstrapCiResult } from "./domain/bootstrap-ci.ts";
export {
  coveragePercent,
  type CoverageCohort,
  type CoverageSlotKind,
  type CoverageDayResult,
  type CoveragePercentResult,
} from "./domain/coverage.ts";

// ─── Replay use-cases (Phase 27, Plan 05) — the three replay paths, reused by 06's
// runBacktest orchestrator ──────────────────────────────────────────────────────
export { replayPickerCohort, type ReplayPickerCohortDeps } from "./application/replayPickerCohort.ts";
export {
  replayExitsForCalendar,
  type ReplayExitsForCalendarDeps,
} from "./application/replayExitsForCalendar.ts";
export {
  replayHypotheticalEntry,
  type ReplayHypotheticalEntryDeps,
  type HypotheticalCandidateOutcome,
  type HypotheticalCohortResult,
  type HypotheticalOutcomeCaveat,
} from "./application/replayHypotheticalEntry.ts";

// ─── Orchestrator (Phase 27, Plan 06) — reduces the three replay paths into one persisted
// BacktestReport; the CLI's (apps/worker/src/backtest.ts) only reach into this context ──────
export { makeRunBacktestUseCase, type RunBacktestDeps, type RunBacktestParams } from "./application/runBacktest.ts";
