/**
 * chunkDateRange.test.ts — worked-boundary example tests for the pure date-window chunker
 * (BRK-04). Locks the exact window boundaries the backfill relies on: contiguous, inclusive,
 * last window may be short, no day skipped, no day double-covered.
 *
 * chunkDateRange is PURE core (imports only @morai/shared); it never throws — invalid input
 * (from > to, maxDays <= 0) returns a typed Result.err. No any/as/! (typescript.md).
 */

import { describe, it, expect } from "vitest";
import { chunkDateRange } from "./chunkDateRange.ts";

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
