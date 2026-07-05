import { z } from "zod";
// D-07 narrow carve-out (REVIEW WR-03): import the rule-tag enums from the scoped
// @morai/core/rule-tags subpath — NOT the @morai/core barrel — so the ESLint boundary
// can mechanically restrict contracts to core's values-only module (never ports/use-cases).
import { enterRuleTag, exitRuleTag, rollRuleTag } from "@morai/core/rule-tags";

// RULE-01: strategy-rule recording contracts (D-14 list-shaped, D-21 OTHER-requires-note).
// MCP-02: ONE schema source for the HTTP route and the MCP tool (plan 20-10).
//
// Vocabulary is single-sourced from @morai/core's rule-tags.ts (D-07) — see the "Narrow
// carve-out" note in docs/architecture/monorepo-layout.md for why contracts is allowed to
// import core here (values only, never ports/use-cases).
//
// The route resolves WHICH of the three enums applies to a given tag write by looking up the
// target event's CalendarEventType (ruleTagEnumForEventType, @morai/core) — this request
// schema accepts the union of all three so a single generic zValidator middleware can run
// before that per-event-type lookup; a narrower per-event-type re-check happens in the route.

// A tag written here is valid only if it belongs to at least one of the three event-keyed
// enums — 'other' is common to all three; the other values are enum-specific.
const ruleTag = z.union([enterRuleTag, exitRuleTag, rollRuleTag]);

// Bound: the largest single event-type enum (ENTER/EXIT) has 5 members — a legitimate
// selection never exceeds that (Security T-20-11: never an unbounded client array).
const MAX_RULE_TAGS = 5;

// ─── setRuleTagsRequest ────────────────────────────────────────────────────────

/**
 * setRuleTagsRequest — PUT /api/journal/events/:hash/rules body (D-14: list-shaped).
 *
 * D-21: 'other' among tags REQUIRES a non-empty (non-whitespace) otherNote; a listed
 * value without a note is accepted as-is.
 */
export const setRuleTagsRequest = z
  .object({
    tags: z.array(ruleTag).max(MAX_RULE_TAGS),
    otherNote: z.string().max(280).optional(),
  })
  .refine(
    (body) =>
      !body.tags.includes("other") ||
      (body.otherNote !== undefined && body.otherNote.trim().length > 0),
    { path: ["otherNote"], message: "otherNote is required when 'other' is among tags" },
  );

export type SetRuleTagsRequest = z.infer<typeof setRuleTagsRequest>;

// ─── setRuleTagsResponse ───────────────────────────────────────────────────────

/**
 * setRuleTagsResponse — the saved annotation, returned after a successful write.
 */
export const setRuleTagsResponse = z.object({
  fillIdsHash: z.string().length(64),
  tags: z.array(z.string()),
  otherNote: z.string().nullable(),
  /** ISO-8601 UTC timestamp. MUST end in "Z". */
  updatedAt: z.string().datetime(),
});

export type SetRuleTagsResponse = z.infer<typeof setRuleTagsResponse>;

// ─── getEventsWithRulesResponse ────────────────────────────────────────────────

/**
 * eventWithRulesEntry — one OPEN/CLOSE/ROLL event plus its recorded rule tags (RESEARCH:
 * no route/MCP tool exposes calendar_events today — this is the missing read surface).
 */
const eventWithRulesEntry = z.object({
  id: z.string().uuid(),
  eventType: z.enum(["OPEN", "CLOSE", "ROLL"]),
  /** ISO-8601 UTC timestamp of the first fill in this event. MUST end in "Z". */
  eventedAt: z.string().datetime(),
  fillIdsHash: z.string().length(64),
  legOccSymbol: z.string(),
  tags: z.array(z.string()),
  otherNote: z.string().nullable(),
});

/**
 * getEventsWithRulesResponse — GET /api/journal/:calendarId/rules (D-14: combined read,
 * one round trip for both the event list and any existing annotations).
 */
export const getEventsWithRulesResponse = z.object({
  events: z.array(eventWithRulesEntry),
});

export type EventWithRulesEntry = z.infer<typeof eventWithRulesEntry>;
export type GetEventsWithRulesResponse = z.infer<typeof getEventsWithRulesResponse>;
