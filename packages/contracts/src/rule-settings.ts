import { z } from "zod";

// Runtime rule-override contracts (Phase 29, 29-CONTEXT.md "Knob scope").
//
// ruleOverrides is the ONE Zod validation seam the settings PUT route (29-13), the storage
// repo (29-08), and the settings use-cases (29-09) all parse through. It expresses ONLY the
// curated ~20 knobs (docs/architecture/rule-overrides.md) — every other constant
// (normalizers, event penalties, gexFit credits, gate hysteresis internals, loss cooldown,
// roll windows, staleness tolerance) has no field here and is rejected by `.strict()` at
// every nesting level (T-29-04).
//
// Two data-integrity invariants are enforced by `.refine()` at the parse boundary, not by
// the caller:
//   - picker.weights is all-9-or-none and must sum to EXACTLY 100 (hard validation, not
//     server-side normalization — matches rules.test.ts's existing "weights sum to exactly
//     100" invariant and keeps the stored blob honest, per 29-02-PLAN.md's Claude's-
//     Discretion decision). A partial weight set has no defined sum, so Zod's own required-
//     field check on the (non-optional) pickerWeights object already rejects <9 keys.
//   - exits.take/exits.stop rungs are edited as validated arm/disarm PAIRS (T-29-03): a
//     single-sided edit is rejected, and disarm must sit closer to zero than arm (TAKE:
//     disarm < arm; STOP: disarm > arm, since STOP values are negative).
//
// Every field is optional (partial deltas — store only what differs from the code default).
// Each top-level group is `.nullable()` so `{ picker: null }` is the reset-per-group
// sentinel (docs/architecture/rule-overrides.md "Reset-per-group semantics").

// ─────────────────────────────────────────────────────────────
// picker group
// ─────────────────────────────────────────────────────────────

/** The 9 named scoring criteria (BreakdownCriterion, picker/domain/types.ts) — all-9-or-none. */
const pickerWeightsShape = z
  .object({
    slope: z.number(),
    fwdEdge: z.number(),
    gexFit: z.number(),
    eventAdjustment: z.number(),
    beVsEm: z.number(),
    deltaNeutral: z.number(),
    thetaVega: z.number(),
    vrp: z.number(),
    debitFit: z.number(),
  })
  .strict();

const WEIGHT_SUM_TARGET = 100;

function weightsSum(weights: z.infer<typeof pickerWeightsShape>): number {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}

/** vixLadder tier-boundary overrides: 15/20/25 (low always starts at 0 — not editable). */
const vixLadderShape = z
  .object({
    normalMin: z.number(),
    elevatedMin: z.number(),
    crisisMin: z.number(),
  })
  .strict()
  .refine((v) => v.normalMin < v.elevatedMin && v.elevatedMin < v.crisisMin, {
    path: ["crisisMin"],
    message: "vixLadder boundaries must be strictly ascending (normalMin < elevatedMin < crisisMin)",
  });

/** Sizing tier contract counts, keyed by the same VixTier the VIX ladder resolves to. */
const sizingContractsShape = z
  .object({
    low: z.number(),
    normal: z.number(),
    elevated: z.number(),
    crisis: z.number(),
  })
  .strict();

const pickerOverrides = z
  .object({
    deltaBandMin: z.number().optional(),
    deltaBandMax: z.number().optional(),
    frontDteMin: z.number().optional(),
    frontDteMax: z.number().optional(),
    backDteMinGap: z.number().optional(),
    backDteMaxGap: z.number().optional(),
    weights: pickerWeightsShape.optional(),
    debitIdealMin: z.number().optional(),
    debitIdealMax: z.number().optional(),
    vixLadder: vixLadderShape.optional(),
    maxOpenCalendars: z.number().optional(),
    sizingContracts: sizingContractsShape.optional(),
  })
  .strict()
  .refine((group) => group.weights === undefined || weightsSum(group.weights) === WEIGHT_SUM_TARGET, {
    path: ["weights"],
    message: `weights must sum to exactly ${WEIGHT_SUM_TARGET}`,
  });

// ─────────────────────────────────────────────────────────────
// exits group — TAKE/STOP arm/disarm rung pairs
// ─────────────────────────────────────────────────────────────

/** A rung pair is complete-or-absent; when present, disarm must sit closer to zero than arm. */
function validRungPair(arm: number | undefined, disarm: number | undefined, direction: "take" | "stop"): boolean {
  if (arm === undefined && disarm === undefined) return true;
  if (arm === undefined || disarm === undefined) return false;
  return direction === "take" ? disarm < arm : disarm > arm;
}

const takeOverrides = z
  .object({
    plus15Arm: z.number().optional(),
    plus15Disarm: z.number().optional(),
    plus10Arm: z.number().optional(),
    plus10Disarm: z.number().optional(),
    plus5Arm: z.number().optional(),
    plus5Disarm: z.number().optional(),
  })
  .strict()
  .refine((rungs) => validRungPair(rungs.plus15Arm, rungs.plus15Disarm, "take"), {
    path: ["plus15Disarm"],
    message: "plus15 rung must be a complete pair with disarm < arm",
  })
  .refine((rungs) => validRungPair(rungs.plus10Arm, rungs.plus10Disarm, "take"), {
    path: ["plus10Disarm"],
    message: "plus10 rung must be a complete pair with disarm < arm",
  })
  .refine((rungs) => validRungPair(rungs.plus5Arm, rungs.plus5Disarm, "take"), {
    path: ["plus5Disarm"],
    message: "plus5 rung must be a complete pair with disarm < arm",
  });

const stopOverrides = z
  .object({
    minus50Arm: z.number().optional(),
    minus50Disarm: z.number().optional(),
    minus25Arm: z.number().optional(),
    minus25Disarm: z.number().optional(),
  })
  .strict()
  .refine((rungs) => validRungPair(rungs.minus50Arm, rungs.minus50Disarm, "stop"), {
    path: ["minus50Disarm"],
    message: "minus50 rung must be a complete pair with disarm > arm",
  })
  .refine((rungs) => validRungPair(rungs.minus25Arm, rungs.minus25Disarm, "stop"), {
    path: ["minus25Disarm"],
    message: "minus25 rung must be a complete pair with disarm > arm",
  });

const exitsOverrides = z
  .object({
    take: takeOverrides.optional(),
    stop: stopOverrides.optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────
// regime group
// ─────────────────────────────────────────────────────────────

/** A warn/crisis pair only needs ordering-checked when BOTH sides of THIS request supply it —
 * a single-sided partial can't be validated against the stored/default counterpart at the
 * contract layer (29-REVIEW.md CR-02 fix note). */
function validWarnCrisisPair(warn: number | undefined, crisis: number | undefined): boolean {
  return warn === undefined || crisis === undefined || warn < crisis;
}

const regimeOverrides = z
  .object({
    vixTermStructureWarn: z.number().optional(),
    vixTermStructureCrisis: z.number().optional(),
    vvixWarn: z.number().optional(),
    vvixCrisis: z.number().optional(),
    vix9dRatioWarn: z.number().optional(),
    vix9dRatioCrisis: z.number().optional(),
    hyOasWarn: z.number().optional(),
    hyOasCrisis: z.number().optional(),
  })
  .strict()
  .refine((r) => validWarnCrisisPair(r.vixTermStructureWarn, r.vixTermStructureCrisis), {
    path: ["vixTermStructureCrisis"],
    message: "vixTermStructure warn must be < crisis",
  })
  .refine((r) => validWarnCrisisPair(r.vvixWarn, r.vvixCrisis), {
    path: ["vvixCrisis"],
    message: "vvix warn must be < crisis",
  })
  .refine((r) => validWarnCrisisPair(r.vix9dRatioWarn, r.vix9dRatioCrisis), {
    path: ["vix9dRatioCrisis"],
    message: "vix9dRatio warn must be < crisis",
  })
  .refine((r) => validWarnCrisisPair(r.hyOasWarn, r.hyOasCrisis), {
    path: ["hyOasCrisis"],
    message: "hyOas warn must be < crisis",
  });

// ─────────────────────────────────────────────────────────────
// ruleOverrides — the top-level partial, per-group-nullable override object
// ─────────────────────────────────────────────────────────────

export const ruleOverrides = z
  .object({
    picker: pickerOverrides.nullable().optional(),
    exits: exitsOverrides.nullable().optional(),
    regime: regimeOverrides.nullable().optional(),
  })
  .strict();

export type RuleOverrides = z.infer<typeof ruleOverrides>;

// ─────────────────────────────────────────────────────────────
// ruleConfig — the full resolved knob shape (every field required), used for
// getRuleSettingsResponse's `defaults`/`effective` and setRuleOverridesResponse's `effective`.
// ─────────────────────────────────────────────────────────────

const pickerConfig = z
  .object({
    deltaBandMin: z.number(),
    deltaBandMax: z.number(),
    frontDteMin: z.number(),
    frontDteMax: z.number(),
    backDteMinGap: z.number(),
    backDteMaxGap: z.number(),
    weights: pickerWeightsShape,
    debitIdealMin: z.number(),
    debitIdealMax: z.number(),
    vixLadder: vixLadderShape,
    maxOpenCalendars: z.number(),
    sizingContracts: sizingContractsShape,
  })
  .strict();

const exitsConfig = z
  .object({
    take: z
      .object({
        plus15Arm: z.number(),
        plus15Disarm: z.number(),
        plus10Arm: z.number(),
        plus10Disarm: z.number(),
        plus5Arm: z.number(),
        plus5Disarm: z.number(),
      })
      .strict(),
    stop: z
      .object({
        minus50Arm: z.number(),
        minus50Disarm: z.number(),
        minus25Arm: z.number(),
        minus25Disarm: z.number(),
      })
      .strict(),
  })
  .strict();

const regimeConfig = z
  .object({
    vixTermStructureWarn: z.number(),
    vixTermStructureCrisis: z.number(),
    vvixWarn: z.number(),
    vvixCrisis: z.number(),
    vix9dRatioWarn: z.number(),
    vix9dRatioCrisis: z.number(),
    hyOasWarn: z.number(),
    hyOasCrisis: z.number(),
  })
  .strict();

export const ruleConfig = z
  .object({
    picker: pickerConfig,
    exits: exitsConfig,
    regime: regimeConfig,
  })
  .strict();

export type RuleConfig = z.infer<typeof ruleConfig>;

// ─────────────────────────────────────────────────────────────
// GET/PUT wire contracts
// ─────────────────────────────────────────────────────────────

/** getRuleSettingsResponse — GET /api/settings/rules. */
export const getRuleSettingsResponse = z
  .object({
    defaults: ruleConfig,
    overrides: ruleOverrides,
    effective: ruleConfig,
  })
  .strict();

export type GetRuleSettingsResponse = z.infer<typeof getRuleSettingsResponse>;

/** setRuleOverridesRequest — PUT /api/settings/rules body (partial deltas). */
export const setRuleOverridesRequest = ruleOverrides;

export type SetRuleOverridesRequest = z.infer<typeof setRuleOverridesRequest>;

/** setRuleOverridesResponse — the saved overrides + newly-resolved effective config. */
export const setRuleOverridesResponse = z
  .object({
    overrides: ruleOverrides,
    effective: ruleConfig,
  })
  .strict();

export type SetRuleOverridesResponse = z.infer<typeof setRuleOverridesResponse>;
