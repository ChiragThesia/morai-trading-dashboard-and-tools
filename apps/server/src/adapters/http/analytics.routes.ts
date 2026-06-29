import { Hono } from "hono";
import { termStructureResponse, skewResponse, cotResponse } from "@morai/contracts";
import type { ForRunningGetTermStructure, ForRunningGetSkew, ForRunningGetCot } from "@morai/core";

/**
 * analyticsRoutes — factory returning a Hono router for the analytics read endpoints.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through the contract schema → respond.
 *
 * 06-04 adds GET /analytics/term-structure; 06-05 adds GET /analytics/skew.
 * 13-06 adds GET /analytics/cot (CFTC TFF weekly series — COT-02 / MCP-02).
 *
 * Threat mitigations:
 *   T-06-08/T-06-13/T-13-06-INJ: errors mapped to flat {error:"internal"} — no DB message returned.
 *   T-06-09/T-06-14: optional ?calendarId/?underlying/?expiration are parsed at the boundary; an
 *            unknown value simply matches no rows → contract-valid EMPTY array (not an error).
 *   T-13-06-INJ: GET /analytics/cot takes no user-controlled query input; output validated against
 *            cotResponse before send.
 *
 * MCP-02: termStructureResponse + skewResponse + cotResponse are the single schema sources shared
 *   by these routes and the corresponding MCP tools. A one-sided field change fails typecheck.
 */
export function analyticsRoutes(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
  getCot: ForRunningGetCot,
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

  // COT-02 / MCP-02: GET /analytics/cot — CFTC TFF weekly net-per-class series.
  // CotEntry fields are already plain strings and ints (use-case serialises publishedAt
  // to ISO and asOf is stored as YYYY-MM-DD), so cotResponse.parse(result.value) is direct.
  // Empty store → 200 + [] (not an error). T-13-06-INJ: no user input; output contract-parsed.
  router.get("/analytics/cot", async (c) => {
    const result = await getCot();
    if (!result.ok) {
      // T-13-06-INJ: flat error — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty array on no data — never an error (COT-02).
    return c.json(cotResponse.parse(result.value));
  });

  return router;
}
