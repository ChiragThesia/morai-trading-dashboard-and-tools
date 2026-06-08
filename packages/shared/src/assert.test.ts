import { describe, it, expect } from "vitest";
import { assertDefined } from "./assert.ts";

describe("assertDefined", () => {
  it("throws when value is undefined", () => {
    expect(() => {
      assertDefined(undefined, "myBinding");
    }).toThrow("assertDefined: myBinding");
  });

  it("throws when value is null", () => {
    expect(() => {
      assertDefined(null, "myBinding");
    }).toThrow("assertDefined: myBinding");
  });

  it("includes the caller-supplied message in the error", () => {
    expect(() => {
      assertDefined(undefined, "expected userId to be set");
    }).toThrow("assertDefined: expected userId to be set");
  });

  it("does not throw when value is a non-null, non-undefined value", () => {
    expect(() => {
      assertDefined("hello", "should not throw");
    }).not.toThrow();
  });

  it("does not throw when value is 0 (falsy but defined)", () => {
    expect(() => {
      assertDefined(0, "should not throw");
    }).not.toThrow();
  });

  it("does not throw when value is false (falsy but defined)", () => {
    expect(() => {
      assertDefined(false, "should not throw");
    }).not.toThrow();
  });

  it("does not throw when value is an empty string (falsy but defined)", () => {
    expect(() => {
      assertDefined("", "should not throw");
    }).not.toThrow();
  });

  it("narrows the type to T on the success path (compile-time check via usage)", () => {
    const maybeStr: string | undefined = "hello";
    assertDefined(maybeStr, "maybeStr");
    // If assertDefined works, TypeScript narrows maybeStr to string here.
    // We verify at runtime by accessing string methods without error.
    const upper: string = maybeStr.toUpperCase();
    expect(upper).toBe("HELLO");
  });
});
