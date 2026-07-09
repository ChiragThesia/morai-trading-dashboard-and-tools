// Backtest bounded context — domain types (Phase 27, Plan 01).
// Pure structural types, readonly fields, no imports beyond @morai/shared — mirrors the
// exits/journal contexts' own-domain convention (architecture-boundaries §2/§7). These
// shapes are the vocabulary every later plan (03 readers, 05 replay, 06 CLI/report)
// builds on; nothing here performs I/O.

/**
 * ReplayMismatchKind — every distinct way a replay can diverge from the stored oracle.
 * "registry-drift" is NOT a leakage bug — it means rules.ts/exit-rules.ts changed since
 * the compared row was written (Common Pitfalls, 27-RESEARCH.md).
 */
export type ReplayMismatchKind =
  | "registry-drift"
  | "score-mismatch"
  | "gate-drop-mismatch"
  | "membership-mismatch";

/** CohortMismatch — one divergence found while replaying a historical cohort (BT-02). */
export type CohortMismatch = {
  readonly kind: ReplayMismatchKind;
  readonly observedAt: string; // ISO instant of the replayed cohort
  readonly detail: string;
  readonly candidateId?: string;
};

/** ReplayMismatch — alias for CohortMismatch (27-RESEARCH.md's "CohortMismatch/ReplayMismatch union"). */
export type ReplayMismatch = CohortMismatch;

/** DirectionalAttributionRow — sign + n per rule, never a coefficient (BT-04, locked decision). */
export type DirectionalAttributionRow = {
  readonly ruleId: string;
  readonly sign: "positive" | "negative" | "insufficient";
  readonly n: number;
};

/** AblationRow — leave-one-rule-out rank/outcome delta (BT-04). */
export type AblationRow = {
  readonly ruleId: string;
  readonly rankDelta: number;
  readonly outcomeDelta: number;
  readonly n: number;
};

/**
 * CoverageDay — replayed-vs-expected cohort count for one calendar day (gap-row honesty).
 * `gapCohorts` (no/degenerate chain) and `emptyUniverseCohorts` (real data, zero surviving
 * candidates) are the two DISTINCT reasons a cohort was not replayed, reported separately so a
 * thin real-data footprint is never mislabeled as a data gap (WR-03).
 */
export type CoverageDay = {
  readonly date: string; // YYYY-MM-DD
  readonly expectedCohorts: number;
  readonly observedCohorts: number;
  readonly gapCohorts: number;
  readonly emptyUniverseCohorts: number;
  readonly coveragePct: number;
};

/**
 * TradeReproduction — one of the 13 closed calendars' modeled-vs-oracle outcome (BT-03).
 * `directionMatch` is the hard sign check; `magnitudeMatch` is the plan's ~3x tolerance band
 * (|modeled| vs |oracle| within MAGNITUDE_TOLERANCE_MULTIPLE, replayExitsForCalendar.ts). The
 * `reproduction` verdict distinguishes a full reproduction from a direction-only agreement
 * whose magnitude the approximate haircut-fill model could not reproduce within band (WR-02).
 */
export type TradeReproduction = {
  readonly calendarId: string;
  readonly directionMatch: boolean;
  readonly magnitudeMatch: boolean;
  readonly reproduction: "reproduced" | "direction-only" | "diverged";
  readonly modeledPnl: number;
  readonly oraclePnl: number;
};

/**
 * BootstrapCiRow — a seeded bootstrap CI (bootstrap-ci.ts) on one headline P&L metric
 * (BT-04). Added in Plan 06: the shipped Plan 01 BacktestReport shape had nowhere to carry
 * "Bootstrap CI on every headline metric" (27-CONTEXT.md's own report-content lock) — this
 * field closes that gap, additively. The interval's width AT n=13 IS the honesty signal
 * CONTEXT.md asks the report to surface, not hide.
 */
export type BootstrapCiRow = {
  readonly metric: string;
  readonly low: number;
  readonly high: number;
  readonly n: number;
};

/**
 * BacktestReport — the whole persisted report for one backtest run (BT-04/BT-05). Every
 * headline number carries n= and a date range at the top level; caveats names the
 * documented residual-optimism flags (late-solved BSM, event-discovery gap) rather than
 * silently absorbing them (backtest-harness.md).
 */
export type BacktestReport = {
  readonly generatedAt: string; // ISO instant
  readonly fromDate: string; // YYYY-MM-DD
  readonly toDate: string; // YYYY-MM-DD
  readonly n: number;
  readonly mismatches: ReadonlyArray<CohortMismatch>;
  readonly tradeReproductions: ReadonlyArray<TradeReproduction>;
  readonly attribution: ReadonlyArray<DirectionalAttributionRow>;
  readonly ablation: ReadonlyArray<AblationRow>;
  readonly coverage: ReadonlyArray<CoverageDay>;
  readonly caveats: ReadonlyArray<string>;
  readonly ci: ReadonlyArray<BootstrapCiRow>;
};
