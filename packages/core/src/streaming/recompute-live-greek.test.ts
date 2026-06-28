/**
 * recomputeLiveGreek — unit + fast-check round-trip tests
 *
 * RED phase: All tests fail until recompute-live-greek.ts is implemented.
 *
 * Must-haves verified here:
 *   - BSM IV inversion from mark + underlying_price (D-02)
 *   - mark-absent fallback to (bid+ask)/2
 *   - Typed skip when both mark and midpoint unavailable or T<=0 (Pitfall 4)
 *   - Never throws, never produces NaN on the ok path
 *   - fast-check property: IV round-trips through bsmPrice within tolerance
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { recomputeLiveGreek } from "./recompute-live-greek.ts";
import type { RawOptionTick } from "./ports.ts";
import { bsmPrice } from "@morai/quant";
import { parseOccSymbol } from "@morai/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** An ATM SPX call expiring 30 days from now. */
function makeAtmCallTick(overrides: Partial<RawOptionTick> = {}): RawOptionTick {
  return {
    occSymbol: "SPX   260728C05600000",
    mark: 30.0,
    bid: 29.5,
    ask: 30.5,
    underlyingPrice: 5600,
    ts: "2026-06-28T14:30:00.000Z",
    ...overrides,
  };
}

const RATE = 0.045;
const Q = 0.013;
const NOW = new Date("2026-06-28T14:30:00.000Z");

// ─── Example tests ────────────────────────────────────────────────────────────

describe("recomputeLiveGreek — example tests", () => {
  it("returns ok(LiveGreekTick) for a valid ATM call tick", () => {
    const result = recomputeLiveGreek(makeAtmCallTick(), RATE, Q, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tick = result.value;
    expect(tick.occSymbol).toBe("SPX   260728C05600000");
    expect(tick.mark).toBe(30.0);
    expect(tick.bsmIv).toBeGreaterThan(0);
    expect(tick.bsmIv).toBeLessThan(5);
    expect(tick.bsmDelta).toBeGreaterThan(0);
    expect(tick.bsmDelta).toBeLessThan(1);
    expect(typeof tick.bsmGamma).toBe("number");
    expect(typeof tick.bsmTheta).toBe("number");
    expect(typeof tick.bsmVega).toBe("number");
    expect(tick.ts).toBe("2026-06-28T14:30:00.000Z");
  });

  it("uses (bid+ask)/2 midpoint when mark is null (Pitfall 4 fallback)", () => {
    const tick = makeAtmCallTick({ mark: null, bid: 29.5, ask: 30.5 });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // midpoint = 30.0 — should produce a valid result
    expect(result.value.mark).toBe(30.0);
  });

  it("returns err skip when mark is null and bid/ask are also null (no price available)", () => {
    const tick = makeAtmCallTick({ mark: null, bid: null, ask: null });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("returns err skip when mark <= 0 and no valid midpoint", () => {
    const tick = makeAtmCallTick({ mark: null, bid: null, ask: 0 });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("returns err skip when T <= 0 (expiry in the past — Pitfall 4)", () => {
    // Expiry 2026-01-15 is in the past relative to NOW (2026-06-28)
    const tick: RawOptionTick = {
      occSymbol: "SPX   260115C05600000",
      mark: 30.0,
      bid: 29.5,
      ask: 30.5,
      underlyingPrice: 5600,
      ts: "2026-06-28T14:30:00.000Z",
    };
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("returns err skip when OCC symbol cannot be parsed (wrong length)", () => {
    const tick = makeAtmCallTick({ occSymbol: "INVALID" });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("returns err skip when underlyingPrice is null", () => {
    const tick = makeAtmCallTick({ underlyingPrice: null });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("returns err skip when underlyingPrice <= 0", () => {
    const tick = makeAtmCallTick({ underlyingPrice: 0 });
    const result = recomputeLiveGreek(tick, RATE, Q, NOW);
    expect(result.ok).toBe(false);
  });

  it("never throws on extreme inputs — returns ok or typed err", () => {
    const edgeCases: RawOptionTick[] = [
      makeAtmCallTick({ mark: 0.001 }),
      makeAtmCallTick({ mark: 99999 }),
      makeAtmCallTick({ underlyingPrice: 0.01 }),
      makeAtmCallTick({ mark: null, bid: null, ask: null }),
    ];
    for (const tick of edgeCases) {
      expect(() => recomputeLiveGreek(tick, RATE, Q, NOW)).not.toThrow();
    }
  });

  it("bsmIv on the ok path is always finite and positive", () => {
    const result = recomputeLiveGreek(makeAtmCallTick(), RATE, Q, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isFinite(result.value.bsmIv)).toBe(true);
    expect(result.value.bsmIv).toBeGreaterThan(0);
  });
});

// ─── fast-check property test ─────────────────────────────────────────────────

describe("recomputeLiveGreek — fast-check round-trip property", () => {
  /**
   * Property: for randomized ATM-ish inputs (spot, strike within band, T in (0,1]),
   * when recompute returns ok, bsmPrice(S, K, T, bsmIv) ≈ mark within tolerance.
   *
   * This re-uses the IV inversion round-trip invariant: invertIv is correct iff
   * bsmPrice(S, K, T, invertIv(mark,...)) ≈ mark.
   */
  it("bsmPrice(S, K, T, bsmIv, r, q, type) ≈ mark within 1e-3 on all solvable inputs", () => {
    // Use a fixed reference "now" so T is always positive and within a reasonable range.
    // IMPORTANT: use parseOccSymbol to get the expiry Date consistently with recomputeLiveGreek
    // (parseOccSymbol uses local-time midnight; computing T independently with a UTC Date causes
    // a timezone-driven T mismatch that breaks the round-trip property on non-UTC machines).
    const referenceNow = new Date("2026-06-28T14:30:00.000Z");
    const EXPIRY_STR = "260728"; // 2026-07-28 — ~30 days out

    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(3000), max: Math.fround(8000), noNaN: true }), // spot (S)
        fc.float({ min: Math.fround(0.7), max: Math.fround(1.3), noNaN: true }),   // strike as fraction of spot
        fc.constantFrom("C" as const, "P" as const),                                 // option type
        fc.float({ min: Math.fround(0.1), max: Math.fround(1.0), noNaN: true }),    // IV used to generate the mark
        (spot, strikeFrac, type, sigma) => {
          const strike = Math.round(spot * strikeFrac / 5) * 5; // round to $5 increments
          if (strike <= 0) return true; // skip degenerate

          // Format OCC symbol: root padded to 6 chars, YYMMDD, type, strike*1000 padded to 8
          const strikeInt = Math.round(strike * 1000);
          const occSymbol = `SPX   ${EXPIRY_STR}${type}${String(strikeInt).padStart(8, "0")}`;
          if (occSymbol.length !== 21) return true; // skip malformed

          // Use parseOccSymbol to get the SAME T that recomputeLiveGreek will compute.
          // This avoids timezone-driven mismatches (parseOccSymbol uses local-midnight Date).
          const parsedOcc = parseOccSymbol(occSymbol);
          if (!parsedOcc.ok) return true;
          const T = (parsedOcc.value.expiry.getTime() - referenceNow.getTime()) / (365.25 * 24 * 3600 * 1000);
          if (T <= 0) return true; // skip expired

          // Generate a realistic mark from the known sigma, using the SAME T
          const theoreticalMark = bsmPrice(spot, strike, T, sigma, RATE, Q, type);
          if (theoreticalMark <= 0.01) return true; // skip near-zero marks (below-intrinsic guard)

          const tick: RawOptionTick = {
            occSymbol,
            mark: theoreticalMark,
            bid: null,
            ask: null,
            underlyingPrice: spot,
            ts: "2026-06-28T14:30:00.000Z",
          };

          const result = recomputeLiveGreek(tick, RATE, Q, referenceNow);
          if (!result.ok) return true; // IV inversion may legitimately fail on extreme inputs

          // Round-trip: bsmPrice(S, K, T, recoveredIv) ≈ mark
          // Both T and mark are consistent (same parseOccSymbol-derived T), so this is a clean
          // test of the IV inversion → bsmPrice re-pricing identity.
          const repriced = bsmPrice(spot, strike, T, result.value.bsmIv, RATE, Q, type);
          const diff = Math.abs(repriced - theoreticalMark);

          // Tolerance: 1e-3 (generous for edge inputs; the iv-inversion unit tests use 1e-4)
          return diff < 1e-3;
        },
      ),
      { numRuns: 100, seed: 42 }, // seed for reproducibility
    );
  });
});
