/**
 * calendar — the deterministic calendar-spread ranking engine.
 *
 * Reads one chain snapshot, enumerates every calendar the trader would consider, measures both
 * legs, and ranks. Front leg at least 15 DTE and a gap of at least 15 days are hard floors, not
 * knobs. Replaces `packages/core/src/picker`.
 *
 * Full specification: docs/calendar-engine/spec.mdx
 */

// ── Domain: the math ──
export { yearsToSettlement, calendarDaysTo, DAYS_PER_YEAR } from "./domain/time.ts";
export { buildCohorts, quotedAtm, snapshotSpot } from "./domain/cohort.ts";
export type { BuildCohortsOptions } from "./domain/cohort.ts";
export { pairMetrics } from "./domain/pair.ts";
export type { PairLeg, PairMetrics } from "./domain/pair.ts";
export {
  enumerateCandidates,
  FRONT_DTE_FLOOR,
  GAP_DAYS_FLOOR,
  BACK_DTE_CEILING,
} from "./domain/candidate.ts";
export type {
  Candidate,
  EnumerateOptions,
  EnumerateResult,
  NetGreeks,
} from "./domain/candidate.ts";
export { scoreCandidates, SCORE_WEIGHTS } from "./domain/score.ts";
export type { ScoredCalendar, ScoreTerm, ScoreTermKey } from "./domain/score.ts";
export type {
  CalendarChainQuote,
  Carry,
  Cohort,
  CohortLeg,
  DropCounts,
  DropReason,
  Root,
  UnpricedStrike,
} from "./domain/types.ts";

// ── Application: the use-case and its ports ──
export { makeRankCalendarsUseCase } from "./application/rankCalendars.ts";
export type { RankCalendarsDeps } from "./application/rankCalendars.ts";
export { makePriceChainUseCase } from "./application/priceChain.ts";
export type { PriceChainDeps } from "./application/priceChain.ts";
export { makeRecordCalendarRankingUseCase } from "./application/recordCalendarRanking.ts";
export type { RecordCalendarRankingDeps } from "./application/recordCalendarRanking.ts";
export type {
  CalendarRanking,
  CalendarRankingRow,
  ChainCohortView,
  ChainStrikeRow,
  ChainSurface,
  ForPersistingCalendarRanking,
  ForPricingChain,
  ForRankingCalendars,
  ForReadingCalendarChain,
  ForReadingDailyCloses,
  ForRecordingCalendarRanking,
  PriceChainRequest,
  RankCalendarsRequest,
  RecordedRanking,
} from "./application/ports.ts";
