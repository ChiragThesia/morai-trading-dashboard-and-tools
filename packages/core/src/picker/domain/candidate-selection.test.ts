/**
 * candidate-selection tests (Phase 19, Plan 03) — example + fast-check property, per tdd.md
 * numerical rule.
 *
 * Covers:
 *   - Band-scan universe: every liquid 25-multiple with front delta in [−0.55, −0.25]
 *     (membership test — rung-gap misses like the user's 7450 are structurally impossible).
 *   - Quote-based debit with the ORATS 2-leg 66%-of-width fill haircut.
 *   - Hard gates: net-theta, per-pair term inversion, tier-1 event blackout (≤3d before
 *     front expiry) — all counted in gateDrops, never silent.
 *   - legSpansEvents is a pure ISO-string-interval membership test (Pitfall 3), fast-check
 *     covered for arbitrary date sets.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import {
  legSpansEvents,
  selectCandidates,
  haircutFill,
  autoTuneTargetDelta,
  DELTA_BAND_MIN,
  DELTA_BAND_MAX,
  FRONT_DTE_MIN,
  FRONT_DTE_MAX,
  BACK_DTE_MIN_GAP,
  BACK_DTE_MAX_GAP,
  FILL_WIDTH_FRACTION,
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
  it("band-scan: emits EVERY liquid 25-multiple whose front delta is inside [−0.55, −0.25]", () => {
    // Dense 25-pt grid: the old nearest-delta rungs skipped strikes whose delta fell between
    // rung targets (the user's real 7450 fill at Δ−0.43 was missed). Band MEMBERSHIP must
    // emit them all.
    const iv = 0.15;
    const strikes = [7550, 7525, 7500, 7475, 7450, 7425, 7400, 7375, 7350, 7325, 7300, 7275, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    const ks = new Set(candidates.map((c) => c.frontLeg.strike));
    // Contiguous run of in-band strikes — no rung gaps.
    expect(ks.has(7450)).toBe(true);
    expect(ks.has(7425)).toBe(true);
    expect(ks.has(7400)).toBe(true);
    // Every emitted strike's front delta is inside the band.
    for (const c of candidates) {
      const d = bsmGreeks(c.spot, c.frontLeg.strike, c.frontLeg.dte / 365, c.frontLeg.iv, R, Q, "P").delta;
      expect(d).toBeLessThanOrEqual(DELTA_BAND_MAX + 1e-9);
      expect(d).toBeGreaterThanOrEqual(DELTA_BAND_MIN - 1e-9);
    }
  });

  it("prices the debit from quotes with the ORATS 2-leg haircut (cross 66% of width), not BSM theory", () => {
    const iv = 0.15;
    const chain: ChainQuoteForPicker[] = [
      chainQuote(7450, "2026-07-31", iv, "P", SPOT, { bid: 80, ask: 84, openInterest: 1000 }),
      chainQuote(7450, "2026-08-26", iv, "P", SPOT, { bid: 120, ask: 126, openInterest: 1000 }),
    ];
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c).toBeDefined();
    if (c === undefined) return;
    // Buy back: bid + 0.66·width = 120 + 3.96 = 123.96; sell front: ask − 0.66·width = 84 − 2.64 = 81.36.
    // Debit = (123.96 − 81.36) × 100 = 4260.
    expect(c.debit).toBeCloseTo(4260, 0);
  });

  it("KEEPS front-rich (mildly inverted) pairs — the entry edge; scoring ranks them (gate retired 2026-07-09)", () => {
    const chain: ChainQuoteForPicker[] = [
      chainQuote(7450, "2026-07-31", 0.17, "P"), // front slightly richer than back — the good entry
      chainQuote(7450, "2026-08-26", 0.15, "P"),
    ];
    const { candidates, gateDrops } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates).toHaveLength(1);
    expect(gateDrops.termInverted).toBe(0);
  });

  it("keeps pairs with a tier-1 event in the front's final 3 days but stamps exitBeforeIso (EVT exit discipline, 2026-07-09)", () => {
    const iv = 0.15;
    const chain: ChainQuoteForPicker[] = [
      chainQuote(7450, "2026-07-31", iv, "P"),
      chainQuote(7450, "2026-08-26", iv, "P"),
    ];
    // FOMC 2 days before the 2026-07-31 front expiry → candidate KEPT, hard exit the day
    // before the event (the user's own 7450 fill entered exactly this structure).
    const events: EconomicEvent[] = [{ date: "2026-07-29", name: "FOMC", source: "seed" }];
    const { candidates, gateDrops } = selectCandidates(chain, events, { r: R, q: Q });
    expect(candidates).toHaveLength(1);
    expect(gateDrops.eventBlackout).toBe(0);
    expect(candidates[0]?.exitBeforeIso).toBe("2026-07-28");

    // An event 10 days before expiry sets no early exit.
    const eventsFar: EconomicEvent[] = [{ date: "2026-07-21", name: "FOMC", source: "seed" }];
    const ok = selectCandidates(chain, eventsFar, { r: R, q: Q });
    expect(ok.candidates).toHaveLength(1);
    expect(ok.candidates[0]?.exitBeforeIso).toBeNull();
  });

  it("only pairs front legs in [21,36] DTE with back legs where the gap is in [15,90] days — ALL qualifying backs kept", () => {
    // Front expiries at dte 20 (too early), 30 (valid), 40 (too late).
    // Backs from the 30-dte front: gap 15/26/33/46 all valid in the [15,90] window;
    // an extra dte-130 expiry (gap 100) exceeds the 90d cap.
    const iv = 0.15;
    const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
    const chain: ChainQuoteForPicker[] = [];
    const expiries = {
      "2026-07-21": 20, // too-early front
      "2026-07-31": 30, // valid front
      "2026-08-10": 40, // too-late front
      "2026-08-15": 45, // gap 15 → valid (min gap now 15)
      "2026-08-26": 56, // gap 26 → valid back
      "2026-09-02": 63, // gap 33 → valid back (second qualifying back, must ALSO be kept)
      "2026-11-08": 130, // gap 100 → beyond the 90d gap cap
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
    // The 30-dte front never pairs beyond the 90d gap cap.
    expect(frontThirty.every((c) => c.backLeg.expiration !== "2026-11-08")).toBe(true);
    // ALL qualifying backs are kept (user lock: keep all pairs — scoring ranks them).
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-08-15")).toBe(true);
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-08-26")).toBe(true);
    expect(frontThirty.some((c) => c.backLeg.expiration === "2026-09-02")).toBe(true);
  });

  it("admits liquid OFF-25 strikes — liquidity decides membership, not the 25-grid (2026-07-09 user lock)", () => {
    const iv = 0.15;
    // A liquid 5-point strike inside the delta band must enter the universe alongside 25s.
    const strikes = [7430, 7425, 7400, 7375, 7350];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    const { candidates } = selectCandidates(chain, [], { r: R, q: Q });
    expect(candidates.some((c) => c.frontLeg.strike === 7430)).toBe(true);
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

describe("haircutFill (Phase 26, extracted for exits/ROLL pricing reuse — Pitfall 2)", () => {
  it("buy: crosses FILL_WIDTH_FRACTION of the width UP toward the ask", () => {
    // bid 120, ask 126, width 6 -> 120 + 0.66*6 = 123.96
    expect(haircutFill({ bid: 120, ask: 126 }, "buy")).toBeCloseTo(123.96, 6);
  });

  it("sell: crosses FILL_WIDTH_FRACTION of the width DOWN toward the bid", () => {
    // bid 80, ask 84, width 4 -> 84 - 0.66*4 = 81.36
    expect(haircutFill({ bid: 80, ask: 84 }, "sell")).toBeCloseTo(81.36, 6);
  });

  it("zero-width market: both sides return the price exactly", () => {
    expect(haircutFill({ bid: 100, ask: 100 }, "buy")).toBe(100);
    expect(haircutFill({ bid: 100, ask: 100 }, "sell")).toBe(100);
  });

  it("uses the exported FILL_WIDTH_FRACTION constant (never a hardcoded 0.66)", () => {
    const quote = { bid: 10, ask: 20 };
    expect(haircutFill(quote, "buy")).toBeCloseTo(quote.bid + (quote.ask - quote.bid) * FILL_WIDTH_FRACTION, 9);
    expect(haircutFill(quote, "sell")).toBeCloseTo(quote.ask - (quote.ask - quote.bid) * FILL_WIDTH_FRACTION, 9);
  });
});

// ─────────────────────────────────────────────────────────────
// autoTuneTargetDelta (28-04, PLAY-05) — VIX-tuned deep band-edge nudge, thin directional
// evidence, milestone time-box permits shipping the smallest version or deferring.
// ─────────────────────────────────────────────────────────────

describe("autoTuneTargetDelta", () => {
  it("returns DELTA_BAND_MIN unchanged at/below the tuning floor (VIX 15)", () => {
    expect(autoTuneTargetDelta(10)).toBe(DELTA_BAND_MIN);
    expect(autoTuneTargetDelta(15)).toBe(DELTA_BAND_MIN);
  });

  it("returns DELTA_BAND_MAX at/above the tuning ceiling (VIX 25 -- the gate's own crisis floor)", () => {
    expect(autoTuneTargetDelta(25)).toBe(DELTA_BAND_MAX);
    expect(autoTuneTargetDelta(40)).toBe(DELTA_BAND_MAX);
  });

  it("interpolates linearly between the floor and ceiling", () => {
    // Midpoint of the 15-25 tuning range -> midpoint of the delta band.
    const mid = autoTuneTargetDelta(20);
    expect(mid).toBeCloseTo((DELTA_BAND_MIN + DELTA_BAND_MAX) / 2, 9);
  });

  it("null/NaN vix -> no tilt, DELTA_BAND_MIN unchanged", () => {
    expect(autoTuneTargetDelta(null)).toBe(DELTA_BAND_MIN);
    expect(autoTuneTargetDelta(Number.NaN)).toBe(DELTA_BAND_MIN);
  });

  it("property: for any finite vix, the result never leaves [DELTA_BAND_MIN, DELTA_BAND_MAX]", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 200, noNaN: true }), (vix) => {
        const target = autoTuneTargetDelta(vix);
        expect(target).toBeGreaterThanOrEqual(DELTA_BAND_MIN - 1e-9);
        expect(target).toBeLessThanOrEqual(DELTA_BAND_MAX + 1e-9);
      }),
    );
  });
});

describe("selectCandidates — effectiveDeltaMin (28-04, PLAY-05 wiring)", () => {
  function denseChain(): ChainQuoteForPicker[] {
    const iv = 0.15;
    const strikes = [7550, 7525, 7500, 7475, 7450, 7425, 7400, 7375, 7350, 7325, 7300, 7275, 7250];
    const chain: ChainQuoteForPicker[] = [];
    for (const expiration of ["2026-07-31", "2026-08-26"]) {
      for (const strike of strikes) {
        chain.push(chainQuote(strike, expiration, iv));
      }
    }
    return chain;
  }

  it("omitting effectiveDeltaMin reproduces the DELTA_BAND_MIN universe byte-identically", () => {
    const withDefault = selectCandidates(denseChain(), [], { r: R, q: Q });
    const withExplicitMin = selectCandidates(denseChain(), [], { r: R, q: Q, effectiveDeltaMin: DELTA_BAND_MIN });
    expect(withDefault.candidates).toEqual(withExplicitMin.candidates);
  });

  it("a narrower effectiveDeltaMin (high-VIX tilt) drops the deepest strikes, keeps the shallow ones", () => {
    const full = selectCandidates(denseChain(), [], { r: R, q: Q });
    const tilted = selectCandidates(denseChain(), [], {
      r: R,
      q: Q,
      effectiveDeltaMin: autoTuneTargetDelta(25), // crisis-floor VIX -> the far edge, DELTA_BAND_MAX
    });
    expect(tilted.candidates.length).toBeLessThan(full.candidates.length);
    for (const c of tilted.candidates) {
      const d = bsmGreeks(c.spot, c.frontLeg.strike, c.frontLeg.dte / 365, c.frontLeg.iv, R, Q, "P").delta;
      expect(d).toBeGreaterThanOrEqual(DELTA_BAND_MAX - 1e-9);
    }
  });

  it("an effectiveDeltaMin outside the band is clamped -- the effective delta never leaves [DELTA_BAND_MIN, DELTA_BAND_MAX]", () => {
    const clampedLow = selectCandidates(denseChain(), [], { r: R, q: Q, effectiveDeltaMin: -10 });
    const withDefault = selectCandidates(denseChain(), [], { r: R, q: Q });
    expect(clampedLow.candidates).toEqual(withDefault.candidates);

    const clampedHigh = selectCandidates(denseChain(), [], { r: R, q: Q, effectiveDeltaMin: 10 });
    for (const c of clampedHigh.candidates) {
      const d = bsmGreeks(c.spot, c.frontLeg.strike, c.frontLeg.dte / 365, c.frontLeg.iv, R, Q, "P").delta;
      expect(d).toBeLessThanOrEqual(DELTA_BAND_MAX + 1e-9);
    }
  });
});
