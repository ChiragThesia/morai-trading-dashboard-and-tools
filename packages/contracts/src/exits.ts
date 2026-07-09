import { z } from "zod";

// Exits contracts (Phase 26, Plan 01 — EXIT-01/EXIT-04/EXIT-06; MCP-02: ONE schema source for
// the future GET /api/exits response + get_exit_advice MCP tool). No confidence/probability
// field anywhere in this schema (EXIT-04) — every verdict carries a rule id and a raw metric,
// never a fabricated percentage ("no fabricated precision at n=13").

/** exitMetric — the raw metric behind a verdict (e.g. { name: "pnlPct", value: -0.261, threshold: -0.25 }). */
export const exitMetric = z.object({
  name: z.string(),
  value: z.number(),
  threshold: z.number(),
});

export type ExitMetric = z.infer<typeof exitMetric>;

/** exitVerdictEnum — closed enum, the seven-rung ladder collapses to five verdict labels
 *  (TAKE/STOP carry their rung in the `rung` field, not a separate enum value per rung). */
export const exitVerdictEnum = z.enum(["HOLD", "TAKE", "STOP", "ROLL", "EXIT_PRE_EVENT"]);

export type ExitVerdictEnum = z.infer<typeof exitVerdictEnum>;

/** exitRollDetail — present only when verdict === "ROLL": the suggested replacement front. */
export const exitRollDetail = z.object({
  suggestedFrontExpiry: z.string(),
  estDebit: z.number(),
});

export type ExitRollDetail = z.infer<typeof exitRollDetail>;

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
  pnlPct: z.number(),
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
