// Analytics bounded context — driven ports + row domain types.
// Hexagon law (architecture-boundaries §2): this file imports ONLY @morai/shared. No drizzle,
// no node builtins, no other context's domain. Cross-context APPLICATION port TYPES (StorageError)
// are defined locally here per the Phase 4 precedent — a cross-context DOMAIN import is forbidden.

import type { Result } from "@morai/shared";

// ─── Domain error (local; mirrors the journal StorageError shape) ──────────────

/** StorageError — driven-port failure for analytics reads/writes. */
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

// ─── Row domain types (what the analytics tables hold) ─────────────────────────

/**
 * SmileQuote — one (delta, iv) point read from leg_observations for a snapshot cycle.
 * The interpolation source for the ±25Δ risk-reversal (06-03/06-05).
 * `strike` is the ×1000 integer convention (e.g. 5500000).
 */
export type SmileQuote = {
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly strike: number; // ×1000 int
  readonly iv: number;
  readonly delta: number | null;
  readonly moneyness: number | null;
};

/**
 * CalendarSnapshotForCycle — the term-slope passthrough source for one calendar at a snapshot
 * time. value is read THROUGH from calendar_snapshots.term_slope — never recomputed (invariant 1).
 */
export type CalendarSnapshotForCycle = {
  readonly snapshotTime: Date;
  readonly calendarId: string;
  readonly termSlope: number; // = back_iv − front_iv, the source value
  readonly frontIv: number;
  readonly backIv: number;
};

/** SkewObservationRow — one smile point ready to persist to skew_observations. */
export type SkewObservationRow = {
  readonly snapshotTime: Date;
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly strike: number; // ×1000 int
  readonly iv: number;
  readonly delta: number | null;
  readonly moneyness: number | null;
};

/**
 * RiskReversalObservationRow — the 25Δ risk-reversal + trailing rank for one
 * (underlying, expiration) at a snapshot time. riskReversal is NULL when ±25Δ cannot be
 * bracketed (never fabricated); rrRank is NULL when riskReversal is null or no history exists.
 */
export type RiskReversalObservationRow = {
  readonly snapshotTime: Date;
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly riskReversal: number | null;
  readonly rrRank: number | null;
};

/** TermStructureObservationRow — back_iv − front_iv for one calendar at a snapshot time. */
export type TermStructureObservationRow = {
  readonly snapshotTime: Date;
  readonly calendarId: string;
  readonly value: number; // = CalendarSnapshotForCycle.termSlope (read through)
  readonly frontIv: number;
  readonly backIv: number;
};

// ─── Driven ports — ForVerbingNoun (architecture-boundaries §5) ────────────────
// Declared here in 06-01; implemented by Postgres + memory adapters in 06-04/06-05.

/**
 * ForReadingSmileSource — read the per-strike smile (delta, iv) for a snapshot cycle from
 * leg_observations. Returns empty array when no quotes exist for the time.
 */
export type ForReadingSmileSource = (
  snapshotTime: Date,
) => Promise<Result<ReadonlyArray<SmileQuote>, StorageError>>;

/**
 * ForReadingCalendarSnapshotsForCycle — read the per-calendar term-slope source rows for a
 * snapshot cycle from calendar_snapshots. The term-structure value is read through from here.
 */
export type ForReadingCalendarSnapshotsForCycle = (
  snapshotTime: Date,
) => Promise<Result<ReadonlyArray<CalendarSnapshotForCycle>, StorageError>>;

/**
 * ForWritingSkewObservations — bulk append skew_observations rows.
 * Idempotent: onConflictDoNothing on the per-grain composite PK.
 */
export type ForWritingSkewObservations = (
  rows: ReadonlyArray<SkewObservationRow>,
) => Promise<Result<void, StorageError>>;

/**
 * ForWritingRiskReversalObservations — bulk append risk_reversal_observations rows.
 * Idempotent: onConflictDoNothing on the per-grain composite PK.
 */
export type ForWritingRiskReversalObservations = (
  rows: ReadonlyArray<RiskReversalObservationRow>,
) => Promise<Result<void, StorageError>>;

/**
 * ForWritingTermStructureObservations — bulk append term_structure_observations rows.
 * Idempotent: onConflictDoNothing on the per-grain composite PK.
 */
export type ForWritingTermStructureObservations = (
  rows: ReadonlyArray<TermStructureObservationRow>,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingRiskReversalHistory — read prior risk-reversal values for a (underlying, expiration),
 * ordered oldest→newest, for computing the trailing-window rank. Excludes NULL risk-reversals.
 */
export type ForReadingRiskReversalHistory = (
  query: {
    readonly underlying: string;
    readonly expiration: string; // YYYY-MM-DD
    readonly beforeOrAt: Date;
  },
) => Promise<Result<ReadonlyArray<number>, StorageError>>;

/**
 * ForReadingSkewSeries — read the risk-reversal series for GET /api/analytics/skew, queryable by
 * underlying/expiration. Returns empty array when no rows match.
 */
export type ForReadingSkewSeries = (
  query: {
    readonly underlying?: string;
    readonly expiration?: string; // YYYY-MM-DD
  },
) => Promise<Result<ReadonlyArray<RiskReversalObservationRow>, StorageError>>;

/**
 * ForReadingTermStructureSeries — read the term-structure series for
 * GET /api/analytics/term-structure, queryable by calendarId. Returns empty array when none.
 */
export type ForReadingTermStructureSeries = (
  query: {
    readonly calendarId?: string;
  },
) => Promise<Result<ReadonlyArray<TermStructureObservationRow>, StorageError>>;
