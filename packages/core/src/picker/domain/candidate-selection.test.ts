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
  BACK_DTE_MAX_GAP,
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
  liquidity: { bid: number; ask: number; openInterest: number } = {
    bid: 99,
    ask: 101,
    openInterest: 1000,
  },
): ChainQuoteForPicker {
  return {
    time: new Date("2026-07-01T14:30:00.000Z"),
    strike: strikePoints * 1000,
    expiration,
    contractType,
    underlyingPrice,
    bsmIv: String(iv),
    bid: liquidity.bid,
    ask: liquidity.ask,
    openInterest: liquidity.openInterest,
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
  it("exposes the user-locked delta rungs: −0.50…−0.25 in 0.05 steps", () => {
    expect(DELTA_RUNGS.map((rung) => rung.targetDelta)).toEqual([
      -0.5, -0.45, -0.4, -0.35, -0.3, -0.25,
    ]);
  });

  it("only pairs front legs in [21,36] DTE with back legs where the gap is in [21,35] days — ALL qualifying backs kept", () => {
    // Front expiries at dte 20 (too early), 30 (valid), 40 (too late).
    // Backs from the 30-dte front: gap 15 (too tight), gap 26 (valid), gap 33 (valid),
    // gap 46 (beyond the 35d cap).
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    const expiries = {
      "2026-07-21": 20, // too-early front
      "2026-07-31": 30, // valid front
      "2026-08-10": 40, // too-late front
      "2026-08-15": 45, // gap 15 from the 30-dte front → too tight
      "2026-08-26": 56, // gap 26 → valid back
      "2026-09-02": 63, // gap 33 → valid back (second qualifying back, must ALSO be kept)
      "2026-09-15": 76, // gap 46 → beyond the 35d gap cap
    };
    for (const expiration of Object.keys(expiries)) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    // Re-anchor "today" so the dte map above holds: today = 2026-07-01.
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });

    const frontExpiries = new Set(candidates.map((c) => c.frontLeg.expiration));
    expect(frontExpiries.has("2026-07-21")).toBe(false); // dte 20 < 21
    expect(frontExpiries.has("2026-08-10")).toBe(false); // dte 40 > 36
    expect(frontExpiries.has("2026-07-31")).toBe(true); // dte 30, valid

    for (const c of candidates) {
      expect(c.frontLeg.dte).toBeGreaterThanOrEqual(FRONT_DTE_MIN);
      expect(c.frontLeg.dte).toBeLessThanOrEqual(FRONT_DTE_MAX);
      expect(c.backLeg.dte - c.frontLeg.dte).toBeGreaterThanOrEqual(BACK_DTE_MIN_GAP);
      expect(c.backLeg.dte - c.frontLeg.dte).toBeLessThanOrEqual(BACK_DTE_MAX_GAP);
    }

    const frontThirty = candidates.filter((c) => c.frontLeg.expiration === "2026-07-31");
    // The 30-dte front never pairs with the gap-15 back (too tight) nor the gap-46 back (too wide).
    expect(frontThirty.every((c) => c.backLeg.expiration !== "2026-08-15")).toBe(true);
    expect(frontThirty.every((c) => c.backLeg.expiration !== "2026-09-15")).toBe(true);
    // ALL qualifying backs are kept (user lock: keep all pairs — fwd-edge scoring ranks them).
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-08-26")).toBe(true);
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-09-02")).toBe(true);
  });

  it("snaps every candidate strike to a 25-point multiple even when the chain lists 5-point strikes", () => {
    const iv = 0.15;
    // 5-point grid around the money — resolved nearest-delta strikes will often land on
    // off-25 strikes (7495, 7480, …); the universe must snap them to 25s (user lock: OI/volume
    // concentrate on 25-multiples).
    const strikes = [7530, 7525, 7520, 7515, 7510, 7505, 7500, 7495, 7490, 7485, 7480, 7475, 7450, 7425, 7400, 7375, 7350, 7325];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.frontLeg.strike % 25).toBe(0);
      expect(c.backLeg.strike % 25).toBe(0);
    }
  });

  it("caps the universe at the 1σ front expected move: spot − K ≤ spot·σ_f·√(t_f/365)", () => {
    // Low iv → tight EM: 7500·0.08·√(30/365) ≈ 172 pts → strikes below ~7328 are beyond 1σ
    // and must be excluded even though the −0.25Δ rung would otherwise reach for them.
    const iv = 0.08;
    const strikes = [7500, 7475, 7450, 7425, 7400, 7375, 7350, 7325, 7300, 7275, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      const em = c.spot * c.frontLeg.iv * Math.sqrt(c.frontLeg.dte / 365);
      expect(c.spot - c.frontLeg.strike).toBeLessThanOrEqual(em);
    }
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
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates.length).toBe(0);
  });

  it("collapses post-snap duplicates: two rungs snapping to the same (strike, front, back) yield ONE candidate", () => {
    const iv = 0.15;
    const chain: ChainQuoteForPicker[] = [];
    // Only ONE strike available on the whole chain — every delta rung resolves (and snaps)
    // to this same strike. The post-snap dedupe on (strike, frontExpiry, backExpiry) must
    // collapse them all to a single candidate (duplicate rows on the rail were the user's
    // original complaint).
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      chain.push(chainQuote(7500, expiration, iv));
    }
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    const frontThirty = candidates.filter((c) => c.frontLeg.expiration === "2026-07-31");

    expect(frontThirty.length).toBe(1);
    const ids = candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique across the whole universe
  });
});

describe("gates — liquidity + drop counts (rules.ts registry)", () => {
  it("excludes illiquid quotes (wide spread / thin OI) from the universe and counts them", () => {
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        // 7500 quotes are untradeable: 40% spread. Everything else is liquid.
        const liquidity =
          strike === 7500
            ? { bid: 8, ask: 12, openInterest: 5000 }
            : { bid: 99, ask: 101, openInterest: 1000 };
        chain.push(chainQuote(strike, expiration, iv, "P", SPOT, liquidity));
      }
    }

    const { candidates, gateDrops } = selectCandidates(chain, [], { r: R, q: Q });

    // Both expiries' 7500 quotes were dropped (2 quotes).
    expect(gateDrops.liquidity).toBe(2);
    // No surviving candidate can sit on the gated strike.
    for (const c of candidates) {
      expect(c.frontLeg.strike).not.toBe(7500);
      expect(c.backLeg.strike).not.toBe(7500);
    }
    // The rest of the chain still produces candidates (the gate is surgical, not a wipeout).
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("thin open interest alone gates a quote", () => {
    const iv = 0.15;
    const chain: ChainQuoteForPicker[] = [
      chainQuote(7500, "2026-07-31", iv, "P", SPOT, { bid: 99, ask: 101, openInterest: 10 }),
      chainQuote(7500, "2026-08-26", iv, "P", SPOT, { bid: 99, ask: 101, openInterest: 10 }),
    ];
    const { candidates, gateDrops } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates).toHaveLength(0);
    expect(gateDrops.liquidity).toBe(2);
  });

  it("net-theta gate drops are counted (never a silent cap)", () => {
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const strike of strikes) {
      chain.push(chainQuote(strike, "2026-07-31", 0.05, "P"));
      chain.push(chainQuote(strike, "2026-08-21", 2.5, "P"));
    }
    const { candidates, gateDrops } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates).toHaveLength(0);
    expect(gateDrops.netTheta).toBeGreaterThan(0);
    expect(gateDrops.liquidity).toBe(0);
  });
});
