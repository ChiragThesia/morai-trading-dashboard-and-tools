import { Hono } from "hono";
import { journalResponse } from "@morai/contracts";
import type { ForReadingJournal } from "@morai/core";

/**
 * journalRoutes — factory returning a Hono router for the journal read endpoint.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   call use-case → map Result → parse through contract schema → respond.
 *
 * Threat mitigations:
 *   T-03-14: unknown calendarId → 404 (not 403 — single-user v1)
 *   T-03-15: Drizzle parameterized query in the repo; a non-UUID id matches no row → 404
 *   T-03-16: errors mapped to flat {error:"internal"} — no stack/DB message returned
 *
 * MCP-02: journalResponse is the single schema source shared by this route and
 *         the get_journal MCP tool (plan 07).
 */
export function journalRoutes(getJournal: ForReadingJournal) {
  const router = new Hono();

  router.get("/journal/:calendarId", async (c) => {
    const calendarId = c.req.param("calendarId");
    const result = await getJournal(calendarId);

    if (!result.ok) {
      // T-03-16: flat error body — never expose DB internals
      return c.json({ error: "internal" }, 500);
    }

    if (result.value === null) {
      // Unknown calendarId — drives 404 (T-03-14)
      return c.json({ error: "not found" }, 404);
    }

    // Parse through contract schema (MCP-02: same schema used by get_journal MCP tool)
    return c.json(
      journalResponse.parse({ snapshots: result.value.map((row) => ({
        ...row,
        time: row.time instanceof Date ? row.time.toISOString() : row.time,
      })) }),
    );
  });

  return router;
}
