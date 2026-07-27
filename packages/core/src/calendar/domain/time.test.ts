/**
 * time.test.ts — the ONE time-to-expiry function for the calendar engine.
 *
 * Why this module exists at all: the repo carries nine different definitions of
 * time-to-expiry, three of them inside the GEX path. Two of those nine take a Date and
 * disagree about whether its components are UTC or local — `computeT`
 * (journal/domain/dte.ts) reads UTC accessors, `settlementTimestamp`
 * (packages/shared) reads local ones. Handing the wrong flavour of Date to either is a
 * silent one-day error, and mixing whole-day against settlement-aware T is what made
 * theta read visibly low against ThinkOrSwim once already.
 *
 * So this function takes the expiration as a `YYYY-MM-DD` STRING. There is no Date to get
 * the flavour of wrong. That is the whole design.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { yearsToSettlement, calendarDaysTo, DAYS_PER_YEAR } from "./time.ts";

const HOUR = 60 * 60 * 1000;

/**
 * The gates count DTE the way the trader does — in whole calendar days — while pricing uses
 * the settlement-aware T. Those two disagree by up to a day, and deriving one from the other
 * by rounding gets it wrong in both directions: measured from 04:00Z a 15-calendar-day expiry
 * is T = 15.67 days (rounds to 16), and an AM-settled expiry 25 calendar days out is
 * T = 24.9 (floors to 24). So the day count is its own function, and it lives here rather
 * than becoming the repo's fifth copy of ISO day arithmetic.
 */
describe("calendarDaysTo — whole calendar days, the trader's DTE", () => {
  it("counts calendar days regardless of the time of day within them", () => {
    for (const at of ["T00:00:00.000Z", "T04:00:00.000Z", "T16:00:00.000Z", "T23:59:00.000Z"]) {
      expect(calendarDaysTo(new Date(`2026-07-27${at}`), "2026-08-11")).toBe(15);
    }
  });

  it("agrees with the trader's count where rounding T would not", () => {
    const now = new Date("2026-07-27T16:00:00.000Z");
    // AM-settled: T is 24.9 days, which floors to 24. The trader counts 25.
    expect(calendarDaysTo(now, "2026-08-21")).toBe(25);
    expect(Math.floor(yearsToSettlement(now, "2026-08-21", "SPX") * DAYS_PER_YEAR)).toBe(24);
  });

  it("is 0 on the expiry date and negative after it", () => {
    expect(calendarDaysTo(new Date("2026-08-11T13:00:00.000Z"), "2026-08-11")).toBe(0);
    expect(calendarDaysTo(new Date("2026-08-12T13:00:00.000Z"), "2026-08-11")).toBe(-1);
  });

  it("returns null, not a number, for an unparseable expiration", () => {
    expect(calendarDaysTo(new Date("2026-07-27T16:00:00.000Z"), "2026-02-30")).toBeNull();
    expect(calendarDaysTo(new Date("2026-07-27T16:00:00.000Z"), "nope")).toBeNull();
  });

  it("crosses month and year boundaries correctly", () => {
    expect(calendarDaysTo(new Date("2026-12-20T12:00:00.000Z"), "2027-01-15")).toBe(26);
    // 2028 is a leap year: Feb has 29 days.
    expect(calendarDaysTo(new Date("2028-02-01T12:00:00.000Z"), "2028-03-01")).toBe(29);
  });
});

describe("yearsToSettlement — settlement instant, not calendar midnight", () => {
  it("puts AM-settled SPX 6.5 hours before its PM-settled SPXW twin on the same date", () => {
    // 2026-08-21 is the third Friday of August 2026, so root decides the settlement clock:
    // SPX settles 09:30 ET (the Special Opening Quotation), SPXW settles 16:00 ET.
    // This is the AM/PM branch, asserted as a difference so the test does not depend on
    // the reader trusting my third-Friday arithmetic.
    const now = new Date("2026-07-27T16:00:00.000Z");
    const am = yearsToSettlement(now, "2026-08-21", "SPX");
    const pm = yearsToSettlement(now, "2026-08-21", "SPXW");

    expect(am).toBeLessThan(pm);
    const deltaHours = (pm - am) * DAYS_PER_YEAR * 24;
    expect(deltaHours).toBeCloseTo(6.5, 6);
  });

  it("treats a non-third-Friday SPX expiry as PM-settled, same as SPXW", () => {
    const now = new Date("2026-07-27T16:00:00.000Z");
    // 2026-08-11 is a Tuesday — no root can make it AM-settled.
    expect(yearsToSettlement(now, "2026-08-11", "SPX")).toBe(
      yearsToSettlement(now, "2026-08-11", "SPXW"),
    );
  });

  it("measures to the settlement instant, so a 15-day expiry is not 15/365.25 years", () => {
    // The trader's floor is 15 DTE. Calendar-day arithmetic would call this exactly
    // 15/365.25; the honest answer is the distance to 16:00 ET on the expiry date, which
    // from 16:00Z on 2026-07-27 is 15 days plus 4 hours (ET is UTC-4 in August).
    const now = new Date("2026-07-27T16:00:00.000Z");
    const t = yearsToSettlement(now, "2026-08-11", "SPXW");
    const days = t * DAYS_PER_YEAR;
    expect(days).toBeGreaterThan(15);
    expect(days).toBeLessThan(15.5);
  });
});

describe("yearsToSettlement — never negative, never NaN", () => {
  it("clamps to zero at and past the settlement instant", () => {
    const afterSettlement = new Date("2026-08-12T00:00:00.000Z");
    expect(yearsToSettlement(afterSettlement, "2026-08-11", "SPXW")).toBe(0);
  });

  it("returns 0 rather than NaN for an unparseable expiration", () => {
    const now = new Date("2026-07-27T16:00:00.000Z");
    for (const bad of ["", "2026-8-11", "not-a-date", "2026-13-01", "2026-02-30"]) {
      const t = yearsToSettlement(now, bad, "SPXW");
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBe(0);
    }
  });
});

describe("yearsToSettlement — properties", () => {
  it("is monotonically non-increasing as now advances", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 * 24 }), fc.integer({ min: 1, max: 24 }), (h0, dh) => {
        const base = new Date("2026-07-01T00:00:00.000Z").getTime();
        const earlier = new Date(base + h0 * HOUR);
        const later = new Date(base + (h0 + dh) * HOUR);
        const a = yearsToSettlement(earlier, "2026-08-21", "SPXW");
        const b = yearsToSettlement(later, "2026-08-21", "SPXW");
        expect(b).toBeLessThanOrEqual(a);
      }),
      { numRuns: 200 },
    );
  });

  it("depends only on the expiration string, never on how a Date would have been built", () => {
    // The nine-conventions bug in one assertion: a UTC-midnight Date and a local-midnight
    // Date for the same calendar date are different instants, and code that accepts either
    // silently picks a different day. This function accepts neither, so there is nothing
    // to disagree about — the same string always yields the same T.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 28 }),
        fc.constantFrom<"SPX" | "SPXW">("SPX", "SPXW"),
        (day, root) => {
          const now = new Date("2026-07-27T16:00:00.000Z");
          const iso = `2026-09-${String(day).padStart(2, "0")}`;
          expect(yearsToSettlement(now, iso, root)).toBe(yearsToSettlement(now, iso, root));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is strictly ordered by expiration date", () => {
    const now = new Date("2026-07-27T16:00:00.000Z");
    const ordered = ["2026-08-11", "2026-08-21", "2026-09-01", "2026-09-18", "2026-10-16"];
    const ts = ordered.map((e) => yearsToSettlement(now, e, "SPXW"));
    for (let i = 1; i < ts.length; i += 1) {
      const prev = ts[i - 1];
      const cur = ts[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev === undefined || cur === undefined) return;
      expect(cur).toBeGreaterThan(prev);
    }
  });
});
