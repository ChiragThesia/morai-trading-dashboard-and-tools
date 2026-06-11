/**
 * Tests for settlement-aware time-to-expiry (DTE) domain helpers.
 *
 * D-04: Minutes-to-cutoff / 525960; PM-settled SPXW → 16:00 ET;
 *       AM-settled SPX 3rd-Friday → 09:30 ET.
 */

import { describe, it, expect } from "vitest";
import { computeT, isThirdFriday } from "./dte.ts";

// MINUTES_PER_YEAR = 365.25 * 24 * 60 = 525960
const MINUTES_PER_YEAR = 525960;

// ─── isThirdFriday ─────────────────────────────────────────────
describe("isThirdFriday", () => {
  it("returns true for 2026-06-19 (3rd Friday of June 2026)", () => {
    // June 2026: 1st Friday = June 5, 2nd = June 12, 3rd = June 19
    expect(isThirdFriday(new Date(2026, 5, 19))).toBe(true);
  });

  it("returns false for 2026-06-12 (2nd Friday of June 2026)", () => {
    expect(isThirdFriday(new Date(2026, 5, 12))).toBe(false);
  });

  it("returns false for 2026-06-05 (1st Friday of June 2026)", () => {
    expect(isThirdFriday(new Date(2026, 5, 5))).toBe(false);
  });

  it("returns false for 2026-06-26 (4th Friday of June 2026)", () => {
    expect(isThirdFriday(new Date(2026, 5, 26))).toBe(false);
  });

  it("returns true for 2026-09-18 (3rd Friday of September 2026)", () => {
    // Sept 2026: 1st Friday = Sept 4, 2nd = Sept 11, 3rd = Sept 18
    expect(isThirdFriday(new Date(2026, 8, 18))).toBe(true);
  });

  it("returns false for 2026-05-16 (Saturday in May 2026)", () => {
    expect(isThirdFriday(new Date(2026, 4, 16))).toBe(false);
  });

  it("returns true for 2026-05-15 (3rd Friday of May 2026)", () => {
    // May 2026: May 1 = Friday, May 8 = 2nd Friday, May 15 = 3rd Friday
    expect(isThirdFriday(new Date(2026, 4, 15))).toBe(true);
  });

  it("returns false for 2026-06-20 (Saturday)", () => {
    expect(isThirdFriday(new Date(2026, 5, 20))).toBe(false);
  });
});

// ─── computeT ─────────────────────────────────────────────────
describe("computeT", () => {
  it("returns 0 when now is after the cutoff on expiry day (PM-settled SPXW)", () => {
    // SPXW expiry 2026-06-19 (3rd Friday, but SPXW → PM settled at 16:00 ET)
    // ET is UTC-4 in summer (EDT). 16:00 ET = 20:00 UTC.
    // Set now to 20:01 UTC on expiry day → past cutoff.
    const expiry = new Date(2026, 5, 19); // 2026-06-19
    const now = new Date(Date.UTC(2026, 5, 19, 20, 1, 0)); // 20:01 UTC = 16:01 ET
    const T = computeT(now, expiry, "SPXW");
    expect(T).toBe(0);
  });

  it("returns 0 when now is after the cutoff on expiry day (AM-settled SPX)", () => {
    // SPX expiry 2026-09-18 (3rd Friday → AM-settled at 09:30 ET)
    // ET is UTC-4 in summer. 09:30 ET = 13:30 UTC.
    // Set now to 13:31 UTC on expiry day → past cutoff.
    const expiry = new Date(2026, 8, 18); // 2026-09-18
    const now = new Date(Date.UTC(2026, 8, 18, 13, 31, 0)); // 13:31 UTC = 09:31 ET
    const T = computeT(now, expiry, "SPX");
    expect(T).toBe(0);
  });

  it("returns positive T when now is before the cutoff on expiry day (PM-settled)", () => {
    // SPXW 2026-06-19, cutoff 16:00 ET = 20:00 UTC (EDT UTC-4)
    // now = 15:00 UTC = 11:00 ET → 300 minutes before cutoff
    const expiry = new Date(2026, 5, 19);
    const now = new Date(Date.UTC(2026, 5, 19, 15, 0, 0));
    const T = computeT(now, expiry, "SPXW");
    // 300 minutes / 525960 ≈ 0.000571
    expect(T).toBeGreaterThan(0);
    expect(T).toBeCloseTo(300 / MINUTES_PER_YEAR, 8);
  });

  it("SPX 3rd-Friday (AM-settled) has a smaller T than SPXW PM-settled on the same day", () => {
    // Both cutoffs are on 2026-09-18.
    // SPX: 09:30 ET = 13:30 UTC, SPXW: 16:00 ET = 20:00 UTC (EDT UTC-4)
    // now at 10:00 UTC = 06:00 ET → 210 min before SPX AM cutoff; 600 min before SPXW PM cutoff
    const expiry = new Date(2026, 8, 18); // 2026-09-18
    const now = new Date(Date.UTC(2026, 8, 18, 10, 0, 0)); // 10:00 UTC

    const tAm = computeT(now, expiry, "SPX"); // AM-settled via 3rd Friday
    const tPm = computeT(now, expiry, "SPXW"); // PM-settled

    // AM cutoff is sooner → less time remaining → smaller T
    expect(tAm).toBeLessThan(tPm);
    // SPX: 13:30 - 10:00 = 210 minutes
    expect(tAm).toBeCloseTo(210 / MINUTES_PER_YEAR, 8);
    // SPXW: 20:00 - 10:00 = 600 minutes
    expect(tPm).toBeCloseTo(600 / MINUTES_PER_YEAR, 8);
  });

  it("SPX on a NON-3rd-Friday expiry resolves to PM-settled (16:00 ET)", () => {
    // SPX expiry 2026-06-12 (2nd Friday) → not 3rd Friday → PM-settled
    const expiry = new Date(2026, 5, 12); // 2026-06-12
    const now = new Date(Date.UTC(2026, 5, 12, 15, 0, 0)); // 15:00 UTC = 11:00 ET

    // PM cutoff: 16:00 ET = 20:00 UTC → 300 minutes remaining
    const T = computeT(now, expiry, "SPX");
    expect(T).toBeCloseTo(300 / MINUTES_PER_YEAR, 8);
  });

  it("a 30-DTE PM expiry yields T ≈ 30/365.25 within a day fraction tolerance", () => {
    // SPXW expiry 30 calendar days in the future, cutoff 16:00 ET
    // now at 16:00 ET (20:00 UTC) exactly on a day 30 days before expiry
    // → minutesToCutoff ≈ 30 * 1440 (30 days × 1440 min/day = 43200 minutes)
    // T = 43200 / 525960 = 30/365.25 ≈ 0.08213552
    const expiry = new Date(2026, 6, 11); // 2026-07-11
    // now = 2026-06-11 at 20:00 UTC (= 16:00 ET, exactly at the previous cutoff)
    const now = new Date(Date.UTC(2026, 5, 11, 20, 0, 0));
    const T = computeT(now, expiry, "SPXW");
    const expected = 30 / 365.25;
    // Allow ±1 day fraction tolerance (1/365.25 ≈ 0.00274)
    expect(T).toBeCloseTo(expected, 2);
  });

  it("T is always ≥ 0 (Math.max(0, ...) guard)", () => {
    // now way past expiry
    const expiry = new Date(2025, 0, 1); // 2025-01-01
    const now = new Date(2026, 5, 11);
    const T = computeT(now, expiry, "SPXW");
    expect(T).toBe(0);
  });
});
