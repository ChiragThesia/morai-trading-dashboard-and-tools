/**
 * deriveStreamStatus test suite — RED phase
 *
 * Locks the WATCH-01 unified grace-then-escalate derivation (RESEARCH Pattern 1,
 * D-01/D-02/D-11): quiet (isRth===false) wins first, then connecting (no ping yet
 * or cold-start grace), then the elapsed-vs-threshold stall check.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { deriveStreamStatus } from "./deriveStreamStatus.ts";

describe("deriveStreamStatus: branch examples", () => {
  it("isRth===false -> quiet, regardless of tick recency", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: true,
        msSinceLastTickOrConnect: 0,
        isRth: false,
        stallThresholdMs: 20_000,
      }),
    ).toBe("quiet");
  });

  it("isRth===false -> quiet, even past the stall threshold", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: false,
        msSinceLastTickOrConnect: 999_999,
        isRth: false,
        stallThresholdMs: 20_000,
      }),
    ).toBe("quiet");
  });

  it("isRth===null -> connecting (no ping received yet)", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: false,
        msSinceLastTickOrConnect: 0,
        isRth: null,
        stallThresholdMs: 20_000,
      }),
    ).toBe("connecting");
  });

  it("isRth===true, within threshold, first tick received -> live", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: true,
        msSinceLastTickOrConnect: 5_000,
        isRth: true,
        stallThresholdMs: 20_000,
      }),
    ).toBe("live");
  });

  it("isRth===true, within threshold, no tick yet -> connecting (cold-start grace)", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: false,
        msSinceLastTickOrConnect: 5_000,
        isRth: true,
        stallThresholdMs: 20_000,
      }),
    ).toBe("connecting");
  });

  it("isRth===true, elapsed >= threshold -> stalled", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: true,
        msSinceLastTickOrConnect: 20_001,
        isRth: true,
        stallThresholdMs: 20_000,
      }),
    ).toBe("stalled");
  });

  it("boundary: elapsed exactly == threshold -> stalled (not live)", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: true,
        msSinceLastTickOrConnect: 20_000,
        isRth: true,
        stallThresholdMs: 20_000,
      }),
    ).toBe("stalled");
  });

  it("boundary: elapsed one ms below threshold -> live (not stalled)", () => {
    expect(
      deriveStreamStatus({
        hasReceivedFirstTick: true,
        msSinceLastTickOrConnect: 19_999,
        isRth: true,
        stallThresholdMs: 20_000,
      }),
    ).toBe("live");
  });
});

describe("deriveStreamStatus: fast-check properties", () => {
  it("quiet dominates: isRth===false ⇒ 'quiet' for ALL other inputs", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        (hasReceivedFirstTick, msSinceLastTickOrConnect, stallThresholdMs) => {
          const status = deriveStreamStatus({
            hasReceivedFirstTick,
            msSinceLastTickOrConnect,
            isRth: false,
            stallThresholdMs,
          });
          return status === "quiet";
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("stall-monotonic: with isRth===true and hasReceivedFirstTick===true, once 'stalled' it never returns to 'live' as elapsed grows", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (stallThresholdMs, elapsedA, elapsedB) => {
          const [earlier, later] =
            elapsedA <= elapsedB ? [elapsedA, elapsedB] : [elapsedB, elapsedA];
          const earlierStatus = deriveStreamStatus({
            hasReceivedFirstTick: true,
            msSinceLastTickOrConnect: earlier,
            isRth: true,
            stallThresholdMs,
          });
          const laterStatus = deriveStreamStatus({
            hasReceivedFirstTick: true,
            msSinceLastTickOrConnect: later,
            isRth: true,
            stallThresholdMs,
          });
          // Once earlier is already stalled, later (>= earlier) must also be stalled.
          if (earlierStatus === "stalled") {
            return laterStatus === "stalled";
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
