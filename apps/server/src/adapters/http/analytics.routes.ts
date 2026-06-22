import { Hono } from "hono";
import { termStructureResponse, skewResponse } from "@morai/contracts";
import type { ForRunningGetTermStructure, ForRunningGetSkew } from "@morai/core";

/**
 * analyticsRoutes — factory returning a Hono router for the analytics read endpoints.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through the contract schema → respond.
 *
 * 06-04 adds GET /analytics/term-structure; 06-05 adds GET /analytics/skew.
 *
 * Threat mitigations:
 *   T-06-08/T-06-13: errors mapped to flat {error:"internal"} — no stack/DB message returned.
 *   T-06-09/T-06-14: optional ?calendarId/?underlying/?expiration are parsed at the boundary; an
 *            unknown value simply matches no rows → contract-valid EMPTY array (not an error).
 *
 * MCP-02: termStructureResponse + skewResponse are the single schema sources shared by these routes
 *   and the get_term_structure / get_skew MCP tools. A one-sided field change fails typecheck.
 */
export function analyticsRoutes(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
) {
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

  // SPEC R5: the skew read surface returns the HEADLINE 25Δ risk-reversal series
  // (value = risk_reversal, with rr_rank + underlying/expiration), NOT the smile detail.
  router.get("/analytics/skew", async (c) => {
    const underlyingParam = c.req.query("underlying");
    const expirationParam = c.req.query("expiration");
    const query = {
      ...(underlyingParam === undefined ? {} : { underlying: underlyingParam }),
      ...(expirationParam === undefined ? {} : { expiration: expirationParam }),
    };

    const result = await getSkew(query);
    if (!result.ok) {
      // T-06-13: flat error body — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty array (not an error) when no data (SPEC R5). Serialise Date → ISO before parse.
    return c.json(
      skewResponse.parse(
        result.value.map((row) => ({
          time:
            row.snapshotTime instanceof Date
              ? row.snapshotTime.toISOString()
              : row.snapshotTime,
          underlying: row.underlying,
          expiration: row.expiration,
          value: row.riskReversal,
          rrRank: row.rrRank,
        })),
      ),
    );
  });

  return router;
}
