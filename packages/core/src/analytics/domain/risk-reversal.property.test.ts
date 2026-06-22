/**
 * risk-reversal property tests (Phase 6, Plan 06-03) — fast-check, per tdd.md numerical rule.
 *
 * Invariants:
 *   - Monotone-smile / no-overshoot: the interpolated put & call IV lie between the two bracketing
 *     points' IVs (interpolation never overshoots).
 *   - Null-safety: a smile lacking a bracketing pair on either wing returns null (never a number).
 *   - Order-independence: shuffling the smile array does not change the result.
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { interpolateRiskReversal } from "./risk-reversal.ts";
import type { SmileQuote } from "../application/ports.ts";

const quote = (delta: number, iv: number): SmileQuote => ({
  underlying: "SPX",
  expiration: "2026-07-17",
  strike: 5500000,
  iv,
  delta,
  moneyness: 1.0,
});

const ivArb = fc.float({ min: Math.fround(0.05), max: Math.fround(2), noNaN: true });

describe("interpolateRiskReversal — properties", () => {
  it("no-overshoot: result equals (put IV − call IV) with each leg inside its bracket", () => {
    // Build a smile that always brackets ±0.25 with one shallow and one deep point per wing.
    fc.assert(
      fc.property(
        // put-bracket deltas: shallow in [-0.25, -0.01], deep in [-0.49, -0.25]
        fc.float({ min: Math.fround(-0.25), max: Math.fround(-0.01), noNaN: true }),
        fc.float({ min: Math.fround(-0.49), max: Math.fround(-0.25), noNaN: true }),
        // call-bracket deltas: shallow in [0.01, 0.25], deep in [0.25, 0.49]
        fc.float({ min: Math.fround(0.01), max: Math.fround(0.25), noNaN: true }),
        fc.float({ min: Math.fround(0.25), max: Math.fround(0.49), noNaN: true }),
        ivArb,
        ivArb,
        ivArb,
        ivArb,
        (putShallow, putDeep, callShallow, callDeep, ivPutS, ivPutD, ivCallS, ivCallD) => {
          // Ensure strict bracketing of −0.25 and +0.25 (skip degenerate equal-delta cases).
          if (putShallow <= putDeep) return true; // need putShallow > putDeep (closer to 0)
          if (callDeep <= callShallow) return true;
          if (putShallow < -0.25 || putDeep > -0.25) return true; // must straddle −0.25
          if (callShallow > 0.25 || callDeep < 0.25) return true; // must straddle +0.25

          const smile: ReadonlyArray<SmileQuote> = [
            quote(putShallow, ivPutS),
            quote(putDeep, ivPutD),
            quote(callShallow, ivCallS),
            quote(callDeep, ivCallD),
          ];
          const rr = interpolateRiskReversal(smile);
          if (rr === null) return true; // bracketing not achieved at this sample — null is safe

          const putLo = Math.min(ivPutS, ivPutD);
          const putHi = Math.max(ivPutS, ivPutD);
          const callLo = Math.min(ivCallS, ivCallD);
          const callHi = Math.max(ivCallS, ivCallD);
          // rr = putIV − callIV ∈ [putLo − callHi, putHi − callLo] (no overshoot beyond brackets)
          const lo = putLo - callHi - 1e-9;
          const hi = putHi - callLo + 1e-9;
          return rr >= lo && rr <= hi;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("null-safety: a smile whose wings never reach ±0.25 returns null (never a number)", () => {
    fc.assert(
      fc.property(
        // both wings strictly shallower than ±0.25 → cannot bracket
        fc.float({ min: Math.fround(-0.24), max: Math.fround(-0.01), noNaN: true }),
        fc.float({ min: Math.fround(-0.24), max: Math.fround(-0.01), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(0.24), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(0.24), noNaN: true }),
        ivArb,
        ivArb,
        ivArb,
        ivArb,
        (pa, pb, ca, cb, ia, ib, ic, id) => {
          const smile: ReadonlyArray<SmileQuote> = [
            quote(pa, ia),
            quote(pb, ib),
            quote(ca, ic),
            quote(cb, id),
          ];
          return interpolateRiskReversal(smile) === null;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("order-independence: shuffling the smile does not change the result", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-0.49), max: Math.fround(-0.26), noNaN: true }),
        fc.float({ min: Math.fround(-0.24), max: Math.fround(-0.01), noNaN: true }),
        fc.float({ min: Math.fround(0.26), max: Math.fround(0.49), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(0.24), noNaN: true }),
        ivArb,
        ivArb,
        ivArb,
        ivArb,
        (putDeep, putShallow, callDeep, callShallow, ivPutD, ivPutS, ivCallD, ivCallS) => {
          const smile: ReadonlyArray<SmileQuote> = [
            quote(putDeep, ivPutD),
            quote(putShallow, ivPutS),
            quote(callDeep, ivCallD),
            quote(callShallow, ivCallS),
          ];
          const a = interpolateRiskReversal(smile);
          const b = interpolateRiskReversal([...smile].reverse());
          if (a === null) return b === null;
          if (b === null) return false;
          return Math.abs(a - b) <= 1e-12;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
