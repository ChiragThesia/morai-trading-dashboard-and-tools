import { z } from "zod";

// Picker contracts (Phase 18, D-01; MCP-02: ONE schema source for the Phase-19
// GET /api/picker/candidates response + get_picker_candidates MCP tool).
// pickerCandidate is rich/display-complete: the engine (Phase 19) is the sole scoring
// authority, the UI is pure-render and never recomputes scores. A one-sided field
// rename fails `bun run typecheck`. No second inline picker schema.

// ─── Per-candidate leg ─────────────────────────────────────────────────────────

/** pickerCandidateLeg — one leg (front or back) of a candidate calendar. */
export const pickerCandidateLeg = z.object({
  /** Strike in points (e.g. 7500.0). */
  strike: z.number(),
  /** Option right — puts only in scope this milestone, kept as an enum for forward-compat. */
  putCall: z.enum(["C", "P"]),
  /** Days to expiration at the fixture/snapshot's reference date. */
  dte: z.number().int(),
  /** Per-strike implied volatility for this leg (skew-adjusted, not raw ATM term IV). */
  iv: z.number(),
});

export type PickerCandidateLeg = z.infer<typeof pickerCandidateLeg>;

// ─── Score breakdown ────────────────────────────────────────────────────────────

/**
 * breakdownEntry — one scored criterion contributing to `pickerCandidate.score`.
 * `criterion` is a CLOSED enum — structurally excludes every REFUTED criterion from
 * calendar-selection-criteria.md (no IV-rank gate, no -1..-3% IV-diff band, no
 * debit-%-of-back band). Adding a criterion requires an explicit schema change.
 */
export const breakdownEntry = z.object({
  criterion: z.enum(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"]),
  /** Points this criterion contributes at 100% (e.g. 40 for slope, 10 for eventAdjustment). */
  weight: z.number(),
  /** The criterion's raw computed metric (e.g. slope in vol-pts/yr, gexFit as a 0-1 fraction). */
  rawValue: z.number(),
  /** Normalized 0-100 share of this criterion's weight the candidate achieved. */
  contribution: z.number(),
});

export type BreakdownEntry = z.infer<typeof breakdownEntry>;

// ─── Exit plan ──────────────────────────────────────────────────────────────────

/** exitPlan — entry/exit defaults for a candidate (D-01b; fixed defaults this phase). */
export const exitPlan = z.object({
  /** Profit target as a fraction of debit (e.g. 0.25 = +25%). */
  profitTargetPct: z.number(),
  /** Stop-loss as a fraction of debit (e.g. 0.175 = -17.5%). */
  stopPct: z.number(),
  /** Manage the short (front) leg at this many DTE remaining. */
  manageShortDte: z.number().int(),
  /** Hard close-by date (ISO 8601 date) — the front leg's expiration. */
  closeByExpiry: z.string(),
});

export type ExitPlan = z.infer<typeof exitPlan>;

// ─── Experimental context + rule registry (rules.ts) ───────────────────────────

/**
 * candidateContextEntry — one experimental (weight-0) rule's computed value for a
 * candidate. Display-only ("calibrating") until the PICK-04 backtest promotes the rule.
 * `value` is null-honest: insufficient history → null, never a fabricated number.
 */
export const candidateContextEntry = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  note: z.string(),
});

export type CandidateContextEntry = z.infer<typeof candidateContextEntry>;

/**
 * ruleSetEntry — one rule-registry row (core's rules.ts RULE_SET_METADATA). Shipped in
 * the snapshot so the Analyzer methodology panel renders the ENGINE's table, never a
 * client-side copy with placeholder thresholds.
 */
export const ruleSetEntry = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["gate", "score", "experimental"]),
  /** Score points at 100% fraction; 0 for gates and experimental rules. */
  weight: z.number(),
  status: z.enum(["active", "experimental"]),
  rationale: z.string(),
});

export type RuleSetEntry = z.infer<typeof ruleSetEntry>;

// ─── Candidate ──────────────────────────────────────────────────────────────────

/**
 * pickerCandidate — one scored calendar candidate. Rich/display-complete (D-01): carries
 * every value the picker UI renders, so the UI is pure-render against fixture or live data.
 */
export const pickerCandidate = z.object({
  id: z.string(),
  name: z.string(),
  /** 0-100 engine-computed score; always present and finite, even in the fwdIv-guard case. */
  score: z.number().min(0).max(100),
  breakdown: z.array(breakdownEntry),
  /** Debit paid to enter (= max loss, per D-01/D-01b, when closed by front expiry). */
  debit: z.number(),
  /** Net position theta ($/day). */
  theta: z.number(),
  /** Net position vega ($/vol-pt). */
  vega: z.number(),
  /** Net position delta ($/pt). */
  delta: z.number(),
  /**
   * Forward IV between the two legs (criterion 1). Null when the term structure is
   * inverted (radicand < 0) — never NaN. `fwdIvGuard === "inverted"` implies `fwdIv === null`.
   */
  fwdIv: z.number().nullable(),
  /** Guard tag for `fwdIv`: "ok" = computed normally, "inverted" = radicand < 0 (fwdIv null). */
  fwdIvGuard: z.enum(["ok", "inverted"]),
  /** Term-structure slope between legs, annualized vol-pts/yr (criterion 2). */
  slope: z.number(),
  /** Front-IV-rich-vs-forward-path edge (criterion 1); 0 in the fwdIv-guard case. */
  fwdEdge: z.number(),
  /** +/-1 sigma expected move by front expiry. */
  expectedMove: z.number(),
  /** Scheduled economic events the front leg spans (e.g. ["NFP", "CPI"]). */
  frontEvents: z.array(z.string()),
  /** Scheduled economic events the back leg spans, excluding any already in frontEvents. */
  backEvents: z.array(z.string()),
  frontLeg: pickerCandidateLeg,
  backLeg: pickerCandidateLeg,
  /** Experimental rule values (weight 0, display-only — rules.ts registry).
   *  Defaulted so pre-registry stored snapshots still parse at the read seam. */
  context: z.array(candidateContextEntry).default([]),
  exitPlan,
});

export type PickerCandidate = z.infer<typeof pickerCandidate>;

// ─── Term structure ─────────────────────────────────────────────────────────────

/** termStructurePoint — one point on the ATM-IV term-structure curve. */
export const termStructurePoint = z.object({
  dte: z.number().int(),
  iv: z.number(),
});

export type TermStructurePoint = z.infer<typeof termStructurePoint>;

// ─── GEX context ────────────────────────────────────────────────────────────────

/**
 * pickerGexContext — the GEX snapshot the picker scores against (criterion 7).
 * flip/callWall/putWall/absGammaStrike are nullable, mirroring gex.ts's nullable-field
 * convention (null when the profile never crosses zero / no dominant wall exists).
 */
export const pickerGexContext = z.object({
  flip: z.number().nullable(),
  callWall: z.number().nullable(),
  putWall: z.number().nullable(),
  netGammaAtSpot: z.number(),
  absGammaStrike: z.number().nullable(),
  /** Near-term (≤45d) level set the gexFit rule scores against (rules.ts). Defaulted so
   *  pre-registry stored snapshots still parse at the read seam. */
  nearTerm: z
    .object({
      callWall: z.number().nullable(),
      putWall: z.number().nullable(),
      flip: z.number().nullable(),
    })
    .nullable()
    .default(null),
});

export type PickerGexContext = z.infer<typeof pickerGexContext>;

// ─── Economic events ────────────────────────────────────────────────────────────

/** pickerEvent — one scheduled economic-calendar event (FOMC/CPI/NFP). */
export const pickerEvent = z.object({
  /** ISO 8601 date. */
  date: z.string(),
  name: z.string(),
});

export type PickerEvent = z.infer<typeof pickerEvent>;

// ─── Snapshot response ──────────────────────────────────────────────────────────

/**
 * pickerSnapshotResponse — the HTTP GET /api/picker/candidates + get_picker_candidates
 * MCP tool response shape (MCP-02). Both the Phase-18 frozen fixture and the Phase-19 live
 * response must satisfy this schema with zero shape change.
 *
 * `asOf` completes the Phase-19 import-only-swap contract: the termStructure points and
 * per-leg DTE fields are all relative to this reference date, while `events` carry absolute
 * ISO dates. Without it a live snapshot taken on any date other than the frozen fixture's
 * would mis-place event markers on the DTE axis. It strengthens the promise (the shape now
 * carries everything the UI needs to render any snapshot), it does not break it.
 *
 * `observedAt` (WR-03, additive) carries the real full-ISO instant the cohort was observed at
 * — distinct from `asOf`'s date-only reference date. The UI's staleness dot / "as of HH:MM"
 * label needs a real instant to compute age against; a date-only `asOf` made the dot always
 * amber and the HH:MM label a constant timezone-offset artifact. Stamped from the same
 * `latestTime` `asOf` derives from (computePickerSnapshot.ts), so the two are always in sync.
 */
export const pickerSnapshotResponse = z.object({
  /** ISO 8601 snapshot reference date the termStructure/leg DTE fields are relative to. */
  asOf: z.string(),
  /** Full ISO 8601 instant the cohort was observed at (WR-03) — drives the UI freshness dot. */
  observedAt: z.string().datetime(),
  spot: z.number(),
  /** Chain vendor this snapshot was computed from (D-15). */
  source: z.enum(["schwab", "cboe"]),
  /** Freshness of the GEX context used to score candidates (D-17); never silent. */
  gexContextStatus: z.enum(["ok", "stale", "missing"]),
  /** Freshness of the economic-events context used to score candidates (D-17); never silent. */
  eventsContextStatus: z.enum(["ok", "stale", "missing"]),
  termStructure: z.array(termStructurePoint),
  gex: pickerGexContext,
  events: z.array(pickerEvent),
  candidates: z.array(pickerCandidate),
  /** The rule registry this snapshot was scored with — the UI methodology source of truth.
   *  Defaulted so pre-registry stored snapshots still parse at the read seam. */
  ruleSet: z.array(ruleSetEntry).default([]),
  /** Per-gate drop counts for this compute (no silent caps). Defaulted for old rows. */
  gateDrops: z
    .object({
      liquidity: z.number().int(),
      netTheta: z.number().int(),
    })
    .default({ liquidity: 0, netTheta: 0 }),
});

export type PickerSnapshotResponse = z.infer<typeof pickerSnapshotResponse>;
