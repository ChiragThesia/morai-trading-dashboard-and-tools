import { Hono } from "hono";
import { rankCalendarsQuery } from "@morai/contracts";
import type { ForRankingCalendars } from "@morai/core";
import { toRankCalendarsRequest, toRankedCalendarBody } from "../calendar-rank-dto.ts";

/**
 * calendarRankRoutes — factory returning a Hono router for GET /calendars/ranked
 * (docs/calendar-engine/spec.mdx §11).
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: Zod-parse query → call use-case → map Result → parse through the contract → respond.
 * Every number on the wire was computed in `packages/core/src/calendar`; nothing is derived,
 * defaulted or re-ranked at this layer.
 *
 * The ranking is computed ON READ from the latest chain cohort — deliberately unlike
 * GET /picker/candidates, which reads a stored snapshot row. There is no calendar-ranking table
 * and no compute job: the engine is deterministic over one chain read, so a stored snapshot
 * would add a staleness mode without adding an answer.
 *
 * ?frontDteMax / ?limit / ?contractType are user-controlled input, so they are validated
 * BEFORE the use-case runs — an invalid value is a 400 and the engine is never called. Absent
 * params are omitted rather than defaulted here, so the use-case stays the one source of the
 * default front ceiling, limit and wing.
 *
 * OBJECT READ — an empty ranking is 200 with `candidates: []` and the drop counts that explain
 * it, never a 404. "Nothing qualified today" is an answer, and the drops are how the reader
 * finds out why (the GEX 404-on-null rule is for a missing snapshot row; nothing is stored here).
 *
 * Threat mitigations:
 *   Errors map to a flat {error:"internal"} — the DB message never reaches the wire.
 *   The response is contract-parsed on the way out, which also strips any internal field the
 *   core type happens to carry.
 *   The limit is capped in rankCalendarsQuery — an unbounded page over ~2,500 candidates is an
 *   unbounded response.
 *
 * MCP-02: rankedCalendarResponse / rankCalendarsQuery are the single schema sources shared with
 *   the rank_calendars MCP tool, and both adapters go through the same calendar-rank-dto
 *   mappers. A one-sided field change fails `bun run typecheck`.
 *
 * Mount: in main.ts inside the CHAINED apiRouter builder, so the effective path is
 *   GET /api/calendars/ranked. Mounted after calendarRoutes, whose only GET is the exact path
 *   /calendars — no shadowing (Hono matches exact paths, first match wins).
 */
export function calendarRankRoutes(rankCalendars: ForRankingCalendars) {
  const router = new Hono();

  router.get("/calendars/ranked", async (c) => {
    const parsed = rankCalendarsQuery.safeParse(c.req.query());
    if (!parsed.success) {
      // Reject before the engine is ever called.
      return c.json({ error: "invalid query" }, 400);
    }

    const result = await rankCalendars(toRankCalendarsRequest(parsed.data));
    if (!result.ok) {
      // Flat error — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    return c.json(toRankedCalendarBody(result.value));
  });

  return router;
}
