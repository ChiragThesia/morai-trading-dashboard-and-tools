/**
 * candidate-selection tests (Phase 19, Plan 03) — example + fast-check property, per tdd.md
 * numerical rule.
 *
 * Covers:
 *   - nearestStrikeByDelta picks the strike whose bsmGreeks put delta is closest to each
 *     target rung (ATM/-0.30/-0.20/-0.10).
 *   - selectCandidates only pairs front legs with DTE in [21,36] and back legs with
 *     (backDTE - frontDTE) >= 21 and backDTE <= 80.
 *   - selectCandidates drops any calendar with net theta <= 0 (criterion 6).
 *   - legSpansEvents is a pure ISO-string-interval membership test (Pitfall 3), fast-check
 *     covered for arbitrary date sets.
 *   - selectCandidates dedupes to one candidate per (deltaRung, frontExpiry) — keyed on the
 *     rung label, never on the resolved strike value (Pitfall 5).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import {
  nearestStrikeByDelta,
  legSpansEvents,
  selectCandidates,
  DELTA_RUNGS,
  FRONT_DTE_MIN,
  FRONT_DTE_MAX,
  BACK_DTE_MIN_GAP,
  BACK_DTE_MAX,
} from "./candidate-selection.ts";
import type { ChainQuoteForPicker, EconomicEvent } from "../application/ports.ts";

const SPOT = 7500;
const R = 0.04;
const Q = 0.013;

// ─────────────────────────────────────────────────────────────
// Synthetic chain builder — strike is the ×1000 int convention (Pitfall 1); the domain
// converts it to points once at the selectCandidates boundary.
// ─────────────────────────────────────────────────────────────
function chainQuote(
  strikePoints: number,
  expiration: string,
  iv: number,
  contractType: "C" | "P" = "P",
  underlyingPrice: number = SPOT,
): ChainQuoteForPicker {
  return {
    time: new Date("2026-07-01T14:30:00.000Z"),
    strike: strikePoints * 1000,
    expiration,
    contractType,
    underlyingPrice,
    bsmIv: String(iv),
    source: "schwab",
  };
}

// asOf resolves from the cohort's own `time` field, snapped to the UTC calendar day —
// 2026-07-01 is "today" for every fixture chain below.
const TODAY = "2026-07-01";

describe("nearestStrikeByDelta", () => {
  it("picks the strike whose bsmGreeks put delta is closest to each target rung", () => {
    const dte = 30;
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const quotes = strikes.map((strike) => ({ strike, iv }));

    for (const rung of DELTA_RUNGS) {
      const pick = nearestStrikeByDelta(quotes, SPOT, dte, rung.targetDelta, R, Q);
      expect(pick).not.toBeNull();
      if (pick === null) continue;

      // The picked strike must be at least as close (in delta space) to the target as every
      // other strike on the chain — proves "nearest", not just "some" strike.
      const pickedDiff = Math.abs(
        bsmGreeks(SPOT, pick.strike, dte / 365, pick.iv, R, Q, "P").delta - rung.targetDelta,
      );
      for (const q of quotes) {
        const diff = Math.abs(bsmGreeks(SPOT, q.strike, dte / 365, q.iv, R, Q, "P").delta - rung.targetDelta);
        expect(pickedDiff).toBeLessThanOrEqual(diff);
      }
    }
  });

  it("returns null for an empty quote list", () => {
    expect(nearestStrikeByDelta([], SPOT, 30, -0.3, R, Q)).toBeNull();
  });
});

describe("legSpansEvents", () => {
  it("returns exactly the events whose date is in (today, legExpiry]", () => {
    const events: ReadonlyArray<EconomicEvent> = [
      { date: "2026-06-30", name: "FOMC", source: "seed" }, // before today -> excluded
      { date: "2026-07-01", name: "CPI", source: "fred" }, // === today -> excluded (open lower bound)
      { date: "2026-07-15", name: "NFP", source: "fred" }, // inside window
      { date: "2026-07-23", name: "FOMC", source: "seed" }, // === expiry -> included (closed upper bound)
      { date: "2026-07-24", name: "CPI", source: "fred" }, // after expiry -> excluded
    ];
    const result = legSpansEvents("2026-07-23", TODAY, events);
    expect(result).toEqual(["NFP", "FOMC"]);
  });

  it("property: every returned name's event date is strictly after today and <= expiry", () => {
    const isoDateArb = fc
      .tuple(
        fc.integer({ min: 2026, max: 2027 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      )
      .map(([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

    fc.assert(
      fc.property(
        isoDateArb,
        isoDateArb,
        fc.array(fc.record({ date: isoDateArb, name: fc.constantFrom("FOMC", "CPI", "NFP") }), {
          maxLength: 10,
        }),
        (today, expiry, events) => {
          const typedEvents: ReadonlyArray<EconomicEvent> = events.map((e) => ({
            ...e,
            source: "seed" as const,
          }));
          const result = legSpansEvents(expiry, today, typedEvents);
          for (const name of result) {
            const matching = typedEvents.filter((e) => e.name === name);
            const anyInWindow = matching.some((e) => today < e.date && e.date <= expiry);
            expect(anyInWindow).toBe(true);
          }
        },
      ),
    );
  });
});

describe("selectCandidates", () => {
  it("only pairs front legs in [21,36] DTE with back legs where (backDTE-frontDTE)>=21 and backDTE<=80", () => {
    // Front expiries at dte 20 (too early), 30 (valid), 40 (too late).
    // Back expiries at dte 45 (valid gap+cap from the 30-dte front), 95 (gap ok but > 80 cap).
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    const expiries = {
      "2026-07-21": 20, // too-early front
      "2026-07-31": 30, // valid front
      "2026-08-10": 40, // too-late front
      "2026-08-15": 45, // valid back (45-30=15 <21, so NOT a valid pair for the 30-dte front either)
      "2026-08-26": 56, // valid back for the 30-dte front (56-30=26 >=21, <=80)
      "2026-10-04": 95, // gap ok (95-30=65>=21) but dte 95 > 80 cap -> excluded
    };
    for (const expiration of Object.keys(expiries)) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    // Re-anchor "today" so the dte map above holds: today = 2026-07-01.
    const candidates = selectCandidates(chain, [], { r: R, q: Q });

    const frontExpiries = new Set(candidates.map((c) => c.frontLeg.expiration));
    expect(frontExpiries.has("2026-07-21")).toBe(false); // dte 20 < 21
    expect(frontExpiries.has("2026-08-10")).toBe(false); // dte 40 > 36
    expect(frontExpiries.has("2026-07-31")).toBe(true); // dte 30, valid

    for (const c of candidates) {
      expect(c.frontLeg.dte).toBeGreaterThanOrEqual(FRONT_DTE_MIN);
      expect(c.frontLeg.dte).toBeLessThanOrEqual(FRONT_DTE_MAX);
      expect(c.backLeg.dte - c.frontLeg.dte).toBeGreaterThanOrEqual(BACK_DTE_MIN_GAP);
      expect(c.backLeg.dte).toBeLessThanOrEqual(BACK_DTE_MAX);
    }

    // The 30-dte front never pairs with the 45-dte back (gap only 15 days).
    const frontThirty = candidates.filter((c) => c.frontLeg.expiration === "2026-07-31");
    expect(frontThirty.every((c) => c.backLeg.expiration !== "2026-08-15")).toBe(true);
    // It DOES pair with the 56-dte back (gap 26 days, within [21,80] window from front).
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-08-26")).toBe(true);
    // Never with the 95-dte expiry (95 > BACK_DTE_MAX).
    expect(frontThirty.every((c) => c.backLeg.expiration !== "2026-10-04")).toBe(true);
  });

  it("drops any calendar with net theta <= 0 (criterion 6)", () => {
    // A pathological chain where the BACK leg carries a vastly higher iv than the front
    // (0.05 front vs 2.5 back) at the same strike/dte pairing (front dte 30, back dte 51,
    // gap 21). The back leg's much larger vega/theta-decay magnitude makes net theta
    // (backTheta - frontTheta) negative at every strike (verified via a probe script against
    // the real bsmGreeks engine) -- every candidate for this pair must be dropped.
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const strike of strikes) {
      chain.push(chainQuote(strike, "2026-07-31", 0.05, "P")); // front: dte 30, low iv
      chain.push(chainQuote(strike, "2026-08-21", 2.5, "P")); // back: dte 51, extreme iv
    }
    const candidates = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates.length).toBe(0);
  });

  it("dedupes to one candidate per (deltaRung, frontExpiry), never keyed on resolved strike", () => {
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    const expiries = ["2026-07-31", "2026-08-26", "2026-09-15"]; // front dte30; two valid backs (dte56, dte76)
    for (const expiration of expiries) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    const candidates = selectCandidates(chain, [], { r: R, q: Q });
    const frontThirty = candidates.filter((c) => c.frontLeg.expiration === "2026-07-31");
    const keys = frontThirty.map((c) => c.deltaRung);
    const uniqueKeys = new Set(keys);
    // Exactly one candidate per delta rung for this front expiry -- never more than
    // DELTA_RUNGS.length entries, proving the (deltaRung, frontExpiry) dedupe collapsed the
    // two valid back-expiry choices (dte56 and dte76) down to one each.
    expect(keys.length).toBe(uniqueKeys.size);
    expect(keys.length).toBeLessThanOrEqual(DELTA_RUNGS.length);
  });
});
