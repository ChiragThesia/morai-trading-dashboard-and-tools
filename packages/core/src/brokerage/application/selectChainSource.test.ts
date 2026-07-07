import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { ObservationRow, SnapshotRow, ForFetchingChain } from "../../journal/application/ports.ts";
import type { ForReadingTokenFreshness } from "./ports.ts";
import { selectChainSources } from "./selectChainSource.ts";

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

// ─── selectChainSources unit tests ────────────────────────────────────────────
//
// chain-window-narrow-regression: the selector returns the LIST of fetchers to run
// each cycle, not a single winner. Schwab alone is too narrow (bounded window) and
// CBOE alone is delayed — a healthy token means BOTH run; otherwise CBOE only.
// The old single-fetcher runtime fallback (BUG 3) is subsumed: CBOE is always
// fetched, and partial-failure tolerance lives in the fetchChain use-case.

/**
 * Minimal ForFetchingChain stub — always returns err for test isolation.
 * Selection tests assert by fetcher IDENTITY; these are never called.
 */
function makeStubChain(label: string): ForFetchingChain {
  return async (_root) => {
    return err({ kind: "fetch-error", message: `stub-${label}` });
  };
}

describe("selectChainSources", () => {
  const schwabChain = makeStubChain("schwab");
  const cboeChain = makeStubChain("cboe");

  function freshness(marketStatus: "fresh" | "stale" | "AUTH_EXPIRED" | "none_yet"): ForReadingTokenFreshness {
    const expiresAt = marketStatus === "fresh" || marketStatus === "stale" ? new Date() : null;
    return async () =>
      ok({
        trader: { status: "fresh", expiresAt: new Date(), refreshIssuedAt: new Date(), lastRefreshError: null, refreshExpiresIn: null },
        market: { status: marketStatus, expiresAt, refreshIssuedAt: expiresAt, lastRefreshError: null, refreshExpiresIn: null },
      });
  }

  it("returns [schwab, cboe] when market status is 'fresh' — dual-source cycle", async () => {
    const sources = await selectChainSources({
      readTokenFreshness: freshness("fresh"),
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]).toBe(schwabChain);
    expect(sources[1]).toBe(cboeChain);
  });

  it("returns [schwab, cboe] when market status is 'stale' — dual-source cycle", async () => {
    const sources = await selectChainSources({
      readTokenFreshness: freshness("stale"),
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]).toBe(schwabChain);
    expect(sources[1]).toBe(cboeChain);
  });

  it("returns [cboe] when market status is 'AUTH_EXPIRED' (D-08)", async () => {
    const sources = await selectChainSources({
      readTokenFreshness: freshness("AUTH_EXPIRED"),
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(cboeChain);
  });

  it("returns [cboe] when market status is 'none_yet' (safe default)", async () => {
    const sources = await selectChainSources({
      readTokenFreshness: freshness("none_yet"),
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(cboeChain);
  });

  it("returns [cboe] when readTokenFreshness returns 'none yet' string", async () => {
    const readTokenFreshness: ForReadingTokenFreshness = async () => ok("none yet");

    const sources = await selectChainSources({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(cboeChain);
  });

  it("returns [cboe] when readTokenFreshness returns err (safe default)", async () => {
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      err({ kind: "storage-error", message: "DB down" });

    const sources = await selectChainSources({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(cboeChain);
  });

  it("returns [cboe] when readTokenFreshness throws (journal never stalls)", async () => {
    const readTokenFreshness: ForReadingTokenFreshness = async () => {
      throw new Error("boom");
    };

    const sources = await selectChainSources({
      readTokenFreshness,
      schwabFetchChain: schwabChain,
      cboeFetchChain: cboeChain,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toBe(cboeChain);
  });
});
