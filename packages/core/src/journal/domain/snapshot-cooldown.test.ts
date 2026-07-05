/**
 * isWithinCooldown — unit + fast-check property tests (SNAP-01, D-06, Pitfall 2).
 *
 * RED phase: all tests fail until snapshot-cooldown.ts is implemented.
 *
 * Must-haves verified here:
 *   - lastSnapshotAt===null → false (no prior snapshot ⇒ never suppressed).
 *   - now-last < cooldownMs → true.
 *   - now-last === cooldownMs → false (boundary is NOT within cooldown).
 *   - now-last > cooldownMs → false.
 *   - fast-check: monotonic in now — once false (elapsed >= cooldown), never
 *     flips back to true as now increases further.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isWithinCooldown } from "./snapshot-cooldown.ts";

describe("isWithinCooldown — example tests", () => {
  it("returns false when lastSnapshotAt is null (never suppressed on cold start)", () => {
    const now = new Date("2026-07-05T14:00:00.000Z");
    expect(isWithinCooldown(now, null, 15 * 60_000)).toBe(false);
  });

  it("returns true when elapsed is less than cooldownMs", () => {
    const last = new Date("2026-07-05T14:00:00.000Z");
    const now = new Date("2026-07-05T14:10:00.000Z"); // 10min elapsed
    expect(isWithinCooldown(now, last, 15 * 60_000)).toBe(true);
  });

  it("returns false at the exact boundary (elapsed === cooldownMs)", () => {
    const last = new Date("2026-07-05T14:00:00.000Z");
    const now = new Date("2026-07-05T14:15:00.000Z"); // exactly 15min elapsed
    expect(isWithinCooldown(now, last, 15 * 60_000)).toBe(false);
  });

  it("returns false when elapsed exceeds cooldownMs", () => {
    const last = new Date("2026-07-05T14:00:00.000Z");
    const now = new Date("2026-07-05T14:20:00.000Z"); // 20min elapsed
    expect(isWithinCooldown(now, last, 15 * 60_000)).toBe(false);
  });
});

describe("isWithinCooldown — fast-check properties", () => {
  it("monotonic in now: once false (elapsed >= cooldown), stays false as now increases", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }), // lastMs
        fc.integer({ min: 1, max: 3_600_000 }), // cooldownMs
        fc.integer({ min: 0, max: 10_000_000 }), // delta1 — elapsed at now1
        fc.integer({ min: 0, max: 10_000_000 }), // delta2 — additional elapsed at now2
        (lastMs, cooldownMs, delta1, delta2) => {
          const last = new Date(lastMs);
          const now1 = new Date(lastMs + delta1);
          const now2 = new Date(lastMs + delta1 + delta2);
          const result1 = isWithinCooldown(now1, last, cooldownMs);
          const result2 = isWithinCooldown(now2, last, cooldownMs);
          if (!result1) {
            expect(result2).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
