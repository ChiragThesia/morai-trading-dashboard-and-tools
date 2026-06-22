// Analytics bounded context — public surface (Phase 6).
// Hexagon law: this context imports @morai/shared only. Re-exports driven ports + row domain
// types here; the domain functions (06-03) and use-case factories (06-04/06-05) re-export later.

// Domain functions (06-03)
export { interpolateRiskReversal } from "./domain/risk-reversal.ts";
export { percentileRank } from "./domain/percentile-rank.ts";

// Use-cases (06-04: term-structure half of compute-analytics + the read forwarder)
export { makeComputeAnalyticsUseCase } from "./application/computeAnalytics.ts";
export type {
  ComputeAnalyticsDeps,
  ForRunningComputeAnalytics,
} from "./application/computeAnalytics.ts";
export { makeGetTermStructureUseCase } from "./application/getTermStructure.ts";
export type {
  GetTermStructureDeps,
  ForRunningGetTermStructure,
} from "./application/getTermStructure.ts";

export type {
  StorageError,
  SmileQuote,
  CalendarSnapshotForCycle,
  SkewObservationRow,
  RiskReversalObservationRow,
  TermStructureObservationRow,
  ForReadingSmileSource,
  ForReadingCalendarSnapshotsForCycle,
  ForWritingSkewObservations,
  ForWritingRiskReversalObservations,
  ForWritingTermStructureObservations,
  ForReadingRiskReversalHistory,
  ForReadingSkewSeries,
  ForReadingTermStructureSeries,
} from "./application/ports.ts";
