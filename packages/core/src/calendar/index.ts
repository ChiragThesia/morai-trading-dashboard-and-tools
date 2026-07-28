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
export { buildCohorts, snapshotSpot } from "./domain/cohort.ts";
export type { BuildCohortsOptions } from "./domain/cohort.ts";
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
  CarrySource,
  Cohort,
  CohortLeg,
  DropCounts,
  DropReason,
  Root,
} from "./domain/types.ts";

// ── Application: the use-case and its ports ──
export { makeRankCalendarsUseCase } from "./application/rankCalendars.ts";
export type { RankCalendarsDeps } from "./application/rankCalendars.ts";
export type {
  CalendarRanking,
  ExpiryCarry,
  ForRankingCalendars,
  ForReadingCalendarChain,
  ForReadingDailyCloses,
  ForReadingExpiryCarry,
  RankCalendarsRequest,
} from "./application/ports.ts";
