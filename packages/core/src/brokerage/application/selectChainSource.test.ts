import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { ObservationRow, SnapshotRow, ForFetchingChain } from "../../journal/application/ports.ts";
import type { ForReadingTokenFreshness } from "./ports.ts";
import { selectChainSource } from "./selectChainSource.ts";

// ─── Type-level widening tests (compile-time; runtime just asserts assignability) ──

// Build a valid OccSymbol without `as` — use the branded constructor from @morai/shared
const testOccSymbol = formatOccSymbol({
  root: "SPX",
  expiry: new Date(2026, 5, 20),
  type: "P",
  strike: 7100,
});

describe("ports source widening", () => {
  it("ObservationRow accepts source='schwab_chain'", () => {
    // If ports.ts still has source: "cboe" only, this will cause a TypeScript compile error.
    const row: ObservationRow = {
      time: new Date(),
      contract: testOccSymbol,
      bid: 1,
      ask: 2,
      mark: 1.5,
      underlyingPrice: 7100,
      iv: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      openInterest: 0,
      volume: 0,
      source: "schwab_chain",
    };
    expect(row.source).toBe("schwab_chain");
  });

  it("SnapshotRow accepts source='schwab_chain'", () => {
    const row: SnapshotRow = {
      time: new Date(),
      calendarId: "550e8400-e29b-41d4-a716-446655440000",
      spot: "7100",
      netMark: "5.0",
      frontMark: "3.0",
      backMark: "8.0",
      frontIv: "0.20",
      backIv: "0.22",
      frontIvRaw: "0.19",
      backIvRaw: "0.21",
      netDelta: "-0.01",
      netGamma: "0.001",
      netTheta: "2.5",
      netVega: "0.5",
      termSlope: "0.01",
      dteFront: 7,
      dteBack: 35,
      pnlOpen: "0.5",
      source: "schwab_chain",
    };
    expect(row.source).toBe("schwab_chain");
  });
});

// ─── selectChainSource unit tests ─────────────────────────────────────────────

/**
 * Minimal ForFetchingChain stub — always returns err for test isolation.
 */
function makeStubChain(label: string): ForFetchingChain {
  return async (_root) => {
    return err({ kind: "fetch-error", message: `stub-${label}` });
  };
}

/**
 * Minimal ForFetchingChain stub — always succeeds, tagged by `source` so a test
 * can assert WHICH fetcher's result was actually returned (BUG 3 regression).
 */
function makeSuccessChain(source: "schwab_chain" | "cboe"): ForFetchingChain {
  return async (root) => ok({ root, observedAt: new Date(), spot: 100, quotes: [], source });
}

describe("selectChainSource", () => {
  it("returns schwabFetchChain's result when market status is 'fresh' and the call succeeds", async () => {
    const schwabChain = makeSuccessChain("schwab_chain");
    const cboeChain = makeStubChain("cboe"); // must NOT be called — errors if it is

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok({
        trader: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
        market: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
      });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("schwab_chain");
  });

  it("returns schwabFetchChain's result when market status is 'stale' and the call succeeds", async () => {
    const schwabChain = makeSuccessChain("schwab_chain");
    const cboeChain = makeStubChain("cboe"); // must NOT be called — errors if it is

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok({
        trader: { status: "stale", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
        market: { status: "stale", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
      });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("schwab_chain");
  });

  it("falls back to cboeFetchChain when the Schwab call fails at runtime despite a fresh token (BUG 3 regression, chain-frozen-schwab-symbol)", async () => {
    // A healthy/fresh token does not guarantee the Schwab call itself succeeds
    // (malformed request, transient 5xx, network blip). Before the fix, this left
    // the pipeline permanently dark behind a healthy token — selectChainSource
    // only reacted to token freshness, never to the call outcome.
    const schwabChain = makeStubChain("schwab"); // call fails for a non-auth reason
    const cboeChain = makeSuccessChain("cboe");

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok({
        trader: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
        market: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
      });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("cboe");
  });

  it("returns cboeFetchChain when market status is 'AUTH_EXPIRED' (D-08)", async () => {
    const schwabChain = makeStubChain("schwab");
    const cboeChain = makeStubChain("cboe");

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok({
        trader: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
        market: { status: "AUTH_EXPIRED", expiresAt: null, refreshIssuedAt: null, lastRefreshError: null, refreshExpiresIn: null },
      });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("stub-cboe");
  });

  it("returns cboeFetchChain when market status is 'none_yet' (safe default)", async () => {
    const schwabChain = makeStubChain("schwab");
    const cboeChain = makeStubChain("cboe");

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok({
        trader: { status: "none_yet", expiresAt: null, refreshIssuedAt: null, lastRefreshError: null, refreshExpiresIn: null },
        market: { status: "none_yet", expiresAt: null, refreshIssuedAt: null, lastRefreshError: null, refreshExpiresIn: null },
      });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("stub-cboe");
  });

  it("returns cboeFetchChain when readTokenFreshness returns 'none yet' string", async () => {
    const schwabChain = makeStubChain("schwab");
    const cboeChain = makeStubChain("cboe");

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok("none yet");

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("stub-cboe");
  });

  it("returns cboeFetchChain when readTokenFreshness returns err (safe default)", async () => {
    const schwabChain = makeStubChain("schwab");
    const cboeChain = makeStubChain("cboe");

    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      err({ kind: "storage-error", message: "DB down" });

    const selected = await selectChainSource({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    const result = await selected("SPX");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("stub-cboe");
  });
});
