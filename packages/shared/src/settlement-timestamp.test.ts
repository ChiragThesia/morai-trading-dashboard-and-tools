import { describe, it, expect } from "vitest";
import { settlementTimestamp } from "./settlement-timestamp.ts";

// Hand-derived oracle instants — verified independently via
// `TZ=America/New_York date -j -f ... '+%Y-%m-%d %H:%M %Z'` against the OS's IANA tz
// database, NOT by re-running the Intl.DateTimeFormat offset lookup the implementation
// itself performs (that would be a vacuous test that passes even if the offset logic
// in settlement-timestamp.ts is wrong).
//
//   2026-09-18 09:30 ET → EDT (UTC-4) → 2026-09-18T13:30:00Z
//   2026-12-18 16:00 ET → EST (UTC-5) → 2026-12-18T21:00:00Z
//   2026-07-17 16:00 ET → EDT (UTC-4) → 2026-07-17T20:00:00Z
//   2026-05-22 16:00 ET → EDT (UTC-4) → 2026-05-22T20:00:00Z

describe("settlementTimestamp", () => {
  it("AM-settled: root SPX on the exact 3rd Friday resolves to 09:30 ET (EDT oracle)", () => {
    // 2026-09-18 is the 3rd Friday of September 2026 (Fridays: 4, 11, 18, 25).
    const expiry = new Date(2026, 8, 18);
    const result = settlementTimestamp("SPX", expiry);
    expect(result).toEqual(new Date(Date.UTC(2026, 8, 18, 13, 30)));
  });

  it("PM-settled: root SPXW resolves to 16:00 ET even on a 3rd-Friday date (EST/winter oracle)", () => {
    // 2026-12-18 is the 3rd Friday of December 2026 — root SPXW must still be PM.
    const expiry = new Date(2026, 11, 18);
    const result = settlementTimestamp("SPXW", expiry);
    expect(result).toEqual(new Date(Date.UTC(2026, 11, 18, 21, 0)));
  });

  it("PM-settled: root SPXW resolves to 16:00 ET even on a 3rd-Friday date (EDT/summer oracle)", () => {
    // 2026-07-17 is the 3rd Friday of July 2026 — root SPXW must still be PM.
    const expiry = new Date(2026, 6, 17);
    const result = settlementTimestamp("SPXW", expiry);
    expect(result).toEqual(new Date(Date.UTC(2026, 6, 17, 20, 0)));
  });

  it("third-Friday classification edge: root SPX on the 4th Friday (day 22, outside the 15-21 window) is PM-settled", () => {
    // 2026-05-22 is a Friday but the 4th Friday of May 2026 (3rd Friday is May 15).
    const expiry = new Date(2026, 4, 22);
    const result = settlementTimestamp("SPX", expiry);
    expect(result).toEqual(new Date(Date.UTC(2026, 4, 22, 20, 0)));
  });
});
