/**
 * rule-tags.ts — RED phase tests (RULE-01, D-07/D-08).
 *
 * Values LOCKED via the D-08 decision checkpoint (user accepted the KB-grounded seeds
 * as-is, "accept-seeds"):
 *   ENTER = iv-skew-favorable, term-structure-edge, event-window-play, gex-fit, other
 *   EXIT  = profit-target, max-loss, time-stop, thesis-invalidated, other
 *   ROLL  = defend-tested-side, roll-for-duration, other
 *
 * Must-haves verified here:
 *   - each enum accepts its own seeded values (including 'other') and rejects a
 *     foreign (cross-type) value.
 *   - ruleTagEnumForEventType resolves OPEN→enter, CLOSE→exit, ROLL→roll exhaustively.
 */

import { describe, it, expect } from "vitest";
import {
  enterRuleTag,
  exitRuleTag,
  rollRuleTag,
  ruleTagEnumForEventType,
} from "./rule-tags.ts";

const ENTER_VALUES = [
  "iv-skew-favorable",
  "term-structure-edge",
  "event-window-play",
  "gex-fit",
  "other",
];
const EXIT_VALUES = ["profit-target", "max-loss", "time-stop", "thesis-invalidated", "other"];
const ROLL_VALUES = ["defend-tested-side", "roll-for-duration", "other"];

describe("enterRuleTag", () => {
  it.each(ENTER_VALUES)("accepts seeded ENTER value '%s'", (value) => {
    expect(enterRuleTag.safeParse(value).success).toBe(true);
  });

  it("rejects a foreign EXIT value", () => {
    expect(enterRuleTag.safeParse("profit-target").success).toBe(false);
  });

  it("rejects a foreign ROLL value", () => {
    expect(enterRuleTag.safeParse("defend-tested-side").success).toBe(false);
  });
});

describe("exitRuleTag", () => {
  it.each(EXIT_VALUES)("accepts seeded EXIT value '%s'", (value) => {
    expect(exitRuleTag.safeParse(value).success).toBe(true);
  });

  it("rejects a foreign ENTER value", () => {
    expect(exitRuleTag.safeParse("gex-fit").success).toBe(false);
  });

  it("rejects a foreign ROLL value", () => {
    expect(exitRuleTag.safeParse("roll-for-duration").success).toBe(false);
  });
});

describe("rollRuleTag", () => {
  it.each(ROLL_VALUES)("accepts seeded ROLL value '%s'", (value) => {
    expect(rollRuleTag.safeParse(value).success).toBe(true);
  });

  it("rejects a foreign ENTER value", () => {
    expect(rollRuleTag.safeParse("iv-skew-favorable").success).toBe(false);
  });

  it("rejects a foreign EXIT value", () => {
    expect(rollRuleTag.safeParse("time-stop").success).toBe(false);
  });
});

describe("ruleTagEnumForEventType", () => {
  it("OPEN resolves to enterRuleTag", () => {
    const resolved = ruleTagEnumForEventType("OPEN");
    expect(resolved.safeParse("iv-skew-favorable").success).toBe(true);
    expect(resolved.safeParse("profit-target").success).toBe(false);
  });

  it("CLOSE resolves to exitRuleTag", () => {
    const resolved = ruleTagEnumForEventType("CLOSE");
    expect(resolved.safeParse("profit-target").success).toBe(true);
    expect(resolved.safeParse("defend-tested-side").success).toBe(false);
  });

  it("ROLL resolves to rollRuleTag", () => {
    const resolved = ruleTagEnumForEventType("ROLL");
    expect(resolved.safeParse("defend-tested-side").success).toBe(true);
    expect(resolved.safeParse("iv-skew-favorable").success).toBe(false);
  });

  it("each resolved enum accepts 'other'", () => {
    for (const eventType of ["OPEN", "CLOSE", "ROLL"] as const) {
      expect(ruleTagEnumForEventType(eventType).safeParse("other").success).toBe(true);
    }
  });
});
