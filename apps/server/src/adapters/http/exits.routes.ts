import { Hono } from "hono";
import { exitsResponse } from "@morai/contracts";
import type { ForRunningGetExitAdvice } from "@morai/core";

/**
 * exitRoutes — factory returning a Hono router for GET /exits.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * EXIT-08: returns the getExitAdvice use-case's read-time snapshot (never recomputed
 * per-request — mirrors PICK-02/D-04's stored-row precedent).
 *
 * Threat mitigations (26-05, T-26-13/T-26-15):
 *   T-26-13: errors mapped to flat {error:"internal"} — no DB internals.
 *   T-26-15: mounted inside the existing authenticated apiRouter — no new auth code.
 *
 * MCP-02: exitsResponse is the single schema source shared by this route and the
 *   get_exit_advice MCP tool. A one-sided field change fails `bun run typecheck`.
 *
 * Domain→contract mapping: getExitAdvice's ExitAdviceSnapshot nests each position's evaluator
 * output under `verdict: ExitVerdict` (rung/ruleId/metric/indicative/escalate/roll); the
 * contract's heldPositionVerdict flattens those as top-level siblings (26-04-SUMMARY.md "Next
 * Phase Readiness" — flattening happens here, at the mapping boundary, not upstream).
 *
 * Mount: in main.ts inside the authenticated apiRouter (same Bearer-token group as
 *   /api/picker/candidates), so the effective path is GET /api/exits.
 */
export function exitRoutes(getExitAdvice: ForRunningGetExitAdvice) {
  const router = new Hono();

  router.get("/exits", async (c) => {
    const result = await getExitAdvice();

    if (!result.ok) {
      // T-26-13: flat error — never expose DB internals (storage-error message hidden).
      return c.json({ error: "internal" }, 500);
    }

    if (result.value === null) {
      // Cold start: zero verdict rows anywhere yet — clean no-data response (mirrors
      // pickerRoutes' D-04/D-18 404 convention, never a 500).
      return c.json({ error: "no-verdicts" }, 404);
    }

    const snapshot = result.value;
    return c.json(
      exitsResponse.parse({
        asOf: snapshot.asOf,
        observedAt: snapshot.observedAt.toISOString(),
        marketSession: snapshot.marketSession,
        positions: snapshot.positions.map((p) => ({
          calendarId: p.calendarId,
          name: p.name,
          strike: p.strike,
          optionType: p.optionType,
          verdict: p.verdict.verdict,
          rung: p.verdict.rung,
          ruleId: p.verdict.ruleId,
          metric: p.verdict.metric,
          indicative: p.verdict.indicative,
          changed: p.changed,
          escalate: p.verdict.escalate,
          pnlPct: p.pnlPct,
          basis: p.basis,
          roll: p.verdict.roll,
        })),
        ruleSet: snapshot.ruleSet,
      }),
    );
  });

  return router;
}
