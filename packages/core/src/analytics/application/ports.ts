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
 * SmileReadResult — the bounded smile read's result (06-06 / CR-01). `quotes` is the resolved
 * cohort's per-strike smile; `cycleTime` is the DATA instant that cohort was stamped at (the
 * resolved leg-observations cycle), or null when no BSM-solved cohort exists at or before the
 * anchor. The use-case stamps skew/RR rows with `cycleTime` — never now() — so re-runs are
 * idempotent. SmileQuote points carry no time field, so the resolved instant is surfaced here.
 */
export type SmileReadResult = {
  readonly cycleTime: Date | null;
  readonly quotes: ReadonlyArray<SmileQuote>;
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
 * ForReadingSmileSource — read the per-strike smile (delta, iv) for a cycle from leg_observations.
 * The argument is the cycle ANCHOR (an upper bound), NOT an exact-equality match: the read resolves
 * the latest leg-observations cohort AT OR BEFORE the anchor (mirroring readSnapshotsForCycle's
 * "latest snapshot ≤ now" resolution) and returns it as a SmileReadResult. `cycleTime` is the
 * resolved DATA instant (the cohort's time) — the use-case stamps skew/RR with it, never now().
 * `cycleTime` is null and `quotes` is empty when no BSM-solved cohort exists at or before the
 * anchor (06-06 / CR-01).
 */
export type ForReadingSmileSource = (
  snapshotTime: Date,
) => Promise<Result<SmileReadResult, StorageError>>;

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
 * ForReadingSkewSeries — read the headline risk-reversal series for GET /api/analytics/skew,
 * queryable by underlying/expiration. The "skew" read surface (SPEC R5) returns the derived 25Δ
 * risk-reversal scalar + trailing rank (value = risk_reversal), NOT the per-strike smile detail.
 * Returns empty array when no rows match.
 */
export type ForReadingSkewSeries = (
  query: {
    readonly underlying?: string;
    readonly expiration?: string; // YYYY-MM-DD
  },
) => Promise<Result<ReadonlyArray<RiskReversalObservationRow>, StorageError>>;

/**
 * ForReadingSkewSmileDetail — read the per-strike smile rows from skew_observations, ordered by
 * snapshot_time ASC, queryable by underlying/expiration. This is the optional smile DETAIL (ANLY-01
 * R1), distinct from the headline ForReadingSkewSeries (risk-reversal). Empty array when none.
 */
export type ForReadingSkewSmileDetail = (
  query: {
    readonly underlying?: string;
    readonly expiration?: string; // YYYY-MM-DD
  },
) => Promise<Result<ReadonlyArray<SkewObservationRow>, StorageError>>;

/**
 * ForReadingTermStructureSeries — read the term-structure series for
 * GET /api/analytics/term-structure, queryable by calendarId. Returns empty array when none.
 */
export type ForReadingTermStructureSeries = (
  query: {
    readonly calendarId?: string;
  },
) => Promise<Result<ReadonlyArray<TermStructureObservationRow>, StorageError>>;

// ─── GEX driven ports + row types (Phase 8, Plan 08-02) ─────────────────────
// Declared here; implemented by Postgres + memory adapters in 08-05.
// Hexagon law (§2): imports ONLY @morai/shared — no drizzle, no zod, no other context domain.

/**
 * LegObsForGex — one leg observation row read for GEX computation.
 * Joined from leg_observations + contracts; filtered to the latest available cycle.
 * `strike` follows the ×1000 integer convention (e.g. 7400000 = 7400 strike).
 * `bsmGamma` and `bsmIv` are string (numeric PG column) — null when BSM not yet computed.
 */
export type LegObsForGex = {
  readonly time: Date;
  readonly contract: string;
  readonly underlyingPrice: number;
  readonly bsmGamma: string | null;
  readonly bsmIv: string | null;
  readonly openInterest: number;
  readonly contractType: "C" | "P";
  /** Strike ×1000 integer convention (e.g. 7400 strike → 7400000). */
  readonly strike: number;
  /** YYYY-MM-DD expiration date. */
  readonly expiration: string;
};

/**
 * GexSnapshotRow — the full GEX snapshot ready to persist or return from the repo.
 * Mirrors gexSnapshotEntry (contracts package) as a domain-typed readonly struct.
 */
export type GexSnapshotRow = {
  readonly cycleTime: Date;
  readonly spot: number;
  readonly flip: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly netGammaAtSpot: number;
  /**
   * Spot-price grid profile. Field is `spot` (not `strike`) — the axis is a
   * simulated spot level, not an option strike (WR-01).
   */
  readonly profile: ReadonlyArray<{ readonly spot: number; readonly gamma: number }>;
  readonly strikes: ReadonlyArray<{
    readonly k: number;
    readonly gex: number;
    readonly coi: number;
    readonly poi: number;
    readonly vol: number;
  }>;
  readonly byExpiry: ReadonlyArray<{ readonly date: string; readonly gex: number }>;
  /**
   * Near-term (≤45d DTE) level set — walls/flip recomputed from only the near-dated
   * legs, so a far-dated OI monster (e.g. Sept quarterly 8000s) can't hide the
   * intraday-relevant wall. Null when no near-term legs solve.
   */
  readonly nearTerm: {
    readonly callWall: number | null;
    readonly putWall: number | null;
    readonly flip: number | null;
  } | null;
  readonly computedAt: Date;
};

/**
 * ForReadingLegObsForGex — read the latest leg_observations cohort for GEX computation.
 * Returns the full chain (all strikes, both calls and puts) at the most recent cycle time.
 */
export type ForReadingLegObsForGex = () => Promise<
  Result<ReadonlyArray<LegObsForGex>, StorageError>
>;

/**
 * ForReadingGexSnapshot — read the most recent persisted GexSnapshotRow.
 * Returns ok(null) when no snapshot exists yet.
 */
export type ForReadingGexSnapshot = () => Promise<Result<GexSnapshotRow | null, StorageError>>;

/**
 * ForPersistingGexSnapshot — upsert a GexSnapshotRow keyed on cycleTime.
 * Idempotent: re-running for the same cycleTime is a no-op (onConflictDoNothing).
 */
export type ForPersistingGexSnapshot = (
  row: GexSnapshotRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForRunningComputeGexSnapshot — driver port for the compute-gex-snapshot use-case factory.
 * Called by the pg-boss job handler; reads leg-obs, computes GEX, persists snapshot.
 */
export type ForRunningComputeGexSnapshot = () => Promise<Result<void, StorageError>>;

/**
 * ForRunningGetGex — driver port for the get-gex use-case factory.
 * Called by the HTTP route and MCP tool; returns the latest stored snapshot or null.
 */
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
