import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, type Ok, type Err, type Result } from "./result.ts";

describe("Result", () => {
  describe("ok()", () => {
    it("constructs an Ok with ok:true and the given value", () => {
      const r = ok(42);
      expect(r.ok).toBe(true);
      expect((r as Ok<number>).value).toBe(42);
    });

    it("narrows to Ok<T> when isOk returns true", () => {
      const r: Result<number, string> = ok(99);
      if (isOk(r)) {
        // TypeScript sees r as Ok<number> here
        const v: number = r.value;
        expect(v).toBe(99);
      } else {
        throw new Error("should have been ok");
      }
    });

    it("has readonly ok and value fields", () => {
      const r = ok("hello");
      // Structural check: both fields present
      expect(r).toEqual({ ok: true, value: "hello" });
    });
  });

  describe("err()", () => {
    it("constructs an Err with ok:false and the given error", () => {
      const r = err("bad input");
      expect(r.ok).toBe(false);
      expect((r as Err<string>).error).toBe("bad input");
    });

    it("narrows to Err<E> when isErr returns true", () => {
      const r: Result<number, string> = err("something went wrong");
      if (isErr(r)) {
        // TypeScript sees r as Err<string> here
        const e: string = r.error;
        expect(e).toBe("something went wrong");
      } else {
        throw new Error("should have been err");
      }
    });

    it("has readonly ok and error fields", () => {
      const r = err({ code: 404 });
      expect(r).toEqual({ ok: false, error: { code: 404 } });
    });
  });

  describe("isOk()", () => {
    it("returns true for ok results", () => {
      expect(isOk(ok("x"))).toBe(true);
    });

    it("returns false for err results", () => {
      expect(isOk(err("x"))).toBe(false);
    });
  });

  describe("isErr()", () => {
    it("returns true for err results", () => {
      expect(isErr(err("x"))).toBe(true);
    });

    it("returns false for ok results", () => {
      expect(isErr(ok("x"))).toBe(false);
    });
  });
});
