/**
 * position-format.test.ts — pins the moved money-formatting helpers' exact output (35-04
 * Task 1). Not a full behavior suite (that lived, and stays covered, via Overview.test.tsx) —
 * a small example set so a future edit that breaks money formatting fails loudly.
 */
import { describe, it, expect } from "vitest";
import { usd, signed, signedUsd, signClass } from "./position-format.ts";

describe("position-format", () => {
  it("usd: no forced +, keeps − minus, shows every real decimal with no rounding or fake padding", () => {
    expect(usd(1234.5678)).toBe("$1234.5678");
    expect(usd(-1234.5678)).toBe("−$1234.5678");
    expect(usd(4745)).toBe("$4745");
    expect(usd(0)).toBe("$0");
  });

  it("signed: forces +/− sign, shows exact decimals (more precision than the old 3dp cap)", () => {
    expect(signed(0.123456)).toBe("+0.123456");
    expect(signed(-0.178)).toBe("−0.178");
    expect(signed(0)).toBe("+0");
  });

  it("signedUsd: forces +/− sign with $ prefix, exact decimals, float noise killed", () => {
    expect(signedUsd(500.999)).toBe("+$500.999");
    expect(signedUsd(27.354)).toBe("+$27.354");
    expect(signedUsd(-500.999)).toBe("−$500.999");
    expect(signedUsd(37.490000000000002)).toBe("+$37.49");
  });

  it("signClass: returns the up/down color token", () => {
    expect(signClass(1)).toBe("text-up");
    expect(signClass(0)).toBe("text-up");
    expect(signClass(-1)).toBe("text-down");
  });
});
