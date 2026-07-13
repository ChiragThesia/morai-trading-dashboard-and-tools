/**
 * makeExchangeReauth use-case tests (Phase 37, Plan 02, Task 2 — TDD RED phase).
 *
 * Behavior: makeExchangeReauth({ exchangeReauth }) returns a use-case fn that, given a
 * redirectUrl, passes through the injected ForExchangingReauth port's Result unchanged.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeExchangeReauth } from "./exchangeReauth.ts";
import type { ForExchangingReauth } from "./ports.ts";

describe("makeExchangeReauth", () => {
  it("passes an ok Result from the injected port straight through", async () => {
    const fakePort: ForExchangingReauth = async (redirectUrl) => {
      expect(redirectUrl).toBe("https://morai.wtf/?code=abc&state=nonce-1");
      return ok({ app: "trader", ok: true });
    };
    const exchangeReauth = makeExchangeReauth({ exchangeReauth: fakePort });

    const result = await exchangeReauth("https://morai.wtf/?code=abc&state=nonce-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value).toEqual({ app: "trader", ok: true });
  });

  it("passes an err Result from the injected port straight through", async () => {
    const fakePort: ForExchangingReauth = async () =>
      err({ kind: "parse-error", message: "sidecar reauth response parse error" });
    const exchangeReauth = makeExchangeReauth({ exchangeReauth: fakePort });

    const result = await exchangeReauth("https://morai.wtf/?code=abc&state=nonce-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err result");
    expect(result.error.kind).toBe("parse-error");
  });
});
