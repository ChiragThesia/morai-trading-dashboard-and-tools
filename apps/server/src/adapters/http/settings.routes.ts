import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  getRuleSettingsResponse,
  setRuleOverridesRequest,
  setRuleOverridesResponse,
  previewRuleOverridesRequest,
  previewRuleOverridesResponse,
} from "@morai/contracts";
import type {
  ForRunningGetRuleSettings,
  ForRunningSetRuleOverrides,
  ForRunningPreviewRuleOverrides,
} from "@morai/core";
import { toOverridesPatch, toPreviewInput } from "../rule-overrides-bridge.ts";

/**
 * settingsRoutes — factory returning a Hono router for the GET/PUT /api/settings/rules
 * surface (Phase 29-13, RUNTIME-*). Mirrors journal-rules.routes.ts's shape exactly.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through contract schema → respond.
 *
 * This is the primary trust boundary of Phase 29 — PUT mutates live trading rule
 * thresholds. Threat mitigations (29-13-PLAN.md threat register):
 *   T-29-17: mounted inside authReadGroup by main.ts (JWT-gated) — no unauthenticated write.
 *   T-29-02 / T-29-03 / T-29-04: setRuleOverridesRequest (29-02's ruleOverrides contract)
 *     rejects a non-100 weight sum, a single-sided hysteresis pair, and any unknown key
 *     (`.strict()` at every nesting level) BEFORE this route body ever runs — zValidator
 *     responds 400 automatically on a failed parse.
 *
 * MCP-02: getRuleSettingsResponse / setRuleOverridesRequest / setRuleOverridesResponse are
 * reused verbatim by the get_rule_settings / set_rule_overrides MCP tools (29-13 Task 2).
 */
export function settingsRoutes(
  getRuleSettings: ForRunningGetRuleSettings,
  setRuleOverrides: ForRunningSetRuleOverrides,
  previewRuleOverrides: ForRunningPreviewRuleOverrides,
) {
  const router = new Hono();

  // GET /api/settings/rules — { defaults, overrides, effective }
  router.get("/settings/rules", async (c) => {
    const result = await getRuleSettings();
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(getRuleSettingsResponse.parse(result.value));
  });

  // PUT /api/settings/rules — partial override patch; a group set to null resets it (T-29-10).
  router.put("/settings/rules", zValidator("json", setRuleOverridesRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await setRuleOverrides(toOverridesPatch(body));
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(setRuleOverridesResponse.parse(result.value));
  });

  // POST /api/settings/rules/preview — staged-change dry-run (B4/B7): re-scores the latest
  // stored picker snapshot / re-evaluates every open exit verdict against the staged overrides,
  // NEVER persists. Mounted in the SAME authenticated group as GET/PUT above (no new
  // unauthenticated surface, T-32-03).
  router.post("/settings/rules/preview", zValidator("json", previewRuleOverridesRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await previewRuleOverrides(toPreviewInput(body));
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    const { asOf, picker, exits } = result.value;
    const pickerBranch =
      picker === null || !picker.available
        ? null
        : { candidates: picker.candidates, gate: picker.gate, sizing: picker.sizing, universeNote: picker.universeNote };
    return c.json(previewRuleOverridesResponse.parse({ asOf, picker: pickerBranch, exits }));
  });

  return router;
}
