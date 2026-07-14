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
  criterion: z.enum(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm", "deltaNeutral", "thetaVega", "vrp", "debitFit"]),
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
  /** Hard close-by date (ISO 8601 date) — front expiry, or the day before a front-window tier-1 event (EVT). */
  closeByExpiry: z.string(),
  /** Fraction of total decay runway captured by the hard-close date (2026-07-09); defaulted for old rows. */
  thetaCapturePct: z.number().nullable().default(null),
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
  /** Net position gamma (Δ change per point, ×100 multiplier). Nullable+defaulted so
   *  pre-gamma stored snapshots still parse at the read seam (additive, Analyzer table). */
  gamma: z.number().nullable().default(null),
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
  /** Which universe this candidate came from (28-05, PLAY-04): the primary band-scan
   *  universe or the short-gap event-owning universe, rendered in a distinct Analyzer
   *  section. Defaulted so pre-Plan-05 stored rows (all primary-universe) still parse. */
  bucket: z.enum(["standard", "event-calendar"]).default("standard"),
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

// ─── Entry gate (28-03, PLAY-01/PLAY-02) ────────────────────────────────────────

/**
 * pickerGateBrakes — the two anti-criteria brakes (28-02) surfaced on the gate. `cooldownUntil`
 * is the ISO date the loss-cooldown lifts (null when the brake is not tripped).
 */
export const pickerGateBrakes = z.object({
  maxOpen: z.boolean(),
  cooldown: z.boolean(),
  cooldownUntil: z.string().nullable(),
});

export type PickerGateBrakes = z.infer<typeof pickerGateBrakes>;

/**
 * pickerGate — the market-level entry gate (28-01) plus anti-criteria brakes (28-02), computed
 * ONCE per cohort in computePickerSnapshot.ts (never per-candidate — the retired-gate scar,
 * T-28-10). `.default()` so a snapshot stored before Phase 28 still parses: it reads as an open
 * gate with no brakes tripped, which is harmless for a HISTORICAL row (nothing re-gates on read).
 *
 * `reasons` (additive) carries the per-metric hysteresis tags (e.g. "vixBlocked",
 * "ratioPenalty") resolveEntryGate produced this cycle. The Postgres picker-snapshot repo
 * round-trips every persisted snapshot through THIS schema on both write and read (parse-don't-
 * cast at the storage seam) — so the self-read hysteresis in computePickerSnapshot.ts needs
 * `reasons` on the wire to survive a restart, or the arm/disarm state resets every cycle.
 */
export const pickerGate = z.object({
  vix: z.number().nullable(),
  vix3m: z.number().nullable(),
  ratio: z.number().nullable(),
  asOf: z.string().nullable(),
  state: z.enum(["open", "penalty", "blocked", "blind"]),
  penaltyMultiplier: z.number(),
  brakes: pickerGateBrakes,
  reasons: z.array(z.string()).default([]),
});

export type PickerGate = z.infer<typeof pickerGate>;

const DEFAULT_PICKER_GATE: PickerGate = {
  vix: null,
  vix3m: null,
  ratio: null,
  asOf: null,
  state: "open",
  penaltyMultiplier: 1,
  brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
  reasons: [],
};

// ─── Sizing (28-04, PLAY-03) ─────────────────────────────────────────────────────

/**
 * pickerSizing — the VIX-tiered discrete contract-count recommendation (core's sizing.ts
 * SIZING_TIERS registry), resolved ONCE per cohort from the same VIX the gate reads.
 * `.default()` so a snapshot stored before Phase 28 Plan 04 still parses: it reads as no
 * recommendation, harmless for a HISTORICAL row (nothing re-resolves on read). `tier`/
 * `contracts` are null together whenever the cohort VIX itself is null (GATE BLIND /
 * gate-read-error / cold-start) — never a guessed tier (T-28-11).
 */
export const pickerSizing = z.object({
  tier: z.enum(["low", "normal", "elevated", "crisis"]).nullable(),
  contracts: z.number().int().nullable(),
  vix: z.number().nullable(),
});

export type PickerSizing = z.infer<typeof pickerSizing>;

const DEFAULT_PICKER_SIZING: PickerSizing = { tier: null, contracts: null, vix: null };

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
  /** Marks provenance: after-hours cohorts are indicative (stale/wide quotes). Defaulted
   *  "rth" — every pre-labeling stored row came from an RTH-gated cycle. */
  marketSession: z.enum(["rth", "after-hours"]).default("rth"),
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
      /** Playbook hard gates (2026-07-08) — defaulted so older stored rows parse. */
      termInverted: z.number().int().default(0),
      eventBlackout: z.number().int().default(0),
    })
    .default({ liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 }),
  /** The market-level entry gate + anti-criteria brakes (28-03). Defaulted so pre-Phase-28
   *  stored rows parse. */
  gate: pickerGate.default(DEFAULT_PICKER_GATE),
  /** VIX-tiered discrete sizing recommendation (28-04, PLAY-03). Defaulted so pre-Plan-04
   *  stored rows parse. */
  sizing: pickerSizing.default(DEFAULT_PICKER_SIZING),
});

export type PickerSnapshotResponse = z.infer<typeof pickerSnapshotResponse>;

// ─── Ad-hoc analyze (Phase 30, D-02; MCP-02: ONE schema shared by POST /picker/analyze
// and the analyze_ad_hoc_calendar MCP tool) ──────────────────────────────────────

/**
 * analyzeAdHocCalendarRequest — a pasted (TOS-order) calendar's two legs, scored through
 * the real engine (30-04). Puts only this phase (D-03/Pitfall 5) — `putCall` is a literal,
 * not the `pickerCandidateLeg` enum. Deliberately carries NO `spot` field: the server
 * derives spot from the latest stored snapshot, never a client-supplied price
 * (T-30-06 threat mitigation). `.strict()` rejects any extra key, including `spot`.
 */
/** YYYY-MM-DD ISO calendar date (CR-01: reject malformed date strings at the Zod boundary,
 *  before they can reach `isoDayNumber`'s `assertDefined` invariant deep in the engine). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const analyzeAdHocCalendarRequest = z
  .object({
    putCall: z.literal("P"),
    strike: z.number().finite().positive(),
    frontDte: z.number().int().positive(),
    backDte: z.number().int().positive(),
    qty: z.number().int().positive(),
    frontIv: z.number().finite().positive(),
    backIv: z.number().finite().positive(),
    debit: z.number().finite(),
    /** ISO 8601 date. */
    frontExpiry: isoDate,
    /** ISO 8601 date. */
    backExpiry: isoDate,
  })
  .strict()
  .refine((v) => v.backDte > v.frontDte, {
    path: ["backDte"],
    message: "backDte must be greater than frontDte",
  });

export type AnalyzeAdHocCalendarRequest = z.infer<typeof analyzeAdHocCalendarRequest>;

/**
 * analyzeAdHocCalendarResponse — wraps the existing `pickerCandidate` schema (binding #2):
 * `scored: true` carries a full engine-scored candidate; `scored: false` degrades to
 * `candidate: null` + a human-readable `reason` (e.g. no stored snapshot yet) rather than
 * a hard error (30-CONTEXT.md "Failure posture").
 */
export const analyzeAdHocCalendarResponse = z.object({
  scored: z.boolean(),
  candidate: pickerCandidate.nullable(),
  reason: z.string().nullable(),
});

export type AnalyzeAdHocCalendarResponse = z.infer<typeof analyzeAdHocCalendarResponse>;
