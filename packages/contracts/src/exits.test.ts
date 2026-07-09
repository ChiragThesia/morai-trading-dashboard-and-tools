/**
 * Exits contract tests (Phase 26, Plan 01 — EXIT-01/EXIT-04/EXIT-06).
 *
 * exitsResponse is the single Zod schema source for the future GET /api/exits route and the
 * get_exit_advice MCP tool (MCP-02). EXIT-04: every verdict carries a rule id and a raw metric,
 * never a confidence/probability field.
 */

import { describe, it, expect } from "vitest";
import { exitsResponse, heldPositionVerdict, exitMetric } from "./exits.ts";

const validPosition = {
  calendarId: "cal-1",
  name: "7500P 2026-07-31 / 2026-08-26",
  verdict: "TAKE",
  rung: "+10%",
  ruleId: "take-10",
  metric: { name: "pnlPct", value: 0.102, threshold: 0.1 },
  indicative: false,
  changed: true,
  escalate: false,
  pnlPct: 0.102,
  basis: { openNetDebit: 4260, netMark: 4695 },
  roll: null,
};

const validPayload = {
  asOf: "2026-07-09",
  observedAt: "2026-07-09T14:30:00.000Z",
  marketSession: "rth",
  positions: [validPosition],
  ruleSet: [{ id: "stop", kind: "trigger", rationale: "Capital preservation is non-negotiable." }],
};

describe("exitsResponse", () => {
  it("parses a well-formed verdict payload", () => {
    expect(() => exitsResponse.parse(validPayload)).not.toThrow();
  });

  it("rejects a position missing metric", () => {
    const { metric: _omit, ...withoutMetric } = validPosition;
    expect(() =>
      exitsResponse.parse({ ...validPayload, positions: [withoutMetric] }),
    ).toThrow();
  });

  it("rejects a position missing ruleId", () => {
    const { ruleId: _omit, ...withoutRuleId } = validPosition;
    expect(() =>
      exitsResponse.parse({ ...validPayload, positions: [withoutRuleId] }),
    ).toThrow();
  });

  it("rejects an unknown verdict value (closed enum)", () => {
    expect(() =>
      exitsResponse.parse({
        ...validPayload,
        positions: [{ ...validPosition, verdict: "SELL_EVERYTHING" }],
      }),
    ).toThrow();
  });

  it("carries no confidence field — parsed position has no confidence/probability key", () => {
    const parsed = heldPositionVerdict.parse({ ...validPosition, confidence: 0.87 });
    expect(parsed).not.toHaveProperty("confidence");
    expect(parsed).not.toHaveProperty("probability");
  });

  it("round-trips ROLL detail on a ROLL verdict", () => {
    const rollPosition = {
      ...validPosition,
      verdict: "ROLL",
      rung: null,
      ruleId: "roll",
      roll: { suggestedFrontExpiry: "2026-08-14", estDebit: 4100 },
    };
    expect(() => exitsResponse.parse({ ...validPayload, positions: [rollPosition] })).not.toThrow();
  });
});

describe("exitMetric", () => {
  it("requires name, value, and threshold", () => {
    expect(() => exitMetric.parse({ name: "pnlPct", value: 0.1, threshold: 0.05 })).not.toThrow();
    expect(() => exitMetric.parse({ name: "pnlPct", value: 0.1 })).toThrow();
  });
});
