/**
 * computeFwdIv tests (Phase 19, Plan 02) — example + fast-check property, per tdd.md
 * numerical rule.
 *
 * Invariants:
 *   - Normal term structure (radicand >= 0) -> { guard: "ok", fwdIv: finite number }.
 *   - Inverted term structure (radicand < 0) -> { guard: "inverted", fwdIv: null }, never NaN.
 *   - Degenerate radicand === 0 -> { guard: "ok", fwdIv: 0 } (19-CONTEXT.md: only
 *     radicand < 0 is inverted).
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeFwdIv } from "./fwd-iv.ts";

describe("computeFwdIv", () => {
  it("normal term structure: returns guard ok with a finite fwdIv", () => {
    const result = computeFwdIv(21, 0.1249, 43, 0.1402);
    expect(result.guard).toBe("ok");
    expect(result.fwdIv).not.toBeNull();
    if (result.guard === "ok") {
      expect(Number.isFinite(result.fwdIv)).toBe(true);
      const rad = (43 * 0.1402 * 0.1402 - 21 * 0.1249 * 0.1249) / (43 - 21);
      expect(result.fwdIv).toBeCloseTo(Math.sqrt(rad), 10);
    }
  });

  it("inverted term structure: radicand < 0 returns guard inverted, fwdIv null", () => {
    const result = computeFwdIv(21, 0.155, 45, 0.105);
    const rad = (45 * 0.105 * 0.105 - 21 * 0.155 * 0.155) / (45 - 21);
    expect(rad).toBeLessThan(0);
    expect(result).toEqual({ fwdIv: null, guard: "inverted" });
  });

  it("edge: radicand === 0 (degenerate) returns guard ok with fwdIv 0, not inverted", () => {
    // Small integers exactly representable in floating point, so the radicand is exactly 0
    // (not a near-zero epsilon): tb*ivb^2 (4*1*1=4) === tf*ivf^2 (1*2*2=4) => rad = 0/3 = 0.
    const tf = 1;
    const ivf = 2;
    const tb = 4;
    const ivb = 1;
    const result = computeFwdIv(tf, ivf, tb, ivb);
    expect(result).toEqual({ fwdIv: 0, guard: "ok" });
  });

  it("property: never NaN, never throws — result is either a finite ok or a null inverted", () => {
    const dteArb = fc.integer({ min: 1, max: 400 });
    const ivArb = fc.float({ min: Math.fround(0.001), max: Math.fround(3), noNaN: true });

    fc.assert(
      fc.property(dteArb, dteArb, ivArb, ivArb, (a, b, ivf, ivb) => {
        const tf = Math.min(a, b);
        const tb = Math.max(a, b);
        if (tf === tb) return true; // degenerate equal-DTE (division by zero) out of scope

        const result = computeFwdIv(tf, ivf, tb, ivb);
        expect(Number.isNaN(result.fwdIv)).toBe(false);
        if (result.guard === "ok") {
          return typeof result.fwdIv === "number" && Number.isFinite(result.fwdIv);
        }
        return result.fwdIv === null;
      }),
      { numRuns: 1000 },
    );
  });
});
