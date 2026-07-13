/**
 * parsed-calendar-to-candidate.test.ts — TDD RED→GREEN for the pasted-order → PickerCandidate
 * adapter. A pasted calendar has no engine score, no breakdown, no greeks — this builds a lean,
 * synthetic candidate that satisfies the `pickerCandidate` schema so it can sit in the same rail /
 * drive the same shared payoff chart as scored candidates (D-02). The caller supplies a unique
 * `id` (multi-paste redesign) so several pasted cards can coexist in the rail.
 */
import { describe, it, expect } from "vitest";
import { pickerCandidate } from "@morai/contracts";
import { parsedCalendarToPickerCandidate } from "./parsed-calendar-to-candidate.ts";
import type { ParsedCalendar } from "./tos-parser.ts";

const PARSED: ParsedCalendar = {
  underlying: "SPX",
  qty: 1,
  type: "P",
  strike: 7450,
  debit: 45.85,
  frontDte: 30,
  backDte: 58,
  frontExpiry: "2026-07-31",
  backExpiry: "2026-08-28",
  iv: 0.17,
};

describe("parsedCalendarToPickerCandidate", () => {
  it("builds a schema-valid lean candidate using the caller-supplied id", () => {
    const candidate = parsedCalendarToPickerCandidate(PARSED, "pasted-1");
    expect(() => pickerCandidate.parse(candidate)).not.toThrow();
    expect(candidate.id).toBe("pasted-1");
  });

  it("assigns a distinct id per call when the caller passes distinct ids (multi-paste)", () => {
    const first = parsedCalendarToPickerCandidate(PARSED, "pasted-1");
    const second = parsedCalendarToPickerCandidate(PARSED, "pasted-2");
    expect(first.id).toBe("pasted-1");
    expect(second.id).toBe("pasted-2");
  });

  it("carries strike/type/DTEs/IV onto both legs, dollar debit, and zeroed score/greeks", () => {
    const candidate = parsedCalendarToPickerCandidate(PARSED, "pasted-1");
    expect(candidate.name).toBe("7450P · pasted");
    expect(candidate.score).toBe(0);
    expect(candidate.breakdown).toEqual([]);
    expect(candidate.debit).toBe(45.85 * 100 * 1);
    expect(candidate.theta).toBe(0);
    expect(candidate.vega).toBe(0);
    expect(candidate.delta).toBe(0);
    expect(candidate.fwdIv).toBeNull();
    expect(candidate.fwdIvGuard).toBe("ok");
    expect(candidate.slope).toBe(0);
    expect(candidate.fwdEdge).toBe(0);
    expect(candidate.expectedMove).toBe(0);
    expect(candidate.frontEvents).toEqual([]);
    expect(candidate.backEvents).toEqual([]);
    expect(candidate.frontLeg).toEqual({ strike: 7450, putCall: "P", dte: 30, iv: 0.17 });
    expect(candidate.backLeg).toEqual({ strike: 7450, putCall: "P", dte: 58, iv: 0.17 });
    expect(candidate.exitPlan).toEqual({
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "",
      thetaCapturePct: null,
    });
  });

  it("scales dollar debit by qty", () => {
    const candidate = parsedCalendarToPickerCandidate({ ...PARSED, qty: 3 }, "pasted-1");
    expect(candidate.debit).toBe(45.85 * 100 * 3);
  });

  it("carries CALL type onto both legs", () => {
    const candidate = parsedCalendarToPickerCandidate({ ...PARSED, type: "C" }, "pasted-1");
    expect(candidate.frontLeg.putCall).toBe("C");
    expect(candidate.backLeg.putCall).toBe("C");
    expect(candidate.name).toBe("7450C · pasted");
  });

  it("defaults debit to 0 when the paste had no @price", () => {
    const candidate = parsedCalendarToPickerCandidate({ ...PARSED, debit: null }, "pasted-1");
    expect(candidate.debit).toBe(0);
  });
});
