/**
 * date-projection test suite
 *
 * RESEARCH Pitfall 1 (the CBOE-UTC bug class this project has hit twice, inverted direction
 * here): `<input type="date">` values must be parsed as LOCAL midnight, never via the
 * UTC-parsing single-string `new Date(string)` constructor. This suite locks that behavior
 * with a fast-check round-trip property that holds regardless of the runner's timezone or
 * time-of-day.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { toDateInputValue, parseLocalDateInput, daysBetween } from "./date-projection.ts";

describe("date-projection: parseLocalDateInput / toDateInputValue / daysBetween", () => {
  it("parses a YYYY-MM-DD string as a LOCAL date (not UTC-shifted)", () => {
    const d = parseLocalDateInput("2026-08-08");
    expect(d).not.toBeNull();
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(8);
    expect(d?.getFullYear()).toBe(2026);
  });

  it("returns null for an empty string", () => {
    expect(parseLocalDateInput("")).toBeNull();
  });

  it("returns null for a malformed string", () => {
    expect(parseLocalDateInput("not-a-date")).toBeNull();
  });

  it("toDateInputValue formats a local Date as YYYY-MM-DD", () => {
    expect(toDateInputValue(new Date(2026, 7, 8))).toBe("2026-08-08");
  });

  it("fast-check: UTC-drift round-trip holds for any offset and any time-of-day (numRuns:1000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (offset, hour, minute) => {
          const today = new Date(2026, 6, 15, hour, minute, 0, 0);
          const future = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
          const isoValue = toDateInputValue(future);
          const parsed = parseLocalDateInput(isoValue);
          if (parsed === null) return false;
          return daysBetween(today, parsed) === offset;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
