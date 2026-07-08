/**
 * Picker domain types (Phase 19, Plan 03) — the shapes `candidate-selection.ts` produces and
 * `scoring.ts` consumes/produces.
 *
 * `RawCandidate` is candidate-selection's output: a delta-targeted put calendar (same strike,
 * front + back expiry) with net greeks/debit already priced via `@morai/quant`, but not yet
 * scored. `ScoredCandidate` is scoring's output: a `RawCandidate` plus the 0-100 score, the
 * closed-enum breakdown, the fwdIv guard, and the fixed-default exit plan — structurally a
 * superset mirroring `PickerCandidateDomain` (application/ports.ts), which the (out-of-scope
 * this plan) mapping layer converts into for the API/MCP boundary.
 *
 * Hexagon law (architecture-boundaries §2): pure structural types, no imports needed.
 */

/** Delta-rung label — which put-delta target this candidate's strike was selected for (D-01;
 * user-locked −0.50…−0.25 grid, 2026-07-08). */
export type DeltaRung = "50D" | "45D" | "40D" | "35D" | "30D" | "25D";

/** One leg (front or back) of a candidate calendar — puts only in scope this milestone. */
export type RawCandidateLeg = {
  /** Strike in points (already converted from the ×1000 chain convention, Pitfall 1). */
  readonly strike: number;
  readonly putCall: "P";
  /** Expiration date (YYYY-MM-DD), needed downstream for exitPlan.closeByExpiry. */
  readonly expiration: string;
  /** Days to expiration relative to the chain cohort's asOf date. */
  readonly dte: number;
  /** Per-contract implied volatility (decimal) at this leg's strike/expiry. */
  readonly iv: number;
};

/**
 * RawCandidate — candidate-selection's output / scoring's input. A delta-targeted long put
 * calendar (same strike both legs) that passed the net-θ>0 filter (criterion 6).
 */
export type RawCandidate = {
  readonly id: string;
  readonly name: string;
  readonly frontLeg: RawCandidateLeg;
  readonly backLeg: RawCandidateLeg;
  /** Which delta rung this candidate's (shared) strike was targeted against. */
  readonly deltaRung: DeltaRung;
  /** Cohort spot price (points) used to price this candidate. */
  readonly spot: number;
  /** Net position theta ($/day) — always > 0 (criterion 6 filter already applied). */
  readonly theta: number;
  /** Net position vega ($/vol-pt). */
  readonly vega: number;
  /** Net position delta ($/pt). */
  readonly delta: number;
  /** Debit paid to enter (= max loss when closed by front expiry), dollars. */
  readonly debit: number;
  /** Term-structure slope between legs, annualized vol-pts/yr (criterion 2). */
  readonly slope: number;
  /** Scheduled events the front leg spans (D-10: `(today, frontExpiry]`). */
  readonly frontEvents: ReadonlyArray<string>;
  /** Scheduled events the back leg spans, excluding any already in frontEvents. */
  readonly backEvents: ReadonlyArray<string>;
};

/** One scored criterion contributing to `ScoredCandidate.score` — closed enum (T-19-04). */
export type BreakdownCriterion = "slope" | "fwdEdge" | "gexFit" | "eventAdjustment" | "beVsEm";

export type BreakdownEntry = {
  readonly criterion: BreakdownCriterion;
  /** Points this criterion contributes at 100% (e.g. 40 for slope, 10 for eventAdjustment). */
  readonly weight: number;
  /** The criterion's raw computed metric (e.g. slope in vol-pts/yr, gexFit as a 0-1 fraction). */
  readonly rawValue: number;
  /** Normalized 0-100 share of this criterion's weight the candidate achieved. */
  readonly contribution: number;
};

/**
 * ContextEntry — one experimental (weight-0) rule's computed value for a candidate.
 * Displayed on cards ("calibrating"), never scored, until PICK-04 promotes the rule.
 * `value` is null-honest: insufficient history → null, never a fabricated number.
 */
export type ContextEntry = {
  readonly id: "vrp" | "slopePercentile" | "backEventBonus" | "thetaVega";
  readonly label: string;
  readonly value: number | null;
  readonly note: string;
};

/** Entry/exit defaults for a candidate (D-01b; fixed defaults this phase, not per-candidate tuned). */
export type ExitPlan = {
  readonly profitTargetPct: number;
  readonly stopPct: number;
  readonly manageShortDte: number;
  /** Hard close-by date (YYYY-MM-DD) — the front leg's expiration. */
  readonly closeByExpiry: string;
};

/** Per-event penalty weights (D-11) — a tunable map keyed by event name. */
export type EventPenaltyWeights = Readonly<Record<string, number>>;

/**
 * ScoredCandidate — scoring's output. A `RawCandidate` plus the score, breakdown, fwdIv guard,
 * and exit plan. Mirrors `PickerCandidateDomain` (application/ports.ts) field-for-field, minus
 * the id/name/legs/theta/vega/delta/debit/slope/frontEvents/backEvents already on RawCandidate.
 */
export type ScoredCandidate = RawCandidate & {
  /** 0-100 engine-computed score; always finite, even in the fwdIv-guard case. */
  readonly score: number;
  readonly breakdown: ReadonlyArray<BreakdownEntry>;
  /**
   * Forward IV between the two legs (criterion 1). Null when the term structure is inverted
   * (radicand < 0) — never NaN.
   */
  readonly fwdIv: number | null;
  readonly fwdIvGuard: "ok" | "inverted";
  /** Front-IV-rich-vs-forward-path edge (criterion 1); 0 in the fwdIv-guard case. */
  readonly fwdEdge: number;
  /** +/-1 sigma expected move by front expiry. */
  readonly expectedMove: number;
  /** Experimental rule values (weight 0, display-only — rules.ts registry). */
  readonly context: ReadonlyArray<ContextEntry>;
  readonly exitPlan: ExitPlan;
};
