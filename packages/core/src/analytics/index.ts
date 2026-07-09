// Analytics bounded context — public surface (Phase 6).
// Hexagon law: this context imports @morai/shared only. Re-exports driven ports + row domain
// types here; the domain functions (06-03) and use-case factories (06-04/06-05) re-export later.

// Domain functions (06-03)
export { interpolateRiskReversal } from "./domain/risk-reversal.ts";
export { percentileRank } from "./domain/percentile-rank.ts";

// Regime banding domain (Phase 24, BOARD-01/02) — pure calm/warning/crisis classifiers
export {
  bandVixTermStructure,
  bandVvix,
  bandVix9dRatio,
  bandHyOas,
} from "./domain/regime.ts";
export type { RegimeBand } from "./domain/regime.ts";

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
// Use-case (06-05: skew read forwarder over the headline risk-reversal series)
export { makeGetSkewUseCase } from "./application/getSkew.ts";
export type { GetSkewDeps, ForRunningGetSkew } from "./application/getSkew.ts";
export type {
  StorageError,
  SmileQuote,
  SmileReadResult,
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
  ForReadingSkewSmileDetail,
  ForReadingTermStructureSeries,
  // GEX ports + row types (Phase 8, Plan 08-05)
  LegObsForGex,
  GexSnapshotRow,
  ForReadingLegObsForGex,
  ForReadingGexSnapshot,
  ForPersistingGexSnapshot,
  ForRunningComputeGexSnapshot,
  ForRunningGetGex,
} from "./application/ports.ts";
// GEX use-cases (08-05)
export { makeComputeGexSnapshotUseCase } from "./application/computeGexSnapshot.ts";
export type { ComputeGexSnapshotDeps } from "./application/computeGexSnapshot.ts";
export { makeGetGexUseCase } from "./application/getGex.ts";
export type { GetGexDeps } from "./application/getGex.ts";
