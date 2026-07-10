import { z } from "zod";
import { ruleOverrides } from "./rule-settings.ts";
import { pickerCandidate, pickerGate, pickerSizing } from "./picker.ts";
import { exitVerdictEnum, exitMetric } from "./exits.ts";

// Preview request/response contracts (Phase 32, Plan 01 — B4/B5/B7). ONE schema shared by the
// staged-change preview HTTP route and its MCP twin, so picker/exit preview deltas travel
// identically over both transports (32-CONTEXT.md "one combined preview endpoint mirroring
// PUT group shape").

// ─────────────────────────────────────────────────────────────
// Request — identity reuse of ruleOverrides (T-32-05): the exact same partial, strict,
// per-group-nullable body the PUT accepts (same bounds + weight-sum-100 + hysteresis-pair
// refinements). Never a looser preview-only schema.
// ─────────────────────────────────────────────────────────────

export const previewRuleOverridesRequest = ruleOverrides;

export type PreviewRuleOverridesRequest = z.infer<typeof previewRuleOverridesRequest>;

// ─────────────────────────────────────────────────────────────
// Response
// ─────────────────────────────────────────────────────────────

/** One re-scored picker candidate: the full pickerCandidate shape plus its pre-staged score,
 *  so the client diffs oldScore -> score without a second round trip (B5). */
const previewPickerCandidate = pickerCandidate.extend({ oldScore: z.number() });

export type PreviewPickerCandidate = z.infer<typeof previewPickerCandidate>;

const previewGateDelta = z.object({ before: pickerGate, after: pickerGate }).strict();
const previewSizingDelta = z.object({ before: pickerSizing, after: pickerSizing }).strict();

const previewPickerBranch = z
  .object({
    candidates: z.array(previewPickerCandidate),
    gate: previewGateDelta.nullable(),
    sizing: previewSizingDelta.nullable(),
    /** Honest "affects next compute cycle" note — present only when staged band/DTE knobs
     *  can't be reflected in this dry-run re-score (32-CONTEXT.md "universe-honest-note"). */
    universeNote: z.string().nullable(),
  })
  .strict();

const previewExitEntry = z
  .object({
    calendarId: z.string(),
    current: z
      .object({
        verdict: exitVerdictEnum,
        rung: z.string().nullable(),
        ruleId: z.string(),
      })
      .strict(),
    staged: z
      .object({
        verdict: exitVerdictEnum,
        rung: z.string().nullable(),
        ruleId: z.string(),
        metric: exitMetric,
      })
      .strict(),
  })
  .strict();

/**
 * previewRuleOverridesResponse — the combined picker/exits staged-change preview. Regime
 * preview is NOT part of this server response (32-CONTEXT.md ORCHESTRATOR RESOLVED: computed
 * client-side from values already on screen). `.strict()` at every level (T-32-06): only
 * computed deltas + the snapshot staleness marker, no storage/DB internals modeled.
 */
export const previewRuleOverridesResponse = z
  .object({
    /** The stored snapshot's reference date this preview re-scored against; null when there's
     *  no stored snapshot yet to preview against. */
    asOf: z.string().nullable(),
    picker: previewPickerBranch.nullable(),
    exits: z.array(previewExitEntry).nullable(),
  })
  .strict();

export type PreviewRuleOverridesResponse = z.infer<typeof previewRuleOverridesResponse>;
