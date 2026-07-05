/**
 * computeForwardVol tests (Phase 22, Plan 01) — example + fast-check property, per tdd.md
 * numerical rule.
 *
 * Invariants:
 *   - Normal term structure (radicand >= 0) -> { guard: "ok", forwardVol: finite number }.
 *   - Inverted term structure (radicand < 0) -> { guard: "inverted", forwardVol: null }, never NaN.
 *   - Degenerate radicand === 0 -> { guard: "ok", forwardVol: 0 } (only radicand < 0 is inverted).
 *   - Non-finite input IV (parseFloat("NaN")) or dteBack === dteFront -> { guard: "inverted",
 *     forwardVol: null } — treated as the same non-computable case.
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeForwardVol } from "./fwd-vol.ts";

describe("computeForwardVol", () => {
  it("normal term structure: returns guard ok with a finite forwardVol", () => {
    const result = computeForwardVol({
      dteFront: 21,
      dteBack: 43,
      frontIv: "0.1249",
      backIv: "0.1402",
    });
    expect(result.guard).toBe("ok");
    expect(result.forwardVol).not.toBeNull();
    if (result.guard === "ok") {
      expect(Number.isFinite(result.forwardVol)).toBe(true);
      const rad = (43 * 0.1402 * 0.1402 - 21 * 0.1249 * 0.1249) / (43 - 21);
      expect(result.forwardVol).toBeCloseTo(Math.sqrt(rad), 10);
    }
  });

  it("inverted term structure: radicand < 0 returns guard inverted, forwardVol null", () => {
    const result = computeForwardVol({
      dteFront: 21,
      dteBack: 45,
      frontIv: "0.155",
      backIv: "0.105",
    });
    const rad = (45 * 0.105 * 0.105 - 21 * 0.155 * 0.155) / (45 - 21);
    expect(rad).toBeLessThan(0);
    expect(result).toEqual({ forwardVol: null, guard: "inverted" });
  });

  it("edge: radicand === 0 (degenerate) returns guard ok with forwardVol 0, not inverted", () => {
    // Small integers exactly representable in floating point, so the radicand is exactly 0
    // (not a near-zero epsilon): tb*ivb^2 (4*1*1=4) === tf*ivf^2 (1*2*2=4) => rad = 0/3 = 0.
    const result = computeForwardVol({
      dteFront: 1,
      dteBack: 4,
      frontIv: "2",
      backIv: "1",
    });
    expect(result).toEqual({ forwardVol: 0, guard: "ok" });
  });

  it("non-finite frontIv (parseFloat 'NaN') returns guard inverted, never a NaN forwardVol", () => {
    const result = computeForwardVol({
      dteFront: 21,
      dteBack: 43,
      frontIv: "NaN",
      backIv: "0.1402",
    });
    expect(result).toEqual({ forwardVol: null, guard: "inverted" });
  });

  it("dteBack === dteFront (division by zero) returns guard inverted, never NaN/Infinity", () => {
    const result = computeForwardVol({
      dteFront: 21,
      dteBack: 21,
      frontIv: "0.12",
      backIv: "0.14",
    });
    expect(result).toEqual({ forwardVol: null, guard: "inverted" });
  });

  it("property: never NaN, never throws — result is either a finite ok or a null inverted", () => {
    const dteArb = fc.integer({ min: 1, max: 400 });
    const ivArb = fc.float({ min: Math.fround(0.001), max: Math.fround(3), noNaN: true });

    fc.assert(
      fc.property(dteArb, dteArb, ivArb, ivArb, (dteFront, dteBack, ivf, ivb) => {
        const result = computeForwardVol({
          dteFront,
          dteBack,
          frontIv: String(ivf),
          backIv: String(ivb),
        });
        expect(Number.isNaN(result.forwardVol)).toBe(false);
        if (result.guard === "ok") {
          return typeof result.forwardVol === "number" && Number.isFinite(result.forwardVol);
        }
        return result.forwardVol === null;
      }),
      { numRuns: 1000 },
    );
  });
});
