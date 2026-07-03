/**
 * iv-calibration.test.ts — resolveLegIv price→IV wrapper test suite (OVW-02, D-01)
 *
 * RED phase: all assertions fail until iv-calibration.ts is implemented.
 *
 * Test structure:
 *   1. Round-trip property (REST-fallback path) — ok-path sigma matches invertIv's own
 *      result for the same effective (S, K, T, sigma, type) tuple.
 *   2. Live-tick trust shortcut (Pitfall 2) — a live tick's bsmIv is trusted verbatim,
 *      never re-run through invertIv.
 *   3. Deep-ITM / illiquid non-convergence — err carries an IvError tag, never a number.
 *   4. Cold-start (no tick, marketValue === null) — err({kind:"no-price"}), distinct
 *      from non-convergence (Pitfall 2).
 *   5. netQty === 0 REST fallback — err({kind:"no-price"}), never NaN/Infinity (Pitfall 3).
 *   6. Expired leg (T <= 0) — err({kind:"expired"}).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { invertIv } from "@morai/core";
import { bsmPrice } from "@morai/quant";
import { parseOccSymbol, formatOccSymbol } from "@morai/shared";
import { resolveLegIv } from "./iv-calibration.ts";

// ─────────────────────────────────────────────────────────────
// Constants (mirror packages/core/src/journal/domain/iv-inversion.test.ts)
// ─────────────────────────────────────────────────────────────
const R = 0.045;
const Q = 0.013;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Build a 21-char OCC symbol via formatOccSymbol (root padded to "SPX   "). */
function buildOcc(strike: number, expiry: Date, type: "C" | "P"): string {
  return formatOccSymbol({ root: "SPX", expiry, type, strike });
}

// A fixed midday reference time — avoids day-boundary rounding flakiness from
// parseOccSymbol's local-midnight expiry reconstruction.
const NOW = new Date(2026, 0, 15, 12, 0, 0);

// A liquid, non-expired, easily-parseable OCC symbol reused across unit tests.
const LIQUID_EXPIRY = new Date(NOW.getTime() + (45 / 365.25) * MS_PER_YEAR);
const LIQUID_OCC = buildOcc(7550, LIQUID_EXPIRY, "C");
const LIQUID_SPOT = 7550;

// ─────────────────────────────────────────────────────────────
// 1. Round-trip property — REST-fallback path
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — round-trip property (REST-fallback path)", () => {
  it("ok-path sigma matches invertIv's own result for the same effective tuple (numRuns=500)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true }), // S
        fc.float({ min: Math.fround(400), max: Math.fround(9000), noNaN: true }), // K (raw)
        fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }), // T (raw, years)
        fc.float({ min: Math.fround(0.05), max: Math.fround(3), noNaN: true }), // sigma
        fc.constantFrom("C" as const, "P" as const),
        (S, Kraw, Traw, sigma, type) => {
          const expiry = new Date(NOW.getTime() + Traw * MS_PER_YEAR);
          const occSymbol = buildOcc(Kraw, expiry, type);
          const parsed = parseOccSymbol(occSymbol);
          if (!parsed.ok) return true; // formatting edge case — skip

          const { strike: K, expiry: parsedExpiry } = parsed.value;
          const T = (parsedExpiry.getTime() - NOW.getTime()) / MS_PER_YEAR;
          if (T <= 0) return true; // date-rounding pushed expiry to/before NOW — skip (Pitfall covered by dedicated unit test)

          const mark = bsmPrice(S, K, T, sigma, R, Q, type);

          // REST fallback: netQty=1, restMarketValue=mark*100 so price = |mark*100|/(1*100) = mark.
          const wrapped = resolveLegIv(occSymbol, S, R, Q, null, mark * 100, 1, NOW);
          const direct = invertIv(mark, S, K, T, R, Q, type);

          if (!direct.ok) return true; // degenerate tuple — invertIv itself declines; not this wrapper's concern
          if (!wrapped.ok) return false; // wrapper diverged where invertIv converged — bug

          return Math.abs(wrapped.value - direct.value) < 1e-9;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Live-tick trust shortcut (Pitfall 2)
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — live-tick trust shortcut (Pitfall 2)", () => {
  it("trusts liveTick.bsmIv verbatim when a live tick is present — never re-runs invertIv", () => {
    const liveTick = { mark: 42.5, bsmIv: 0.2137 };

    // restMarketValue/netQty deliberately degenerate (would fail REST fallback) to prove
    // the live-tick branch short-circuits before ever touching the REST fallback path.
    const result = resolveLegIv(LIQUID_OCC, LIQUID_SPOT, R, Q, liveTick, null, 0, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(liveTick.bsmIv);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Deep-ITM / illiquid non-convergence
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — non-convergence (deep-ITM / illiquid)", () => {
  it("returns a tagged IvError — never a number, never DEFAULT_IV/0.18", () => {
    // Force a REST-derived price far above the no-arb upper bound (above-bound guard).
    const restMarketValue = 10_000_000; // price = 10_000_000 / (1 * 100) = 100_000
    const netQty = 1;

    const result = resolveLegIv(LIQUID_OCC, LIQUID_SPOT, R, Q, null, restMarketValue, netQty, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).not.toBe("no-price");
      expect(["expired", "below-intrinsic", "above-bound"]).toContain(result.error.kind);
    }
    expect(typeof result).not.toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Cold-start (no tick, marketValue === null) — distinct from non-convergence
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — cold-start (Pitfall 2)", () => {
  it("returns err({kind:'no-price'}) when no live tick AND restMarketValue is null", () => {
    const result = resolveLegIv(LIQUID_OCC, LIQUID_SPOT, R, Q, null, null, 1, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("no-price");
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 5. netQty === 0 REST fallback — Pitfall 3 guard
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — netQty===0 REST fallback (Pitfall 3)", () => {
  it("returns err({kind:'no-price'}) and never computes NaN/Infinity", () => {
    const result = resolveLegIv(LIQUID_OCC, LIQUID_SPOT, R, Q, null, 5000, 0, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("no-price");
    }
    // Guard short-circuits before any division — assert no NaN/Infinity ever surfaces.
    if (result.ok) {
      expect(Number.isFinite(result.value)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Expired leg (T <= 0)
// ─────────────────────────────────────────────────────────────
describe("resolveLegIv — expired leg", () => {
  it("returns err({kind:'expired'}) when the parsed expiry is at/before now", () => {
    const pastExpiry = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const occSymbol = buildOcc(7550, pastExpiry, "C");

    const result = resolveLegIv(occSymbol, LIQUID_SPOT, R, Q, null, 100, 1, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("expired");
    }
  });
});
