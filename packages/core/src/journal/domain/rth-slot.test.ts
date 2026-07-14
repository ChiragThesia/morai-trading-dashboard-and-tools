/**
 * roundDownToRthSlot tests (Phase 40, Plan 01, HIST-05) — example + fast-check property.
 *
 * Invariants:
 *   - Floors an instant to its nominal 30-min RTH slot boundary (09:47 ET -> 09:30 ET;
 *     10:14 ET -> 10:00 ET), DST-safe via Intl (no manual UTC-offset math).
 *   - Idempotent for ANY instant: re-flooring an already-floored instant is a no-op — this
 *     holds year-round (including DST transition days) because the offset is read from the
 *     actual, unambiguous instant being floored, not guessed from local wall-clock digits.
 *   - Floored result is always <= the input.
 *   - Two RTH instants in the same 30-min slot floor to the identical Date (the load-bearing
 *     HIST-05 collapse property — restricted to RTH instants via isWithinRth so the property
 *     never straddles a DST spring-forward gap, which only ever occurs at 2am ET, far outside
 *     RTH's 09:30-16:00 window).
 *
 * fc.integer bounds mirror the codebase's existing "keep fast-check generators sane"
 * discipline (attribution.test.ts's fc.float 32-bit-bounds precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isWithinRth } from "@morai/shared";
import { roundDownToRthSlot } from "./rth-slot.ts";

const SLOT_MS = 30 * 60 * 1000;

describe("roundDownToRthSlot", () => {
  it("floors 09:47 ET to the 09:30 ET slot boundary (EDT)", () => {
    // Monday 2026-06-15, EDT = UTC-4
    const input = new Date("2026-06-15T13:47:00Z");
    const expected = new Date("2026-06-15T13:30:00Z");
    expect(roundDownToRthSlot(input).getTime()).toBe(expected.getTime());
  });

  it("floors 10:14 ET to the 10:00 ET slot boundary (EDT)", () => {
    const input = new Date("2026-06-15T14:14:00Z");
    const expected = new Date("2026-06-15T14:00:00Z");
    expect(roundDownToRthSlot(input).getTime()).toBe(expected.getTime());
  });

  it("floors 09:47 ET to the 09:30 ET slot boundary in EST (winter, no manual UTC-offset math)", () => {
    // Wednesday 2026-01-14, EST = UTC-5
    const input = new Date("2026-01-14T14:47:00Z");
    const expected = new Date("2026-01-14T14:30:00Z");
    expect(roundDownToRthSlot(input).getTime()).toBe(expected.getTime());
  });

  it("is a no-op when already at a slot boundary", () => {
    const input = new Date("2026-06-15T14:00:00Z");
    expect(roundDownToRthSlot(input).getTime()).toBe(input.getTime());
  });

  it("is idempotent for a fixed instant", () => {
    const input = new Date("2026-06-15T13:47:00Z");
    const once = roundDownToRthSlot(input);
    const twice = roundDownToRthSlot(once);
    expect(twice.getTime()).toBe(once.getTime());
  });

  it("fast-check: idempotent and <= input, for random instants across DST regimes/years", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2028, 0, 1) }),
        (ms) => {
          const input = new Date(ms);
          const floored = roundDownToRthSlot(input);
          expect(floored.getTime()).toBeLessThanOrEqual(input.getTime());
          const refloored = roundDownToRthSlot(floored);
          expect(refloored.getTime()).toBe(floored.getTime());
        },
      ),
    );
  });

  it("fast-check: two RTH instants in the same 30-min slot round to the identical Date", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2028, 0, 1) }),
        fc.integer({ min: 0, max: SLOT_MS - 1 }),
        fc.integer({ min: 0, max: SLOT_MS - 1 }),
        (baseMs, offsetA, offsetB) => {
          fc.pre(isWithinRth(new Date(baseMs)));
          const slotStart = roundDownToRthSlot(new Date(baseMs));
          const a = roundDownToRthSlot(new Date(slotStart.getTime() + offsetA));
          const b = roundDownToRthSlot(new Date(slotStart.getTime() + offsetB));
          expect(a.getTime()).toBe(b.getTime());
        },
      ),
    );
  });
});
