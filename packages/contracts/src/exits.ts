import { z } from "zod";

// Exits contracts (Phase 26, Plan 01 — EXIT-01/EXIT-04/EXIT-06; MCP-02: ONE schema source for
// the future GET /api/exits response + get_exit_advice MCP tool). No confidence/probability
// field anywhere in this schema (EXIT-04) — every verdict carries a rule id and a raw metric,
// never a fabricated percentage ("no fabricated precision at n=13").

/** exitMetric — the raw metric behind a verdict (e.g. { name: "pnlPct", value: -0.261, threshold: -0.25 }). */
export const exitMetric = z.object({
  name: z.string(),
  // CR-01 defense-in-depth: `.finite()` rejects ±Infinity/NaN at the write boundary so a
  // non-finite value can never round-trip through JSONB as `null` and poison every later read.
  value: z.number().finite(),
  threshold: z.number().finite(),
});

export type ExitMetric = z.infer<typeof exitMetric>;

/** exitVerdictEnum — closed enum, the seven-rung ladder collapses to five verdict labels
 *  (TAKE/STOP carry their rung in the `rung` field, not a separate enum value per rung). */
export const exitVerdictEnum = z.enum(["HOLD", "TAKE", "STOP", "ROLL", "EXIT_PRE_EVENT"]);

export type ExitVerdictEnum = z.infer<typeof exitVerdictEnum>;

/** exitRollDetail — present only when verdict === "ROLL": the suggested replacement front.
 * `estNewFrontCredit` is the haircut SELL estimate of the replacement front alone (a credit),
 * NOT the net roll cost — it omits the buy-back of the current short front (WR-03). */
export const exitRollDetail = z.object({
  suggestedFrontExpiry: z.string(),
  estNewFrontCredit: z.number(),
});

export type ExitRollDetail = z.infer<typeof exitRollDetail>;

/**
 * exitVerdict — the persisted `exit_verdicts.verdict` JSONB blob shape (Phase 26, Plan 03).
 * Mirrors `packages/core/src/exits/domain/types.ts` `ExitVerdict` field-for-field, PLUS
 * `changed` — the write-time change-detection flag computeExitAdvice.ts attaches before
 * persisting (EXIT-09 gap closure, 26-VERIFICATION.md: was computed but discarded, never
 * persisted). Distinct from `heldPositionVerdict` below: that is the API response ROW (adds
 * calendarId/name/pnlPct/basis, all computed at read time by the 26-04 use-case) — this is
 * what the evaluator produces plus that one write-time addition, written to storage one row
 * per (observedAt, calendarId). `changed` defaults to `false` so a row persisted before this
 * fix still parses (no migration needed — additive JSONB field). Validated on BOTH write and
 * read at the repo boundary (26-03).
 */
export const exitVerdict = z.object({
  verdict: exitVerdictEnum,
  rung: z.string().nullable(),
  // EXIT-04: every verdict MUST name the firing rule — an empty ruleId is a fabricated,
  // unattributable verdict and is rejected at the write boundary.
  ruleId: z.string().min(1),
  metric: exitMetric,
  indicative: z.boolean(),
  escalate: z.boolean(),
  roll: exitRollDetail.nullable(),
  /** True when this verdict differs from the previous cycle's — set at WRITE time by
   * computeExitAdvice.ts's hasChanged(), read straight through by getExitAdvice.ts. */
  changed: z.boolean().default(false),
});

export type ExitVerdictBlob = z.infer<typeof exitVerdict>;

/**
 * heldPositionVerdict — one open calendar's verdict for this cycle. `metric` is always
 * required (EXIT-04: never a bare verdict). `changed` + `escalate` drive the UI's alert
 * styling (EXIT-09) — only verdict CHANGES surface as alerts, STOP/EXIT_PRE_EVENT escalate
 * distinctly. `indicative` forces a non-actionable display treatment on AH/stale marks.
 */
export const heldPositionVerdict = z.object({
  calendarId: z.string(),
  name: z.string(),
  verdict: exitVerdictEnum,
  /** Named rung (e.g. "+10%", "-25%"), null for rules with no rung (EVT, ROLL, HOLD). */
  rung: z.string().nullable(),
  ruleId: z.string(),
  metric: exitMetric,
  /** True on AH/stale/gap marks — never render as an actionable STOP/TAKE badge. */
  indicative: z.boolean(),
  /** True when this verdict differs from the previous cycle's (EXIT-09 alert trigger). */
  changed: z.boolean(),
  /** True for STOP/EXIT_PRE_EVENT — escalated visual treatment in the UI. */
  escalate: z.boolean(),
  /** Null when the P&L basis is non-finite (openNetDebit <= 0, CR-01) — the read side never
   * emits ±Infinity; the UI renders "—" for a null. `basis` still carries the raw components. */
  pnlPct: z.number().finite().nullable(),
  basis: z.object({
    openNetDebit: z.number(),
    netMark: z.number(),
  }),
  roll: exitRollDetail.nullable(),
});

export type HeldPositionVerdict = z.infer<typeof heldPositionVerdict>;

/**
 * exitRuleSetEntry — one rule-registry row (core's exit-rules.ts registry). Shipped in the
 * response so the Analyzer's "Exit rules" panel renders the ENGINE's table (EXIT-07,
 * entry-methodology symmetry with picker's ruleSetEntry) — never a client-side copy.
 */
export const exitRuleSetEntry = z.object({
  id: z.string(),
  kind: z.enum(["trigger", "profit-take", "roll", "hold"]),
  rationale: z.string(),
});

export type ExitRuleSetEntry = z.infer<typeof exitRuleSetEntry>;

/**
 * exitsResponse — the HTTP GET /api/exits + get_exit_advice MCP tool response shape (MCP-02).
 * `asOf`/`observedAt` mirror pickerSnapshotResponse's convention: `asOf` is the reference date,
 * `observedAt` is the full ISO instant the cohort was observed at (drives the UI freshness dot).
 */
export const exitsResponse = z.object({
  asOf: z.string(),
  observedAt: z.string().datetime(),
  marketSession: z.enum(["rth", "after-hours"]),
  positions: z.array(heldPositionVerdict),
  ruleSet: z.array(exitRuleSetEntry),
});

export type ExitsResponse = z.infer<typeof exitsResponse>;
