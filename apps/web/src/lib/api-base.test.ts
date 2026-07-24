/**
 * api-base.test.ts — regression suite for the API base-URL resolver.
 *
 * The bug this pins: `import.meta.env.VITE_API_BASE_URL.replace(...)` threw
 * "Cannot read properties of undefined" whenever the variable was absent, taking down
 * every useLiveStream test (24 of them) on any machine without a local `.env.local` —
 * which is exactly CI. `vite-env.d.ts` declared the variable as a non-optional `string`,
 * so the compiler never objected even though nothing guaranteed it.
 *
 * An empty base is a SUPPORTED configuration, not an error: it means "same origin, use a
 * relative path", which is how the dev server and the Vercel deployment both run.
 */
import { describe, it, expect } from "vitest";
import { resolveApiBase } from "./api-base.ts";

describe("resolveApiBase", () => {
  it("returns an empty string when the variable is undefined (the CI/fresh-clone case)", () => {
    expect(resolveApiBase(undefined)).toBe("");
  });

  it("returns an empty string when the variable is set but empty (relative-path mode)", () => {
    expect(resolveApiBase("")).toBe("");
  });

  it("strips exactly one trailing slash so the caller can always concatenate a rooted path", () => {
    expect(resolveApiBase("https://api.morai.wtf/")).toBe("https://api.morai.wtf");
  });

  it("leaves a base without a trailing slash untouched", () => {
    expect(resolveApiBase("https://api.morai.wtf")).toBe("https://api.morai.wtf");
  });

  it("preserves a path prefix on the base", () => {
    expect(resolveApiBase("https://api.morai.wtf/v1/")).toBe("https://api.morai.wtf/v1");
  });
});
