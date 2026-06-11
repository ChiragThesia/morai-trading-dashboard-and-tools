import { describe, it, expect } from "vitest";
import { isWithinRth } from "./rth-window.ts";

describe("isWithinRth", () => {
  // Monday 2026-06-15 10:00 ET = 14:00 UTC (EDT = UTC-4)
  it("returns true for Monday 10:00 ET (within RTH)", () => {
    const monday10amET = new Date("2026-06-15T14:00:00Z");
    expect(isWithinRth(monday10amET)).toBe(true);
  });

  // Saturday 2026-06-13 10:00 ET = 14:00 UTC (EDT = UTC-4)
  it("returns false for Saturday 10:00 ET (weekend)", () => {
    const saturday10amET = new Date("2026-06-13T14:00:00Z");
    expect(isWithinRth(saturday10amET)).toBe(false);
  });

  // Monday 2026-06-15 08:00 ET = 12:00 UTC (before open)
  it("returns false for weekday 08:00 ET (before market open)", () => {
    const monday8amET = new Date("2026-06-15T12:00:00Z");
    expect(isWithinRth(monday8amET)).toBe(false);
  });

  // DST test 1: Wednesday 2026-07-15 09:30 EDT = 13:30 UTC  ← MUST be true
  it("DST: returns true for Wednesday 09:30 EDT (2026-07-15T13:30:00Z)", () => {
    const wednesdayOpenEDT = new Date("2026-07-15T13:30:00Z");
    expect(isWithinRth(wednesdayOpenEDT)).toBe(true);
  });

  // DST test 2: Wednesday 2026-01-14 13:30 UTC = 08:30 EST (before open)  ← MUST be false
  it("DST: returns false for Wednesday 08:30 EST (2026-01-14T13:30:00Z)", () => {
    const wednesday830EST = new Date("2026-01-14T13:30:00Z");
    expect(isWithinRth(wednesday830EST)).toBe(false);
  });

  // DST test 3: Wednesday 2026-01-14 14:30 UTC = 09:30 EST (at open)  ← MUST be true
  it("DST: returns true for Wednesday 09:30 EST (2026-01-14T14:30:00Z)", () => {
    const wednesday930EST = new Date("2026-01-14T14:30:00Z");
    expect(isWithinRth(wednesday930EST)).toBe(true);
  });

  // Friday 2026-06-19 16:00 ET = 20:00 UTC (exactly at close — inclusive)
  it("returns true at 16:00 ET Friday (inclusive close)", () => {
    const friday4pmET = new Date("2026-06-19T20:00:00Z");
    expect(isWithinRth(friday4pmET)).toBe(true);
  });

  // Friday 2026-06-19 16:01 ET = 20:01 UTC (after close)
  it("returns false at 16:01 ET Friday (after close)", () => {
    const friday401pmET = new Date("2026-06-19T20:01:00Z");
    expect(isWithinRth(friday401pmET)).toBe(false);
  });

  // Sunday 2026-06-14 12:00 UTC = 08:00 EDT
  it("returns false for Sunday (weekend)", () => {
    const sunday = new Date("2026-06-14T16:00:00Z");
    expect(isWithinRth(sunday)).toBe(false);
  });

  // Monday 2026-06-15 09:29 ET = 13:29 UTC (just before open)
  it("returns false at 09:29 ET Monday (just before open)", () => {
    const monday929amET = new Date("2026-06-15T13:29:00Z");
    expect(isWithinRth(monday929amET)).toBe(false);
  });

  // Monday 2026-06-15 09:30 ET = 13:30 UTC (at open — inclusive)
  it("returns true at 09:30 ET Monday (inclusive open)", () => {
    const monday930amET = new Date("2026-06-15T13:30:00Z");
    expect(isWithinRth(monday930amET)).toBe(true);
  });
});
