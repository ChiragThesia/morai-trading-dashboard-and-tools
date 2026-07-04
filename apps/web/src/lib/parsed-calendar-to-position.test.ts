/**
 * parsed-calendar-to-position.test.ts — TDD RED→GREEN for the pasted-order → AnalyzerPosition
 * adapter (ad-hoc paste-to-analyze). Mirrors candidate-to-position.ts but sources a
 * ParsedCalendar (from tos-parser) with a single flat IV shared across both legs.
 */
import { describe, it, expect } from "vitest";
import { parsedCalendarToAnalyzerPosition } from "./parsed-calendar-to-position.ts";
import { repriceScenario } from "./scenario-engine.ts";
import type { ParsedCalendar } from "./tos-parser.ts";

const PARSED: ParsedCalendar = {
  underlying: "SPX",
  qty: 1,
  type: "P",
  strike: 7425,
  debit: 48.75,
  frontDte: 43,
  backDte: 78,
  iv: 0.17,
};

describe("parsedCalendarToAnalyzerPosition", () => {
  it("maps every field, flat IV onto both legs, never live", () => {
    const pos = parsedCalendarToAnalyzerPosition(PARSED);
    expect(pos.live).toBe(false);
    expect(pos.putCall).toBe("P");
    expect(pos.frontDte).toBe(43);
    expect(pos.backDte).toBe(78);
    expect(pos.frontIv).toBe(0.17);
    expect(pos.backIv).toBe(0.17);
    expect(pos.qty).toBe(1);
    expect(pos.included).toBe(true);
  });

  it("produces an engine-compatible position (repriceScenario yields a finite payoff curve)", () => {
    const pos = parsedCalendarToAnalyzerPosition(PARSED);
    const result = repriceScenario([pos], {
      spot: 7498.85,
      daysForward: 0,
      ivShift: 0,
      rate: 0.045,
      divYield: 0.013,
    });
    expect(result.payoffCurve.length).toBeGreaterThan(0);
    expect(result.payoffCurve.every((p) => Number.isFinite(p.pl))).toBe(true);
    expect(result.expirationCurve.every((p) => Number.isFinite(p.pl))).toBe(true);
  });
});
