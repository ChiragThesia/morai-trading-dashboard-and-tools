import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeCboeChainAdapter } from "./cboe.ts";
import spxFixture from "../../test/fixtures/cboe-spx.fixture.json";

const CBOE_SPX_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";

const server = setupServer(
  http.get(CBOE_SPX_URL, () => HttpResponse.json(spxFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Create adapter inside tests (after server.listen) to ensure msw intercepts
function makeAdapter() {
  return makeCboeChainAdapter({
    fetch: globalThis.fetch,
    userAgent: "Morai-Test/1.0",
  });
}

describe("makeCboeChainAdapter", () => {
  describe("fetchChain('SPXW')", () => {
    it("returns ok with quotes whose occSymbol values are 21 chars", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.root).toBe("SPXW");
      expect(result.value.quotes.length).toBeGreaterThan(0);
      for (const q of result.value.quotes) {
        expect(q.occSymbol).toHaveLength(21);
      }
    });

    it("returns only SPXW-root quotes when called with 'SPXW'", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // All returned quotes should be SPXW root (OCC: "SPXW  " = 4+2 spaces)
      for (const q of result.value.quotes) {
        expect(q.occSymbol.slice(0, 4)).toBe("SPXW");
      }
    });

    it("returns spot from current_price", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.spot).toBe(7274.1401);
    });

    it("parses observedAt as a UTC Date (ET timestamp + offset)", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // "2026-06-11 15:13:25" ET = 19:13:25 UTC (EDT = UTC-4)
      const utcHours = result.value.observedAt.getUTCHours();
      expect(utcHours).toBe(19);
    });
  });

  describe("fetchChain('SPX')", () => {
    it("returns ok with SPX-root quotes", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.root).toBe("SPX");
      expect(result.value.quotes.length).toBeGreaterThan(0);
      for (const q of result.value.quotes) {
        expect(q.occSymbol.slice(0, 3)).toBe("SPX");
        // SPX root: 4th char must not be 'W' (that would be SPXW)
        expect(q.occSymbol[3]).not.toBe("W");
      }
    });
  });

  describe("error handling", () => {
    it("returns err with kind=fetch-error when payload missing data.options", async () => {
      server.use(
        http.get(CBOE_SPX_URL, () =>
          HttpResponse.json({ timestamp: "2026-06-11 15:00:00", data: {} }),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("does not throw on malformed payload — returns err", async () => {
      server.use(
        http.get(CBOE_SPX_URL, () =>
          HttpResponse.json({ totally: "wrong" }),
        ),
      );
      const adapter = makeAdapter();
      await expect(adapter.fetchChain("SPX")).resolves.toMatchObject({
        ok: false,
      });
    });

    it("returns err when spot is null/0 (Pitfall 3)", async () => {
      server.use(
        http.get(CBOE_SPX_URL, () =>
          HttpResponse.json({
            timestamp: "2026-06-11 15:00:00",
            data: {
              current_price: null,
              close: null,
              prev_day_close: null,
              options: [],
            },
          }),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(false);
    });
  });
});
