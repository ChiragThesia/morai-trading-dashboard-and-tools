/**
 * chunkDateRange.test.ts — worked-boundary example tests for the pure date-window chunker
 * (BRK-04). Locks the exact window boundaries the backfill relies on: contiguous, inclusive,
 * last window may be short, no day skipped, no day double-covered.
 *
 * chunkDateRange is PURE core (imports only @morai/shared); it never throws — invalid input
 * (from > to, maxDays <= 0) returns a typed Result.err. No any/as/! (typescript.md).
 */

import { describe, it, expect } from "vitest";
import {
  chunkDateRange,
  inclusiveDays,
  SCHWAB_TX_LOOKBACK_MAX_DAYS,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "./chunkDateRange.ts";

describe("chunkDateRange — worked boundary examples", () => {
  it("splits [2026-01-01, 2026-01-10] at maxDays=4 into 3 contiguous windows", () => {
    const result = chunkDateRange("2026-01-01", "2026-01-10", 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
  });

  it("from === to yields a single one-day window", () => {
    const result = chunkDateRange("2026-03-15", "2026-03-15", 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ from: "2026-03-15", to: "2026-03-15" }]);
  });

  it("a range shorter than maxDays is a single window", () => {
    const result = chunkDateRange("2026-01-01", "2026-01-03", 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ from: "2026-01-01", to: "2026-01-03" }]);
  });

  it("a range that is an exact multiple of maxDays has equal-length windows", () => {
    const result = chunkDateRange("2026-01-01", "2026-01-08", 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
    ]);
  });

  it("crosses a month boundary correctly (inclusive day math)", () => {
    const result = chunkDateRange("2026-01-30", "2026-02-02", 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { from: "2026-01-30", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-02" },
    ]);
  });

  it("from > to returns a typed range error (no throw)", () => {
    const result = chunkDateRange("2026-01-10", "2026-01-01", 4);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("range-error");
  });

  it("maxDays <= 0 returns a typed range error (no throw)", () => {
    const zero = chunkDateRange("2026-01-01", "2026-01-10", 0);
    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(zero.error.kind).toBe("range-error");

    const negative = chunkDateRange("2026-01-01", "2026-01-10", -3);
    expect(negative.ok).toBe(false);
  });
});

describe("inclusiveDays — shared inclusive day-count helper (IN-01)", () => {
  it("counts a single day as 1", () => {
    expect(inclusiveDays("2026-03-15", "2026-03-15")).toBe(1);
  });

  it("counts [from, to] inclusively (10 days)", () => {
    expect(inclusiveDays("2026-01-01", "2026-01-10")).toBe(10);
  });

  it("crosses a month boundary correctly", () => {
    expect(inclusiveDays("2026-01-30", "2026-02-02")).toBe(4);
  });

  it("agrees with chunkDateRange window coverage (no off-by-one drift)", () => {
    // The number of days the chunker covers must equal inclusiveDays — they share the math.
    const from = "2026-01-01";
    const to = "2026-03-31";
    const chunks = chunkDateRange(from, to, 30);
    expect(chunks.ok).toBe(true);
    if (!chunks.ok) return;
    const coveredDays = chunks.value.reduce(
      (sum, w) => sum + inclusiveDays(w.from, w.to),
      0,
    );
    expect(coveredDays).toBe(inclusiveDays(from, to));
  });
});

describe("Schwab transaction caps (WR-04: per-call window vs total lookback)", () => {
  it("the total-lookback cap is 365 days", () => {
    expect(SCHWAB_TX_LOOKBACK_MAX_DAYS).toBe(365);
  });

  it("the per-call window cap is a positive count no larger than the lookback cap", () => {
    expect(SCHWAB_TX_MAX_RANGE_DAYS).toBeGreaterThan(0);
    expect(SCHWAB_TX_MAX_RANGE_DAYS).toBeLessThanOrEqual(SCHWAB_TX_LOOKBACK_MAX_DAYS);
  });
});
