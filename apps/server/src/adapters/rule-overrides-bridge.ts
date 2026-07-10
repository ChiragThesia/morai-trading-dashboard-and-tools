/**
 * rule-overrides-bridge.ts — the JSON-round-trip bridge from zod-validated rule-overrides
 * request bodies to core's untyped-JSON-narrowing input shapes (WR-01, 29-REVIEW.md /
 * 32-REVIEW.md).
 *
 * The zod-inferred request body (packages/contracts' RuleOverrides — a mapped type) does not
 * structurally satisfy RuleOverridesPatch's plain index signature (mapped types don't get TS's
 * implicit-index-signature leniency that a hand-written type gets). A JSON round-trip drops the
 * zod-inferred `| undefined` from optional fields so the clone structurally satisfies the index
 * signature — same idiom as the postgres/memory rule-overrides repos' own toJsonSafe (no `as`,
 * no `any`).
 *
 * Two seams live here:
 *   - `toOverridesPatch` — the HTTP PUT /api/settings/rules route AND the MCP
 *     set_rule_overrides tool bridge through this single function (same precedent as
 *     status-dto.ts's toStatusResponse).
 *   - `toPreviewInput` (32-REVIEW.md WR-01) — the HTTP POST /api/settings/rules/preview route
 *     AND the MCP preview_rule_overrides tool bridge through this single function. Phase 32
 *     originally shipped this as two verbatim copies (one per adapter) with a "files_modified
 *     scope excludes this file" note; that scope exclusion stopped being a good reason once the
 *     pattern proved itself needed by both call sites.
 *
 * A duplicated copy of either seam silently drifts when the idiom is hardened later (e.g.
 * against a JSON-unsafe value like Infinity/NaN, which JSON.stringify turns into null) — never
 * copy-paste either function into a new adapter; import from here.
 */
import type { PreviewRuleOverridesRequest, SetRuleOverridesRequest } from "@morai/contracts";
import type { ExitRuleOverrides, PickerRuleOverrides, RuleOverridesPatch, RulePreviewInput } from "@morai/core";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleOverridesPatch(value: unknown): value is RuleOverridesPatch {
  return isPlainRecord(value);
}

export function toOverridesPatch(body: SetRuleOverridesRequest): RuleOverridesPatch {
  const cloned: unknown = JSON.parse(JSON.stringify(body));
  return isRuleOverridesPatch(cloned) ? cloned : {};
}

/** zValidator (HTTP)/safeParse (MCP) already validated the FULL body against
 *  `previewRuleOverridesRequest` before either caller reaches `toPreviewInput` — these
 *  predicates just re-affirm the JSON-round-tripped clone's runtime shape for the compiler
 *  (exactOptionalPropertyTypes), never re-validate field-by-field. */
function isPickerRuleOverridesShape(value: unknown): value is PickerRuleOverrides {
  return isPlainRecord(value);
}
function isExitRuleOverridesShape(value: unknown): value is ExitRuleOverrides {
  return isPlainRecord(value);
}

/**
 * toPreviewInput — narrows a validated `previewRuleOverridesRequest` body (each group
 * optional-and-nullable, PUT's own `ruleOverrides` shape, T-32-05) into the core combined
 * preview use-case's `RulePreviewInput` (each group optional-only). A `null` group (the PUT
 * route's reset-per-group sentinel) has no meaning for a preview — it degrades to "not staged"
 * (absent), the SAME as the key being omitted entirely, never a fabricated defaults-branch call.
 */
export function toPreviewInput(body: PreviewRuleOverridesRequest): RulePreviewInput {
  const cloned: unknown = JSON.parse(JSON.stringify(body));
  if (!isPlainRecord(cloned)) return {};
  const picker = cloned["picker"];
  const exits = cloned["exits"];
  return {
    ...(isPickerRuleOverridesShape(picker) ? { picker } : {}),
    ...(isExitRuleOverridesShape(exits) ? { exits } : {}),
  };
}
