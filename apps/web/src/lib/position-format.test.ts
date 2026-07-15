/**
 * position-format.test.ts — pins the shared money/greek formatting helpers' exact output.
 * 2026-07-15 user directive: cap at 2 decimals for $ values and 3 for unitless greeks
 * (supersedes the 35-04 "exact numbers, no rounding" directive — full floats read as
 * noise on the positions table and net-greek tiles). Trailing zeros still trimmed.
 */
import { describe, it, expect } from "vitest";
import { usd, signed, signedUsd, signClass } from "./position-format.ts";

describe("position-format", () => {
  it("usd: no forced +, keeps − minus, caps at 2 decimals with trailing zeros trimmed", () => {
    expect(usd(1234.5678)).toBe("$1234.57");
    expect(usd(-1234.5678)).toBe("−$1234.57");
    expect(usd(4745)).toBe("$4745");
    expect(usd(4745.5)).toBe("$4745.5");
    expect(usd(0)).toBe("$0");
  });

  it("signed: forces +/− sign, caps at 3 decimals (greek scale — gamma keeps signal)", () => {
    expect(signed(0.123456)).toBe("+0.123");
    expect(signed(-0.178)).toBe("−0.178");
    expect(signed(-0.01330591)).toBe("−0.013");
    expect(signed(0.28218164)).toBe("+0.282");
    expect(signed(0)).toBe("+0");
  });

  it("signedUsd: forces +/− sign with $ prefix, 2-decimal cap, float noise killed", () => {
    expect(signedUsd(500.999)).toBe("+$501");
    expect(signedUsd(27.354)).toBe("+$27.35");
    expect(signedUsd(-500.999)).toBe("−$501");
    expect(signedUsd(37.490000000000002)).toBe("+$37.49");
    expect(signedUsd(34.15757556)).toBe("+$34.16");
  });

  it("signClass: returns the up/down color token", () => {
    expect(signClass(1)).toBe("text-up");
    expect(signClass(0)).toBe("text-up");
    expect(signClass(-1)).toBe("text-down");
  });
});
