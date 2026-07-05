import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { setRuleTagsRequest, setRuleTagsResponse, getEventsWithRulesResponse } from "@morai/contracts";
import type {
  ForGettingCalendarById,
  ForRunningGetCalendarEventsWithRules,
  ForRunningSetRuleTags,
} from "@morai/core";

/**
 * journalRulesRoutes — factory returning a Hono router for the RULE-01 read/write surface
 * (D-13): GET the combined events+annotations payload, PUT a validated rule-tag set.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through contract schema → respond.
 *
 * D-13 route addressing: PUT is addressed by fillIdsHash ALONE (no calendarId in path or
 * body) — fill_ids_hash is the DB UNIQUE idempotency key on calendar_events, so the
 * setRuleTags use-case (plan 20-10 fix) looks the event up by hash directly.
 *
 * Threat mitigations:
 *   T-20-15: mounted inside authReadGroup by main.ts (JWT-gated) — no unauthenticated access.
 *   T-20-11: setRuleTagsRequest Zod-validates tags/otherNote (incl. D-21 OTHER-requires-note)
 *            before this route body runs; the use-case re-validates as defense-in-depth.
 *
 * MCP-02: getEventsWithRulesResponse / setRuleTagsResponse reused by get_rule_tags /
 * set_rule_tags MCP tools (plan 20-10).
 */
export function journalRulesRoutes(
  getCalendarById: ForGettingCalendarById,
  getEventsWithRules: ForRunningGetCalendarEventsWithRules,
  setRuleTags: ForRunningSetRuleTags,
) {
  const router = new Hono();

  // GET /api/journal/:calendarId/rules — combined events + rule-tag annotations (D-13)
  router.get("/journal/:calendarId/rules", async (c) => {
    const calendarId = c.req.param("calendarId");

    // Existence pre-check: getCalendarEventsWithRules cannot itself distinguish an
    // unknown calendarId from a known calendar with zero events (both read empty).
    const calResult = await getCalendarById(calendarId);
    if (!calResult.ok) {
      return c.json({ error: "internal" }, 500);
    }
    if (calResult.value === null) {
      return c.json({ error: "not found" }, 404);
    }

    const result = await getEventsWithRules(calendarId);
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }

    return c.json(
      getEventsWithRulesResponse.parse({
        events: result.value.map(({ event, tags, otherNote }) => ({
          id: event.id,
          eventType: event.eventType,
          eventedAt: event.eventedAt.toISOString(),
          fillIdsHash: event.fillIdsHash,
          legOccSymbol: event.legOccSymbol,
          tags,
          otherNote,
        })),
      }),
    );
  });

  // PUT /api/journal/events/:hash/rules — validated rule-tag write (D-13, D-21)
  router.put(
    "/journal/events/:hash/rules",
    zValidator("json", setRuleTagsRequest),
    async (c) => {
      const fillIdsHash = c.req.param("hash");
      const body = c.req.valid("json");

      const result = await setRuleTags({
        fillIdsHash,
        tags: body.tags,
        otherNote: body.otherNote ?? null,
      });

      if (!result.ok) {
        if (result.error.kind === "not-found") {
          return c.json({ error: "not found" }, 404);
        }
        if (result.error.kind === "validation-error") {
          return c.json({ error: result.error.message }, 400);
        }
        return c.json({ error: "internal" }, 500);
      }

      const saved = result.value;
      return c.json(
        setRuleTagsResponse.parse({
          fillIdsHash: saved.fillIdsHash,
          tags: saved.ruleTags,
          otherNote: saved.otherNote,
          updatedAt: saved.updatedAt.toISOString(),
        }),
      );
    },
  );

  return router;
}
