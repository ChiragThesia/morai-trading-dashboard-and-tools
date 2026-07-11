/**
 * position-format.test.ts — pins the moved money-formatting helpers' exact output (35-04
 * Task 1). Not a full behavior suite (that lived, and stays covered, via Overview.test.tsx) —
 * a small example set so a future edit that breaks money formatting fails loudly.
 */
import { describe, it, expect } from "vitest";
import { usd, signed, signedUsd, signClass } from "./position-format.ts";

describe("position-format", () => {
  it("usd: no forced +, keeps − minus, truncates without rounding", () => {
    expect(usd(1234.5678)).toBe("$1234.567");
    expect(usd(-1234.5678)).toBe("−$1234.567");
    expect(usd(0)).toBe("$0.000");
  });

  it("signed: forces +/− sign, truncates without rounding", () => {
    expect(signed(0.1236)).toBe("+0.123");
    expect(signed(-0.1236)).toBe("−0.123");
    expect(signed(0, 0)).toBe("+0");
  });

  it("signedUsd: forces +/− sign with $ prefix, truncates without rounding", () => {
    expect(signedUsd(500.999)).toBe("+$500.999");
    expect(signedUsd(-500.999)).toBe("−$500.999");
  });

  it("signClass: returns the up/down color token", () => {
    expect(signClass(1)).toBe("text-up");
    expect(signClass(0)).toBe("text-up");
    expect(signClass(-1)).toBe("text-down");
  });
});
