/**
 * rule-overrides-bridge.ts — the JSON-round-trip bridge from a zod-validated
 * SetRuleOverridesRequest body to core's RuleOverridesPatch (WR-01, 29-REVIEW.md).
 *
 * The zod-inferred request body (packages/contracts' RuleOverrides — a mapped type) does not
 * structurally satisfy RuleOverridesPatch's plain index signature (mapped types don't get TS's
 * implicit-index-signature leniency that a hand-written type gets). A JSON round-trip drops the
 * zod-inferred `| undefined` from optional fields so the clone structurally satisfies the index
 * signature — same idiom as the postgres/memory rule-overrides repos' own toJsonSafe (no `as`,
 * no `any`).
 *
 * Both the HTTP PUT /api/settings/rules route and the MCP set_rule_overrides tool must bridge
 * through this single function (same precedent as status-dto.ts's toStatusResponse) — a
 * duplicated copy silently drifts when this idiom is hardened later (e.g. against a
 * JSON-unsafe value like Infinity/NaN, which JSON.stringify turns into null).
 */
import type { SetRuleOverridesRequest } from "@morai/contracts";
import type { RuleOverridesPatch } from "@morai/core";

function isRuleOverridesPatch(value: unknown): value is RuleOverridesPatch {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toOverridesPatch(body: SetRuleOverridesRequest): RuleOverridesPatch {
  const cloned: unknown = JSON.parse(JSON.stringify(body));
  return isRuleOverridesPatch(cloned) ? cloned : {};
}
