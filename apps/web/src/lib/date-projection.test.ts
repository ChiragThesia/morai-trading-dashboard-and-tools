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
import {
  toDateInputValue,
  parseLocalDateInput,
  daysBetween,
  resolveDaysForward,
  computeProjectionBounds,
} from "./date-projection.ts";

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

describe("date-projection: resolveDaysForward (clamp + NaN guard)", () => {
  const today = new Date(2026, 6, 15);

  function addDays(base: Date, offset: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  }

  it("empty value defaults to today (daysForward 0) — the NaN guard", () => {
    expect(resolveDaysForward("", today, 30)).toBe(0);
  });

  it("malformed value defaults to today (daysForward 0), never NaN", () => {
    const result = resolveDaysForward("not-a-date", today, 30);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("picking today resolves to daysForward 0", () => {
    expect(resolveDaysForward(toDateInputValue(today), today, 30)).toBe(0);
  });

  it("out-of-range future date clamps to maxDaysForward", () => {
    const future = toDateInputValue(addDays(today, 40));
    expect(resolveDaysForward(future, today, 30)).toBe(30);
  });

  it("a past date clamps to 0, never negative", () => {
    const past = toDateInputValue(addDays(today, -5));
    expect(resolveDaysForward(past, today, 30)).toBe(0);
  });

  it("resolveDaysForward never returns NaN for any garbage input", () => {
    for (const garbage of ["", "not-a-date", "2026-99-99", "0000-00-00"]) {
      expect(Number.isFinite(resolveDaysForward(garbage, today, 30))).toBe(true);
    }
  });
});

describe("date-projection: computeProjectionBounds", () => {
  const today = new Date(2026, 6, 15);

  it("empty front-DTE list yields maxDaysForward 0 and maxIso === minIso", () => {
    const bounds = computeProjectionBounds([], today);
    expect(bounds.maxDaysForward).toBe(0);
    expect(bounds.maxIso).toBe(bounds.minIso);
    expect(bounds.minIso).toBe(toDateInputValue(today));
  });

  it("front-DTE list yields maxDaysForward = min(dtes) and maxIso = today + that many days", () => {
    const bounds = computeProjectionBounds([32, 59], today);
    expect(bounds.maxDaysForward).toBe(32);
    const expected = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 32);
    expect(bounds.maxIso).toBe(toDateInputValue(expected));
  });
});
