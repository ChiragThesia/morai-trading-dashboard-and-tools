import { Hono } from "hono";
import { lifecycleResponse } from "@morai/contracts";
import type { ForRunningGetCalendarLifecycle } from "@morai/core";

/**
 * journalLifecycleRoutes — factory returning a Hono router for the JRNL-01 enriched-series
 * read endpoint (22-03).
 *
 * Architecture law: zero business logic here. Pattern is:
 *   call use-case → map Result → parse through contract schema → respond.
 *
 * getCalendarLifecycle's own ok(null) already distinguishes "unknown calendar" from a known
 * calendar with zero snapshots (single-port ok(null)/ok([])/err(...) contract — mirrors
 * journal.routes.ts, not journal-rules.routes.ts's two-port existence pre-check, which exists
 * only because getCalendarEventsWithRules cannot itself tell those cases apart).
 *
 * Threat mitigations (T-22-05/T-22-06/T-22-07):
 *   Mounted inside authReadGroup by main.ts (JWT-gated) — no unauthenticated access to
 *   per-trade P&L. Errors mapped to flat {error:"internal"} — no stack/DB message returned.
 *   Unknown calendarId → 404 (not 403 — single-user v1 model, T-03-14 precedent).
 *
 * MCP-02: lifecycleResponse is the single schema source shared by this route and the
 *         get_journal_lifecycle MCP tool.
 */
export function journalLifecycleRoutes(getCalendarLifecycle: ForRunningGetCalendarLifecycle) {
  const router = new Hono();

  router.get("/journal/:calendarId/lifecycle", async (c) => {
    const calendarId = c.req.param("calendarId");
    const result = await getCalendarLifecycle(calendarId);

    if (!result.ok) {
      // T-22-06: flat error body — never expose DB internals
      return c.json({ error: "internal" }, 500);
    }

    if (result.value === null) {
      // Unknown calendarId — drives 404 (T-22-07)
      return c.json({ error: "not found" }, 404);
    }

    // Parse through contract schema (MCP-02: same schema used by get_journal_lifecycle MCP tool)
    return c.json(
      lifecycleResponse.parse({
        snapshots: result.value.map((row) => ({
          ...row,
          time: row.time instanceof Date ? row.time.toISOString() : row.time,
        })),
      }),
    );
  });

  return router;
}
