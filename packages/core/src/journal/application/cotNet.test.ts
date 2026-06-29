/**
 * cotNet.test.ts — pure net-per-class derivation (D-04, COT-01/COT-02).
 *
 * fast-check property: for arbitrary non-negative integer legs,
 *   net + short === long for every TFF class (no rounding, no floats).
 *
 * Follows the numRuns≥1000 convention from chunkDateRange.property.test.ts.
 * No node:* imports — core stays pure (@morai/shared only, architecture-boundaries §2).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cotNet } from "./cotNet.ts";

// ─── Arbitrary ────────────────────────────────────────────────────────────────

// All 10 leg values: independent integers [0, 1_000_000].
// We do NOT constrain long ≥ short because net can be negative in practice
// (dealers / asset managers can be net short index futures).
const arbLegs = fc.record({
  dealerLong: fc.integer({ min: 0, max: 1_000_000 }),
  dealerShort: fc.integer({ min: 0, max: 1_000_000 }),
  assetMgrLong: fc.integer({ min: 0, max: 1_000_000 }),
  assetMgrShort: fc.integer({ min: 0, max: 1_000_000 }),
  levMoneyLong: fc.integer({ min: 0, max: 1_000_000 }),
  levMoneyShort: fc.integer({ min: 0, max: 1_000_000 }),
  otherReptLong: fc.integer({ min: 0, max: 1_000_000 }),
  otherReptShort: fc.integer({ min: 0, max: 1_000_000 }),
  nonreptLong: fc.integer({ min: 0, max: 1_000_000 }),
  nonreptShort: fc.integer({ min: 0, max: 1_000_000 }),
});

// ─── Properties ──────────────────────────────────────────────────────────────

describe("cotNet", () => {
  it("property: net + short === long for all 5 TFF classes (numRuns≥1000)", () => {
    fc.assert(
      fc.property(arbLegs, (legs) => {
        const nets = cotNet(legs);

        const dealerOk =
          nets.netDealer + legs.dealerShort === legs.dealerLong;
        const assetOk =
          nets.netAssetManager + legs.assetMgrShort === legs.assetMgrLong;
        const levOk =
          nets.netLeveraged + legs.levMoneyShort === legs.levMoneyLong;
        const otherOk =
          nets.netOther + legs.otherReptShort === legs.otherReptLong;
        const nonreptOk =
          nets.netNonreportable + legs.nonreptShort === legs.nonreptLong;

        return dealerOk && assetOk && levOk && otherOk && nonreptOk;
      }),
      { numRuns: 1000 },
    );
  });

  it("property: all nets are integers (no floating-point drift) (numRuns≥1000)", () => {
    fc.assert(
      fc.property(arbLegs, (legs) => {
        const nets = cotNet(legs);
        return [
          nets.netDealer,
          nets.netAssetManager,
          nets.netLeveraged,
          nets.netOther,
          nets.netNonreportable,
        ].every(Number.isInteger);
      }),
      { numRuns: 1000 },
    );
  });

  // ─── Example tests ─────────────────────────────────────────────────────────

  it("example: known values — net = long − short per class", () => {
    const nets = cotNet({
      dealerLong: 100,
      dealerShort: 60,
      assetMgrLong: 200,
      assetMgrShort: 180,
      levMoneyLong: 300,
      levMoneyShort: 250,
      otherReptLong: 50,
      otherReptShort: 30,
      nonreptLong: 80,
      nonreptShort: 70,
    });
    expect(nets.netDealer).toBe(40);
    expect(nets.netAssetManager).toBe(20);
    expect(nets.netLeveraged).toBe(50);
    expect(nets.netOther).toBe(20);
    expect(nets.netNonreportable).toBe(10);
  });

  it("example: negative net is valid (short > long)", () => {
    const nets = cotNet({
      dealerLong: 50,
      dealerShort: 100,
      assetMgrLong: 0,
      assetMgrShort: 0,
      levMoneyLong: 0,
      levMoneyShort: 0,
      otherReptLong: 0,
      otherReptShort: 0,
      nonreptLong: 0,
      nonreptShort: 0,
    });
    expect(nets.netDealer).toBe(-50);
  });

  it("example: zero legs → all nets are zero", () => {
    const nets = cotNet({
      dealerLong: 0,
      dealerShort: 0,
      assetMgrLong: 0,
      assetMgrShort: 0,
      levMoneyLong: 0,
      levMoneyShort: 0,
      otherReptLong: 0,
      otherReptShort: 0,
      nonreptLong: 0,
      nonreptShort: 0,
    });
    expect(nets.netDealer).toBe(0);
    expect(nets.netAssetManager).toBe(0);
    expect(nets.netLeveraged).toBe(0);
    expect(nets.netOther).toBe(0);
    expect(nets.netNonreportable).toBe(0);
  });
});
