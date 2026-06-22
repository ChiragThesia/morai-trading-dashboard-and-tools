/**
 * setup.test.ts — TDD unit tests for validateAndExchange (pure CSRF + code-exchange).
 *
 * Uses an in-memory fake OAuthClientPort (spy counter) — no live Schwab, no msw.
 *
 * Three behaviors (plan 04-03 Task 2):
 *   1. state-mismatch: result.state !== expectedState → err({kind:"state-mismatch"})
 *      AND client.exchangeCode NEVER called (0 calls — CSRF ordering invariant)
 *   2. happy path: state matches + exchange ok → ok(tokens), exchange called once with result.code
 *   3. exchange-failure: state matches + exchange returns err → err({kind:"exchange-failure"}),
 *      no fabricated tokens
 */
import { describe, it, expect } from "vitest";
import { validateAndExchange } from "./setup.ts";
import type { OAuthClientPort, CallbackResult } from "./setup.ts";
import type { SchwabTokens, OAuthError } from "@morai/adapters";
import type { Result } from "@morai/shared";

// ─── Fake OAuthClientPort (in-memory spy) ────────────────────────────────────

type FakeExchangeResult = Result<SchwabTokens, OAuthError>;

function makeFakeClient(returnValue: FakeExchangeResult): {
  client: OAuthClientPort;
  callCount: () => number;
  calledWithCode: () => string | undefined;
} {
  let calls = 0;
  let lastCode: string | undefined;

  const exchangeCode = async (code: string): Promise<FakeExchangeResult> => {
    calls++;
    lastCode = code;
    return returnValue;
  };

  return {
    client: { exchangeCode },
    callCount: () => calls,
    calledWithCode: () => lastCode,
  };
}

const SAMPLE_TOKENS: SchwabTokens = {
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  expiresIn: 1800,
};

const EXCHANGE_ERROR: OAuthError = {
  kind: "oauth-error",
  code: "invalid_grant",
  message: "Authorization code expired",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateAndExchange", () => {
  describe("state-mismatch (CSRF defense)", () => {
    it("returns err({kind:'state-mismatch'}) when result.state differs from expectedState", async () => {
      const { client, callCount } = makeFakeClient({ ok: true, value: SAMPLE_TOKENS });
      const result: CallbackResult = { code: "auth-code-abc", state: "wrong-state" };

      const out = await validateAndExchange(result, "expected-state", client);

      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.kind).toBe("state-mismatch");
      }
      // CSRF ordering invariant: exchangeCode MUST NOT have been called
      expect(callCount()).toBe(0);
    });

    it("does NOT call exchangeCode when state mismatches (ordering invariant)", async () => {
      const { client, callCount } = makeFakeClient({ ok: true, value: SAMPLE_TOKENS });

      await validateAndExchange(
        { code: "any-code", state: "attacker-state" },
        "legitimate-state",
        client,
      );

      expect(callCount()).toBe(0);
    });
  });

  describe("happy path (state match + successful exchange)", () => {
    it("returns ok(tokens) when state matches and exchange succeeds", async () => {
      const { client } = makeFakeClient({ ok: true, value: SAMPLE_TOKENS });
      const result: CallbackResult = { code: "valid-code", state: "csrf-state-123" };

      const out = await validateAndExchange(result, "csrf-state-123", client);

      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.value).toEqual(SAMPLE_TOKENS);
      }
    });

    it("calls exchangeCode exactly once with result.code", async () => {
      const { client, callCount, calledWithCode } = makeFakeClient({
        ok: true,
        value: SAMPLE_TOKENS,
      });
      const code = "the-authorization-code";

      await validateAndExchange({ code, state: "match" }, "match", client);

      expect(callCount()).toBe(1);
      expect(calledWithCode()).toBe(code);
    });
  });

  describe("exchange-failure (state match + OAuthError from exchange)", () => {
    it("returns err({kind:'exchange-failure'}) when exchangeCode fails", async () => {
      const { client } = makeFakeClient({ ok: false, error: EXCHANGE_ERROR });
      const result: CallbackResult = { code: "code", state: "state" };

      const out = await validateAndExchange(result, "state", client);

      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.kind).toBe("exchange-failure");
      }
    });

    it("includes the OAuthError cause in exchange-failure", async () => {
      const { client } = makeFakeClient({ ok: false, error: EXCHANGE_ERROR });

      const out = await validateAndExchange({ code: "c", state: "s" }, "s", client);

      expect(out.ok).toBe(false);
      if (!out.ok && out.error.kind === "exchange-failure") {
        expect(out.error.cause).toEqual(EXCHANGE_ERROR);
      }
    });

    it("does NOT fabricate tokens on exchange failure", async () => {
      const { client } = makeFakeClient({ ok: false, error: EXCHANGE_ERROR });

      const out = await validateAndExchange({ code: "c", state: "s" }, "s", client);

      expect(out.ok).toBe(false);
      // Ensure ok is false — there is no value to inspect
    });
  });
});
