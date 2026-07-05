import { z } from "zod";
import type { CalendarEventType } from "./calendar-event.ts";

/**
 * rule-tags.ts — event-keyed strategy-rule recording enums (RULE-01, D-07).
 *
 * Three Zod enums, one per CalendarEventType, structuring "which rule fired" when the
 * user annotates an OPEN/CLOSE/ROLL event. Recording-only — NO evaluation/condition
 * logic lives here (RULE-01 boundary; T-20-12: this is not a DSL).
 *
 * Values LOCKED via the D-08 decision checkpoint (user accepted the KB-grounded seeds
 * as-is, including `thesis-invalidated`):
 *   ENTER mirrors the picker's own scoreCalendarCandidates scoring criteria so the user
 *   records the same dimensions they scored candidates on (calendar-selection-criteria.md).
 *   EXIT/ROLL are grounded in trade_management.md / calendar_spread.md.
 *
 * `packages/contracts` derives its request/response schemas from these enums so the
 * DB-boundary vocabulary and the HTTP/MCP vocabulary can never diverge (key_links).
 */

export const enterRuleTag = z.enum([
  "iv-skew-favorable",
  "term-structure-edge",
  "event-window-play",
  "gex-fit",
  "other",
]);
export type EnterRuleTag = z.infer<typeof enterRuleTag>;

export const exitRuleTag = z.enum([
  "profit-target",
  "max-loss",
  "time-stop",
  "thesis-invalidated",
  "other",
]);
export type ExitRuleTag = z.infer<typeof exitRuleTag>;

export const rollRuleTag = z.enum(["defend-tested-side", "roll-for-duration", "other"]);
export type RollRuleTag = z.infer<typeof rollRuleTag>;

/**
 * ruleTagEnumForEventType — resolves which rule-tag enum applies to a CalendarEventType
 * (D-07: OPEN→enter, CLOSE→exit, ROLL→roll). Exhaustive switch, no default fall-through —
 * a new CalendarEventType member fails to typecheck here until handled.
 */
export function ruleTagEnumForEventType(
  eventType: CalendarEventType,
): typeof enterRuleTag | typeof exitRuleTag | typeof rollRuleTag {
  switch (eventType) {
    case "OPEN":
      return enterRuleTag;
    case "CLOSE":
      return exitRuleTag;
    case "ROLL":
      return rollRuleTag;
  }
}
