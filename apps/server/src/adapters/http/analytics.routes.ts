import { Hono } from "hono";
import { termStructureResponse } from "@morai/contracts";
import type { ForRunningGetTermStructure } from "@morai/core";

/**
 * analyticsRoutes — factory returning a Hono router for the analytics read endpoints.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through the contract schema → respond.
 *
 * 06-04 adds GET /analytics/term-structure; the skew route is added in 06-05.
 *
 * Threat mitigations:
 *   T-06-08: errors mapped to flat {error:"internal"} — no stack/DB message returned.
 *   T-06-09: optional ?calendarId is parsed at the boundary; an unknown id simply matches no
 *            rows → contract-valid EMPTY array (not an error).
 *
 * MCP-02: termStructureResponse is the single schema source shared by this route and the
 *   get_term_structure MCP tool. A one-sided field change fails `bun run typecheck`.
 */
export function analyticsRoutes(getTermStructure: ForRunningGetTermStructure) {
  const router = new Hono();

  router.get("/analytics/term-structure", async (c) => {
    // T-06-09: optional calendarId filter — undefined when absent (never throws on bad input).
    const calendarIdParam = c.req.query("calendarId");
    const query =
      calendarIdParam === undefined ? {} : { calendarId: calendarIdParam };

    const result = await getTermStructure(query);
    if (!result.ok) {
      // T-06-08: flat error body — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty array (not an error) when no data (SPEC R5). Serialise Date → ISO before parse.
    return c.json(
      termStructureResponse.parse(
        result.value.map((row) => ({
          time:
            row.snapshotTime instanceof Date
              ? row.snapshotTime.toISOString()
              : row.snapshotTime,
          calendarId: row.calendarId,
          value: row.value,
        })),
      ),
    );
  });

  return router;
}
