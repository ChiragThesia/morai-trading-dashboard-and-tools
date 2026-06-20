import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ok, err } from "@morai/shared";
import { makeSchwabChainAdapter } from "./chain-adapter.ts";
import schwabChainFixture from "../../test/fixtures/schwab-chain.fixture.json";

const SCHWAB_CHAIN_URL = "https://api.schwabapi.com/marketdata/v1/chains";

const server = setupServer(
  http.get(SCHWAB_CHAIN_URL, () => HttpResponse.json(schwabChainFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Factory helper — build adapter with fresh token by default
function makeAdapter(overrides?: {
  getAccessToken?: () => Promise<ReturnType<typeof ok<string>> | ReturnType<typeof err<{ kind: "auth-expired"; appId: "trader" | "market" }>>>;
  symbol?: string;
}) {
  return makeSchwabChainAdapter({
    fetch: globalThis.fetch,
    getAccessToken: overrides?.getAccessToken ?? (async () => ok("test-access-token")),
    userAgent: "Morai-Test/1.0",
    symbol: overrides?.symbol ?? "$SPX",
  });
}

describe("makeSchwabChainAdapter", () => {
  describe("fetchChain('SPX') — success path", () => {
    it("returns ok(RawChain) from fixture", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
    });

    it("root matches the requested root", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.root).toBe("SPX");
    });

    it("spot comes from top-level underlyingPrice", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // schwab-chain.fixture.json has underlyingPrice: 5950.25
      expect(result.value.spot).toBe(5950.25);
    });

    it("flattens both callExpDateMap and putExpDateMap into quotes", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Fixture has at least one call and one put
      expect(result.value.quotes.length).toBeGreaterThanOrEqual(2);
    });

    it("every occSymbol is exactly 21 chars", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const q of result.value.quotes) {
        expect(q.occSymbol).toHaveLength(21);
      }
    });

    it("maps bidPrice/askPrice/markPrice to bid/ask/mark", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const call = result.value.quotes.find((q) => q.contractType === "C");
      expect(call).toBeDefined();
      if (call === undefined) return;
      // From fixture: bidPrice=45.5, askPrice=46.0, markPrice=45.75
      expect(call.bid).toBe(45.5);
      expect(call.ask).toBe(46.0);
      expect(call.mark).toBe(45.75);
    });

    it("maps totalVolume to volume", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const call = result.value.quotes.find((q) => q.contractType === "C");
      expect(call).toBeDefined();
      if (call === undefined) return;
      // From fixture: totalVolume: 1234
      expect(call.volume).toBe(1234);
    });

    it("strikePrice from Schwab is already in points (no division by 1000)", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Fixture call has strikePrice: 5950 (points), not 5950000
      const call = result.value.quotes.find((q) => q.contractType === "C");
      expect(call).toBeDefined();
      if (call === undefined) return;
      expect(call.strike).toBe(5950);
    });

    it("carries through vendor greeks (delta, gamma, theta, vega)", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const call = result.value.quotes.find((q) => q.contractType === "C");
      expect(call).toBeDefined();
      if (call === undefined) return;
      expect(call.delta).not.toBeNull();
      expect(call.gamma).not.toBeNull();
      expect(call.theta).not.toBeNull();
      expect(call.vega).not.toBeNull();
    });

    it("sends Authorization: Bearer header on outbound request", async () => {
      let capturedAuth: string | null = null;
      server.use(
        http.get(SCHWAB_CHAIN_URL, ({ request }) => {
          capturedAuth = request.headers.get("authorization");
          return HttpResponse.json(schwabChainFixture);
        }),
      );
      const adapter = makeAdapter();
      await adapter.fetchChain("SPX");
      expect(capturedAuth).toBe("Bearer test-access-token");
    });
  });

  describe("error handling", () => {
    it("returns err when getAccessToken returns err — does NOT call fetch", async () => {
      let fetchCalled = false;
      server.use(
        http.get(SCHWAB_CHAIN_URL, () => {
          fetchCalled = true;
          return HttpResponse.json(schwabChainFixture);
        }),
      );

      const adapter = makeAdapter({
        getAccessToken: async () =>
          err({ kind: "auth-expired" as const, appId: "market" as const }),
      });

      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(result.error.message).toContain("AUTH_EXPIRED");
      expect(fetchCalled).toBe(false);
    });

    it("returns err on HTTP 401 (Unauthorized)", async () => {
      server.use(
        http.get(SCHWAB_CHAIN_URL, () =>
          new HttpResponse(null, { status: 401 }),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns err on HTTP 400 (bad request)", async () => {
      server.use(
        http.get(SCHWAB_CHAIN_URL, () =>
          new HttpResponse(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns err on malformed JSON — never throws (D-12)", async () => {
      server.use(
        http.get(SCHWAB_CHAIN_URL, () =>
          new HttpResponse("totally wrong body", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const adapter = makeAdapter();
      await expect(adapter.fetchChain("SPX")).resolves.toMatchObject({
        ok: false,
      });
    });

    it("returns err when Zod parse fails on wrong shape — never throws", async () => {
      server.use(
        http.get(SCHWAB_CHAIN_URL, () =>
          HttpResponse.json({ totally: "wrong" }),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      // No underlyingPrice → err (missing spot)
      expect(result.ok).toBe(false);
    });
  });
});
