/**
 * RED scaffold — TS sidecar chain adapter Zod-parse tests (JRNL-02).
 *
 * This test imports makeSidecarChainAdapter from ./chain-adapter.ts which does not
 * exist yet. It MUST fail on the unresolved import (TDD red-first).
 *
 * Expected failure:
 *   Error: Cannot find module './chain-adapter.ts'
 *
 * Turn these green in Phase 11 plan 05 when chain-adapter.ts is implemented.
 *
 * Pins the D-08 contract: the Python /sidecar/chain response Zod-parses into a
 * RawChain with source: "schwab_chain", and a 503 AUTH_EXPIRED body maps to
 * err({kind:"fetch-error", message:"AUTH_EXPIRED"}).
 */
import { describe, it, expect } from "vitest";

// RED: This import fails until chain-adapter.ts is created (11-05).
import { makeSidecarChainAdapter } from "./chain-adapter.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid /sidecar/chain response body matching Pattern 5 in RESEARCH.md */
const VALID_CHAIN_BODY = {
  root: "SPX",
  observedAt: "2026-06-25T15:30:00.000Z",
  spot: 5950.0,
  quotes: [
    {
      occSymbol: "SPX   260620C05950000",
      contractType: "C",
      strike: 5950.0,
      expiry: "2026-06-20T00:00:00.000Z",
      bid: 12.5,
      ask: 13.0,
      mark: 12.75,
      iv: 0.18,
      delta: 0.45,
      gamma: 0.002,
      theta: -0.85,
      vega: 1.2,
      openInterest: 1500,
      volume: 320,
    },
  ],
  source: "schwab_chain",
} as const;

/** Helper: build a fake fetch that returns the given body and status */
function makeFakeFetch(body: unknown, status: number): typeof globalThis.fetch {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const resp: Response = new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    return resp;
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("makeSidecarChainAdapter", () => {
  it("Zod-parses a valid /sidecar/chain response into RawChain with source schwab_chain", async () => {
    const adapter = makeSidecarChainAdapter({
      fetch: makeFakeFetch(VALID_CHAIN_BODY, 200),
      sidecarUrl: "http://sidecar.railway.internal:8000",
    });

    const result = await adapter.fetchChain("SPX");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    const chain = result.value;
    expect(chain.source).toBe("schwab_chain");
    expect(chain.root).toBe("SPX");
    expect(chain.spot).toBe(5950.0);
    expect(chain.quotes).toHaveLength(1);
    expect(chain.observedAt).toBeInstanceOf(Date);

    const quote = chain.quotes[0];
    expect(quote).toBeDefined();
    if (!quote) throw new Error("Expected at least one quote");
    expect(quote.contractType).toBe("C");
    expect(quote.strike).toBe(5950.0);
    expect(quote.expiry).toBeInstanceOf(Date);
  });

  it("maps a 503 AUTH_EXPIRED response to err({kind:fetch-error, message:AUTH_EXPIRED})", async () => {
    const adapter = makeSidecarChainAdapter({
      fetch: makeFakeFetch({ error: "AUTH_EXPIRED" }, 503),
      sidecarUrl: "http://sidecar.railway.internal:8000",
    });

    const result = await adapter.fetchChain("SPX");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");

    expect(result.error.kind).toBe("fetch-error");
    expect(result.error.message).toBe("AUTH_EXPIRED");
  });

  it("maps a network error to err({kind:fetch-error})", async () => {
    const throwingFetch: typeof globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const adapter = makeSidecarChainAdapter({
      fetch: throwingFetch,
      sidecarUrl: "http://sidecar.railway.internal:8000",
    });

    const result = await adapter.fetchChain("SPX");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("fetch-error");
  });

  it("maps a parse failure (schema mismatch) to err({kind:fetch-error})", async () => {
    const adapter = makeSidecarChainAdapter({
      fetch: makeFakeFetch({ invalid: "response" }, 200),
      sidecarUrl: "http://sidecar.railway.internal:8000",
    });

    const result = await adapter.fetchChain("SPX");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.kind).toBe("fetch-error");
  });
});
