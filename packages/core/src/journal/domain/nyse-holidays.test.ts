import { describe, it, expect } from "vitest";
import { isNyseHoliday } from "./nyse-holidays.ts";

describe("isNyseHoliday", () => {
  // ── 2026 full-closure dates ────────────────────────────────────────────────

  it("2026-01-01 (New Year's Day) → true", () => {
    // 14:00 UTC = 09:00 EST — ET date is still 2026-01-01
    expect(isNyseHoliday(new Date("2026-01-01T14:00:00Z"))).toBe(true);
  });

  it("2026-01-19 (MLK Day) → true", () => {
    expect(isNyseHoliday(new Date("2026-01-19T15:00:00Z"))).toBe(true);
  });

  it("2026-02-16 (Washington's Birthday) → true", () => {
    expect(isNyseHoliday(new Date("2026-02-16T15:00:00Z"))).toBe(true);
  });

  it("2026-04-03 (Good Friday) → true", () => {
    expect(isNyseHoliday(new Date("2026-04-03T14:00:00Z"))).toBe(true);
  });

  it("2026-05-25 (Memorial Day) → true", () => {
    expect(isNyseHoliday(new Date("2026-05-25T14:00:00Z"))).toBe(true);
  });

  it("2026-06-19 (Juneteenth) → true", () => {
    expect(isNyseHoliday(new Date("2026-06-19T14:00:00Z"))).toBe(true);
  });

  it("2026-09-07 (Labor Day) → true", () => {
    expect(isNyseHoliday(new Date("2026-09-07T14:00:00Z"))).toBe(true);
  });

  it("2026-11-26 (Thanksgiving) → true", () => {
    expect(isNyseHoliday(new Date("2026-11-26T15:00:00Z"))).toBe(true);
  });

  it("2026-12-25 (Christmas) → true", () => {
    expect(isNyseHoliday(new Date("2026-12-25T15:00:00Z"))).toBe(true);
  });

  // ── 2026 dates that are NOT full closures ─────────────────────────────────

  it("2026-07-03 (early close — treated as normal day per SPEC) → false", () => {
    // July 4 2026 is a Saturday; Friday July 3 is an early close, NOT a full closure
    expect(isNyseHoliday(new Date("2026-07-03T14:00:00Z"))).toBe(false);
  });

  it("2026-07-04 (Saturday) → false (weekend; holiday gate does not handle weekends)", () => {
    // July 4 is a Saturday in 2026 — NYSE_HOLIDAYS must NOT contain this date
    expect(isNyseHoliday(new Date("2026-07-04T14:00:00Z"))).toBe(false);
  });

  // ── 2027 full-closure dates (sample) ─────────────────────────────────────

  it("2027-12-24 (Christmas Day observed) → true", () => {
    expect(isNyseHoliday(new Date("2027-12-24T15:00:00Z"))).toBe(true);
  });

  it("2027-11-25 (Thanksgiving 2027) → true", () => {
    expect(isNyseHoliday(new Date("2027-11-25T15:00:00Z"))).toBe(true);
  });

  it("2027-01-01 (New Year's Day 2027) → true", () => {
    expect(isNyseHoliday(new Date("2027-01-01T15:00:00Z"))).toBe(true);
  });

  // ── Normal RTH instants ────────────────────────────────────────────────────

  it("normal RTH weekday (Monday 2026-06-15 14:00 UTC = 10:00 EDT) → false", () => {
    // A regular trading day — not a holiday
    expect(isNyseHoliday(new Date("2026-06-15T14:00:00Z"))).toBe(false);
  });

  it("Saturday (2026-06-13) → false (weekend; use isWithinRth for that check)", () => {
    expect(isNyseHoliday(new Date("2026-06-13T14:00:00Z"))).toBe(false);
  });
});
