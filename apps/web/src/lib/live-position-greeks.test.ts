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
    const nq = (leg.longQty - leg.shortQty) * 100;
    acc.delta += r.value.greeks.delta * nq;
    acc.gamma += r.value.greeks.gamma * nq;
    acc.theta += r.value.greeks.theta * nq;
    acc.vega += r.value.greeks.vega * nq;
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

          expect(result.greeks.delta).toBeCloseTo(expectedGreeks.delta, 8);
          expect(result.greeks.gamma).toBeCloseTo(expectedGreeks.gamma, 8);
          expect(result.greeks.theta).toBeCloseTo(expectedGreeks.theta, 8);
          expect(result.greeks.vega).toBeCloseTo(expectedGreeks.vega, 8);
          expect(result.netVal).toBeCloseTo(expectedVal, 8);
          expect(result.unreal).toEqual(expectedUnreal);
          expect(result.liveTs).toBeNull();
        },
      ),
    );
  });

  // 2. Single long leg WITH tick
  it("single long leg WITH tick → greeks.delta = tick.bsmDelta × netQty × (netQty × 100), netVal and unreal live-sourced, liveTs = tick.ts", () => {
    const leg = makeLongLeg();
    const tick = makeTick(OCC_LONG, { bsmDelta: -0.40, mark: 22.0 });
    const liveGreeks = new Map([[OCC_LONG, tick]]);

    const netQty = leg.longQty - leg.shortQty; // 1
    const nq = netQty * 100; // 100

    const result = resolveLivePositionRow([leg], SPOT, liveGreeks);

    expect(result.greeks.delta).toBeCloseTo(tick.bsmDelta * netQty * nq, 8);
    expect(result.greeks.gamma).toBeCloseTo(tick.bsmGamma * netQty * nq, 8);
    expect(result.greeks.theta).toBeCloseTo(tick.bsmTheta * netQty * nq, 8);
    expect(result.greeks.vega).toBeCloseTo(tick.bsmVega * netQty * nq, 8);
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

    // Long leg contribution (live): tick.bsmDelta × 1 × 100
    const longNetQty = longLeg.longQty - longLeg.shortQty; // 1
    const longNq = longNetQty * 100; // 100
    const liveContrib = tick.bsmDelta * longNetQty * longNq;

    // Short leg contribution (static): computePositionGreeks().greeks.delta × (-100)
    const shortR = computePositionGreeks({
      occSymbol: shortLeg.occSymbol,
      spot: SPOT,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty: shortLeg.longQty,
      shortQty: shortLeg.shortQty,
    });
    const shortNq = (shortLeg.longQty - shortLeg.shortQty) * 100; // -100
    const staticContrib = shortR.ok ? shortR.value.greeks.delta * shortNq : 0;

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
