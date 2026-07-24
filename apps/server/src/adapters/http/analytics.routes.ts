import { Hono } from "hono";
import {
  termStructureResponse,
  skewResponse,
  cotResponse,
  macroResponse,
  macroQuery,
  regimeResponse,
  newsResponse,
} from "@morai/contracts";
import type {
  ForRunningGetTermStructure,
  ForRunningGetSkew,
  ForRunningGetCot,
  ForRunningGetMacro,
  ForRunningGetRegimeBoard,
  ForRunningGetNews,
} from "@morai/core";

/**
 * analyticsRoutes — factory returning a Hono router for the analytics read endpoints.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through the contract schema → respond.
 *
 * 06-04 adds GET /analytics/term-structure; 06-05 adds GET /analytics/skew.
 * 13-06 adds GET /analytics/cot (CFTC TFF weekly series — COT-02 / MCP-02).
 * 14-06 adds GET /analytics/macro (FRED + VVIX series — MAC-02 / MCP-02).
 * 24-04 adds GET /analytics/regime (regime/breadth board — BOARD-01/02/03 / MCP-02).
 *
 * Threat mitigations:
 *   T-06-08/T-06-13/T-13-06-INJ/T-14-14/T-24-08: errors mapped to flat {error:"internal"} — no DB
 *            message returned.
 *   T-06-09/T-06-14: optional ?calendarId/?underlying/?expiration are parsed at the boundary; an
 *            unknown value simply matches no rows → contract-valid EMPTY array (not an error).
 *   T-13-06-INJ: GET /analytics/cot takes no user-controlled query input; output validated against
 *            cotResponse before send.
 *   T-14-01: GET /analytics/macro DOES take user input (?days/?series) — validated via macroQuery
 *            at the boundary before the use-case runs; invalid input never reaches getMacro.
 *   T-24-08: GET /analytics/regime takes no user-controlled query input; output validated against
 *            regimeResponse before send.
 *
 * MCP-02: termStructureResponse + skewResponse + cotResponse + macroResponse + regimeResponse are
 *   the single schema sources shared by these routes and the corresponding MCP tools. A one-sided
 *   field change fails typecheck.
 */
export function analyticsRoutes(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
  getCot: ForRunningGetCot,
  getMacro: ForRunningGetMacro,
  getRegimeBoard: ForRunningGetRegimeBoard,
  getNews: ForRunningGetNews,
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

  // D28 / MCP-02: GET /analytics/news — latest 50 market headlines (Alpaca/Benzinga wire).
  // NewsEntry fields are already plain strings (use-case serialises publishedAt to ISO),
  // so newsResponse.parse(result.value) is direct. Empty store → 200 + [] (not an error).
  // No user-controlled query input; output contract-parsed before send.
  router.get("/analytics/news", async (c) => {
    const result = await getNews();
    if (!result.ok) {
      // Flat error — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty array on no data — never an error (keys unset or cron not yet run).
    return c.json(newsResponse.parse(result.value));
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

  // MAC-02 / MCP-02: GET /analytics/macro — FRED (7 series) + VVIX macro map.
  // T-14-01: ?days/?series ARE user-controlled input (unlike /cot) — validated via macroQuery
  // BEFORE the use-case runs; an invalid value returns 400 and getMacro is never called.
  router.get("/analytics/macro", async (c) => {
    const daysParam = c.req.query("days");
    const seriesParam = c.req.query("series");
    const rawQuery = {
      ...(daysParam === undefined ? {} : { days: daysParam }),
      ...(seriesParam === undefined ? {} : { series: seriesParam }),
    };

    const parsed = macroQuery.safeParse(rawQuery);
    if (!parsed.success) {
      // T-14-01: reject before the use-case is ever called.
      return c.json({ error: "invalid query" }, 400);
    }

    // exactOptionalPropertyTypes: omit absent keys rather than assigning `undefined`
    // (mirrors the /analytics/term-structure and /analytics/skew query-building above).
    const query = {
      ...(parsed.data.days === undefined ? {} : { days: parsed.data.days }),
      ...(parsed.data.series === undefined ? {} : { series: parsed.data.series }),
    };

    const result = await getMacro(query);
    if (!result.ok) {
      // T-14-14: flat error body — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty map on no data — never an error (mirrors COT/skew SPEC R5 convention).
    return c.json(macroResponse.parse(result.value));
  });

  // BOARD-01/02/03 / MCP-02: GET /analytics/regime — regime/breadth board, computed on-read
  // from macro_observations (no new table). T-24-08: no user input; output contract-parsed.
  router.get("/analytics/regime", async (c) => {
    const result = await getRegimeBoard();
    if (!result.ok) {
      // T-24-08: flat error body — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty array on no data — never an error (mirrors COT convention; T-24-09).
    return c.json(regimeResponse.parse(result.value));
  });

  return router;
}
