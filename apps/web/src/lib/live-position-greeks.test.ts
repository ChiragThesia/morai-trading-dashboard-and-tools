/**
 * live-position-greeks.test.ts — TDD suite for resolveLivePositionRow
 *
 * Tests the pure live-or-static per-row greek resolver that the Overview
 * positions table uses to overlay live SSE ticks onto static polled values.
 *
 * Tests:
 *   1. Property (fast-check): empty liveGreeks Map → byte-identical to Overview's
 *      existing static math (netGreeksForLegs / netValue / netUnreal).
 *   2. Single long leg WITH tick → delta, netVal, unreal, liveTs from tick.
 *   3. Short leg WITH tick → netVal is negative (signed by netQty).
 *   4. Mixed legs (one with tick, one without) → contributions sum; liveTs = tick.ts.
 *   5. averagePrice === null + no tick → unreal is null.
 *   6. Property (fast-check): never throws for arbitrary finite inputs;
 *      liveTs is null iff no leg had a tick.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { BrokerPositionResponse, StreamLiveGreekEvent } from "@morai/contracts";
import { resolveLivePositionRow } from "./live-position-greeks.ts";
import { computePositionGreeks } from "./position-greeks.ts";

// ─── Constants (must match the resolver — same as Overview.tsx) ───────────────

const DEFAULT_IV = 0.18;
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

// ─── Static helpers (mirroring Overview.tsx — used by the equivalence test) ───

type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

function netGreeksForLegs(
  legs: ReadonlyArray<BrokerPositionResponse>,
  spot: number,
): NetGreeks {
  const acc: NetGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const r = computePositionGreeks({
      occSymbol: leg.occSymbol,
      spot,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty: leg.longQty,
      shortQty: leg.shortQty,
    });
    if (!r.ok) continue;
    // Mirrors Overview.netGreeksForLegs: computePositionGreeks already applied netQty,
    // so apply ONLY the ×100 contract multiplier (CR-01).
    acc.delta += r.value.greeks.delta * 100;
    acc.gamma += r.value.greeks.gamma * 100;
    acc.theta += r.value.greeks.theta * 100;
    acc.vega += r.value.greeks.vega * 100;
  }
  return acc;
}

function netValue(legs: ReadonlyArray<BrokerPositionResponse>): number {
  return legs.reduce((s, l) => s + (l.marketValue ?? 0), 0);
}

function netUnreal(legs: ReadonlyArray<BrokerPositionResponse>): number | null {
  let total = 0;
  for (const l of legs) {
    if (l.marketValue === null || l.averagePrice === null) return null;
    total += l.marketValue - l.averagePrice * (l.longQty - l.shortQty) * 100;
  }
  return total;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** SPX 7400P expiring 2026-06-12 */
const OCC_LONG = "SPX   260612P07400000";
/** SPXW 7425P expiring 2026-08-07 */
const OCC_SHORT = "SPXW  260807P07425000";

function makeLongLeg(overrides: Partial<BrokerPositionResponse> = {}): BrokerPositionResponse {
  return {
    occSymbol: OCC_LONG,
    putCall: "P",
    longQty: 1,
    shortQty: 0,
    averagePrice: 12.5,
    marketValue: 1800,
    underlyingSymbol: "SPX",
    ...overrides,
  };
}

function makeShortLeg(overrides: Partial<BrokerPositionResponse> = {}): BrokerPositionResponse {
  return {
    occSymbol: OCC_SHORT,
    putCall: "P",
    longQty: 0,
    shortQty: 1,
    averagePrice: 127.0478,
    marketValue: -17875,
    underlyingSymbol: "$SPX",
    ...overrides,
  };
}

function makeTick(
  occSymbol: string,
  overrides: Partial<StreamLiveGreekEvent> = {},
): StreamLiveGreekEvent {
  return {
    occSymbol,
    mark: 20.5,
    bid: 20.0,
    ask: 21.0,
    bsmIv: 0.21,
    bsmDelta: -0.35,
    bsmGamma: 0.004,
    bsmTheta: -0.15,
    bsmVega: 1.8,
    ts: "2026-06-29T14:31:00Z",
    ...overrides,
  };
}

const SPOT = 5800;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveLivePositionRow", () => {

  // 1. Property: empty Map → byte-identical to Overview static math
  it("(property) empty liveGreeks → output is byte-identical to Overview static math", () => {
    const legs = [makeLongLeg(), makeShortLeg()];
    const emptyMap: ReadonlyMap<string, StreamLiveGreekEvent> = new Map();

    fc.assert(
      fc.property(
        fc.float({ min: 5000, max: 7000, noNaN: true }),
        (spot: number) => {
          const result = resolveLivePositionRow(legs, spot, emptyMap);
          const expectedGreeks = netGreeksForLegs(legs, spot);
          const expectedVal = netValue(legs);
          const expectedUnreal = netUnreal(legs);

          expect(result.greeks.delta).toBeCloseTo(expectedGreeks.delta, 4);
          expect(result.greeks.gamma).toBeCloseTo(expectedGreeks.gamma, 4);
          expect(result.greeks.theta).toBeCloseTo(expectedGreeks.theta, 4);
          expect(result.greeks.vega).toBeCloseTo(expectedGreeks.vega, 4);
          expect(result.netVal).toBeCloseTo(expectedVal, 4);
          expect(result.unreal).toEqual(expectedUnreal);
          expect(result.liveTs).toBeNull();
        },
      ),
    );
  });

  // 2. Single long leg WITH tick
  it("single long leg WITH tick → greeks.delta = tick.bsmDelta × netQty × 100, netVal and unreal live-sourced, liveTs = tick.ts", () => {
    const leg = makeLongLeg();
    const tick = makeTick(OCC_LONG, { bsmDelta: -0.40, mark: 22.0 });
    const liveGreeks = new Map([[OCC_LONG, tick]]);

    const netQty = leg.longQty - leg.shortQty; // 1

    const result = resolveLivePositionRow([leg], SPOT, liveGreeks);

    expect(result.greeks.delta).toBeCloseTo(tick.bsmDelta * netQty * 100, 8);
    expect(result.greeks.gamma).toBeCloseTo(tick.bsmGamma * netQty * 100, 8);
    expect(result.greeks.theta).toBeCloseTo(tick.bsmTheta * netQty * 100, 8);
    expect(result.greeks.vega).toBeCloseTo(tick.bsmVega * netQty * 100, 8);
    expect(result.netVal).toBeCloseTo(tick.mark * netQty * 100, 8);
    expect(result.unreal).not.toBeNull();
    if (result.unreal !== null && leg.averagePrice !== null) {
      expect(result.unreal).toBeCloseTo((tick.mark - leg.averagePrice) * netQty * 100, 8);
    }
    expect(result.liveTs).toBe(tick.ts);
  });

  // 3. Short leg WITH tick → netVal is negative
  it("short leg WITH tick → netVal is negative (tick.mark × netQty × 100)", () => {
    const leg = makeShortLeg();
    const tick = makeTick(OCC_SHORT, { mark: 178.75 });
    const liveGreeks = new Map([[OCC_SHORT, tick]]);

    const netQty = leg.longQty - leg.shortQty; // -1

    const result = resolveLivePositionRow([leg], SPOT, liveGreeks);

    // tick.mark × (-1) × 100 → negative
    expect(result.netVal).toBeCloseTo(tick.mark * netQty * 100, 10);
    expect(result.netVal).toBeLessThan(0);
    expect(result.liveTs).toBe(tick.ts);
  });

  // 4. Mixed legs: one with tick, one without
  it("mixed legs (one with tick, one without) → contributions sum; liveTs = present tick's ts", () => {
    const longLeg = makeLongLeg();
    const shortLeg = makeShortLeg();
    const tick = makeTick(OCC_LONG);
    const liveGreeks = new Map([[OCC_LONG, tick]]);

    const result = resolveLivePositionRow([longLeg, shortLeg], SPOT, liveGreeks);

    // Long leg contribution (live): tick.bsmDelta × netQty × 100
    const longNetQty = longLeg.longQty - longLeg.shortQty; // 1
    const liveContrib = tick.bsmDelta * longNetQty * 100;

    // Short leg contribution (static): computePositionGreeks() already × netQty, then ×100
    const shortR = computePositionGreeks({
      occSymbol: shortLeg.occSymbol,
      spot: SPOT,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty: shortLeg.longQty,
      shortQty: shortLeg.shortQty,
    });
    const staticContrib = shortR.ok ? shortR.value.greeks.delta * 100 : 0;

    expect(result.greeks.delta).toBeCloseTo(liveContrib + staticContrib, 8);
    expect(result.liveTs).toBe(tick.ts);
  });

  // 5. averagePrice === null + no tick → unreal is null
  it("leg with averagePrice === null and no tick → unreal is null for the row", () => {
    const leg = makeLongLeg({ averagePrice: null });
    const emptyMap: ReadonlyMap<string, StreamLiveGreekEvent> = new Map();

    const result = resolveLivePositionRow([leg], SPOT, emptyMap);

    expect(result.unreal).toBeNull();
  });

  // 6. averagePrice === null WITH tick → unreal is still null (no basis for cost)
  it("leg with averagePrice === null WITH tick → unreal is null", () => {
    const leg = makeLongLeg({ averagePrice: null });
    const tick = makeTick(OCC_LONG);
    const liveGreeks = new Map([[OCC_LONG, tick]]);

    const result = resolveLivePositionRow([leg], SPOT, liveGreeks);

    expect(result.unreal).toBeNull();
    // But liveTs is still set from the tick
    expect(result.liveTs).toBe(tick.ts);
  });

  // 7. liveTs is the lexicographically greatest tick.ts across legs
  it("liveTs is the lexicographically greatest ts when multiple legs have ticks", () => {
    const longLeg = makeLongLeg();
    const shortLeg = makeShortLeg();
    const tick1 = makeTick(OCC_LONG, { ts: "2026-06-29T14:31:00Z" });
    const tick2 = makeTick(OCC_SHORT, { ts: "2026-06-29T14:31:05Z" });
    const liveGreeks = new Map([
      [OCC_LONG, tick1],
      [OCC_SHORT, tick2],
    ]);

    const result = resolveLivePositionRow([longLeg, shortLeg], SPOT, liveGreeks);

    // tick2.ts is later (lexicographically greater)
    expect(result.liveTs).toBe(tick2.ts);
  });

  // 8. Property: never throws; liveTs is null IFF no leg had a tick
  it("(property) never throws for arbitrary finite inputs; liveTs is null iff no leg had a tick", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 5000, max: 7000, noNaN: true }),
        fc.boolean(), // whether to include a tick
        (spot: number, hasTick: boolean) => {
          const leg = makeLongLeg();
          const liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent> = hasTick
            ? new Map([[OCC_LONG, makeTick(OCC_LONG)]])
            : new Map();

          let result: ReturnType<typeof resolveLivePositionRow>;
          expect(() => {
            result = resolveLivePositionRow([leg], spot, liveGreeks);
          }).not.toThrow();

          // liveTs is null IFF no tick was present
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          expect(result!.liveTs === null).toBe(!hasTick);
        },
      ),
    );
  });
});

// ─── CR-01 regression: greeks scale by netQty (×100), NOT netQty² (×nq) ────────
//
// computePositionGreeks already returns kernel × netQty (signed). The position greek
// is kernel × netQty × 100, so the static path multiplies by 100 (not nq = netQty×100)
// and the live path (raw per-share tick) multiplies by nq. Multiplying the static path
// by nq double-applies netQty: it over-scales magnitude for |netQty|>1 AND — because
// netQty² is always positive — drops the SIGN on short legs even at one lot.
// Every other fixture uses netQty = ±1 (netQty² == |netQty|), which hid both faults.
describe("resolveLivePositionRow — CR-01 net-qty scaling regression", () => {
  function staticGreeks(occSymbol: string, longQty: number, shortQty: number, spot: number) {
    const r = computePositionGreeks({
      occSymbol,
      spot,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty,
      shortQty,
    });
    if (!r.ok) throw new Error("fixture OCC parse failed");
    return r.value.greeks; // already kernel × netQty
  }

  it("static 2-lot long leg: greeks scale by ×100, not ×nq (×200)", () => {
    // OCC_SHORT is future-dated (Aug); OCC_LONG (Jun 12) is expired → zero greeks, vacuous.
    const leg = makeShortLeg({ occSymbol: OCC_SHORT, longQty: 2, shortQty: 0 });
    const expected = staticGreeks(OCC_SHORT, 2, 0, SPOT); // kernel × 2

    const result = resolveLivePositionRow([leg], SPOT, new Map());

    // position greek = (kernel × netQty) × 100. The bug computes × nq (= × 200).
    expect(result.greeks.delta).toBeCloseTo(expected.delta * 100, 8);
    expect(result.greeks.gamma).toBeCloseTo(expected.gamma * 100, 8);
    expect(result.greeks.theta).toBeCloseTo(expected.theta * 100, 8);
    expect(result.greeks.vega).toBeCloseTo(expected.vega * 100, 8);
  });

  it("live 2-lot long leg: greeks = tick.bsm* × netQty × 100, not × netQty² (×400)", () => {
    const leg = makeLongLeg({ longQty: 2, shortQty: 0 });
    const tick = makeTick(OCC_LONG);
    const netQty = 2;

    const result = resolveLivePositionRow([leg], SPOT, new Map([[OCC_LONG, tick]]));

    expect(result.greeks.delta).toBeCloseTo(tick.bsmDelta * netQty * 100, 8);
    expect(result.greeks.gamma).toBeCloseTo(tick.bsmGamma * netQty * 100, 8);
    expect(result.greeks.theta).toBeCloseTo(tick.bsmTheta * netQty * 100, 8);
    expect(result.greeks.vega).toBeCloseTo(tick.bsmVega * netQty * 100, 8);
  });

  it("static short 1-lot leg: greeks are signed by netQty (short put flips sign vs long)", () => {
    const leg = makeShortLeg(); // netQty -1
    const expected = staticGreeks(OCC_SHORT, 0, 1, SPOT); // kernel × (-1)

    const result = resolveLivePositionRow([leg], SPOT, new Map());

    // correct: expected × 100 (keeps short sign). The bug's × nq (= × -100) flips it.
    expect(result.greeks.delta).toBeCloseTo(expected.delta * 100, 8);
    expect(result.greeks.gamma).toBeCloseTo(expected.gamma * 100, 8);
  });

  it("live short 1-lot leg: greeks = tick.bsm* × netQty × 100 (signed by short netQty)", () => {
    const leg = makeShortLeg(); // netQty -1
    const tick = makeTick(OCC_SHORT);
    const netQty = -1;

    const result = resolveLivePositionRow([leg], SPOT, new Map([[OCC_SHORT, tick]]));

    expect(result.greeks.delta).toBeCloseTo(tick.bsmDelta * netQty * 100, 8);
    expect(result.greeks.vega).toBeCloseTo(tick.bsmVega * netQty * 100, 8);
  });
});
