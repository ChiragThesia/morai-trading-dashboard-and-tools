import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { ForRunningGetChain } from "@morai/core";
import { chainResponse } from "@morai/contracts";
import { chainRoutes } from "./chain.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

/** Solved-IV call leg. `strike` is the ×1000 int convention (7400000 = 7400). */
const CALL_ROW = {
  strike: 7400000,
  expiration: "2026-08-21",
  contractType: "C" as const,
  dte: 26,
  bsmIv: 0.1842,
  bid: 121.4,
  ask: 123.2,
  openInterest: 4210,
  // underlyingPrice is the OPPOSITE convention to strike — unscaled index points.
  underlyingPrice: 7381.12,
  source: "schwab" as const,
  observedAt: "2026-07-26T15:00:00.000Z",
};

/** Half-strike put leg with UNSOLVED IV — bsmIv is nullable but never optional, never 0. */
const PUT_ROW = {
  strike: 7412500, // 7412.5 strike — proves the ×1000 int convention survives the seam
  expiration: "2026-09-18",
  contractType: "P" as const,
  dte: 54,
  bsmIv: null,
  bid: 208.9,
  ask: 211.5,
  openInterest: 877,
  underlyingPrice: 7381.12,
  source: "cboe" as const,
  observedAt: "2026-07-26T15:00:00.000Z",
};

/** Returns a two-leg cohort */
const getChainOk: ForRunningGetChain = async () => ok([CALL_ROW, PUT_ROW]);

/**
 * Returns an EMPTY cohort — the cold-start / no-data case.
 * Array read, so this is 200 + [], never 404 (the GEX 404-on-null rule does NOT apply here).
 */
const getChainEmpty: ForRunningGetChain = async () => ok([]);

/**
 * Returns rows carrying internal repo fields the contract does not publish.
 * Structural widening — ReadonlyArray<ChainEntry> accepts the wider row, so this compiles
 * without a cast and proves the route strips rather than forwards.
 */
const LEAKY_ROW = { ...CALL_ROW, root: "SPXW", time: new Date("2026-07-26T15:00:00.000Z"), rowId: 99 };
const getChainLeaky: ForRunningGetChain = async () => ok([LEAKY_ROW]);

/** Returns a storage error */
const getChainErr: ForRunningGetChain = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(getChain: ForRunningGetChain) {
  const app = new Hono();
  // Mounted at "/" matching the main.ts apiRouter chain — effective path is GET /api/chain.
  app.route("/", chainRoutes(getChain));
  return app;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("GET /chain", () => {
  it("returns 200 with a chainResponse-valid body for a stored cohort", async () => {
    const app = buildTestApp(getChainOk);
    const res = await app.request("/chain");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must parse through the contract without throwing (MCP-02 contract parity)
    const parsed = chainResponse.parse(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.strike).toBe(7400000);
    expect(parsed[0]?.contractType).toBe("C");
    expect(parsed[0]?.bsmIv).toBe(0.1842);
    expect(parsed[0]?.source).toBe("schwab");
    expect(parsed[0]?.observedAt).toBe("2026-07-26T15:00:00.000Z");
    // Half-strike survives the seam as a ×1000 int, and unsolved IV stays explicitly null.
    expect(parsed[1]?.strike).toBe(7412500);
    expect(parsed[1]?.bsmIv).toBeNull();
    expect(parsed[1]?.source).toBe("cboe");
  });

  it("returns 200 + [] when the store is empty — an array read NEVER 404s", async () => {
    const app = buildTestApp(getChainEmpty);
    const res = await app.request("/chain");
    // The GEX 404-on-null pattern is for a single object; this endpoint is an array (COT rule).
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toStrictEqual([]);
    expect(chainResponse.parse(body)).toStrictEqual([]);
  });

  it("returns 500 {error:'internal'} when getChain returns a storage error", async () => {
    const app = buildTestApp(getChainErr);
    const res = await app.request("/chain");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    // Flat error — the DB message never reaches the wire.
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("body passes chainResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(getChainOk);
    const res = await app.request("/chain");
    const body: unknown = await res.json();
    expect(() => chainResponse.parse(body)).not.toThrow();
  });

  it("does NOT leak internal repo fields (root/time/rowId) — the route Zod-parses on the way out", async () => {
    const app = buildTestApp(getChainLeaky);
    const res = await app.request("/chain");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Read the RAW body as open records — a bare c.json(rows) would forward the extra keys
    // and fail here. chainResponse.parse() would itself strip them, so it cannot be the probe.
    const rawRows = z.array(z.record(z.string(), z.unknown())).parse(body);
    const rawKeys = Object.keys(rawRows[0] ?? {}).sort();
    expect(rawKeys).not.toContain("root");
    expect(rawKeys).not.toContain("time");
    expect(rawKeys).not.toContain("rowId");
    expect(rawKeys).toStrictEqual(
      [
        "ask",
        "bid",
        "bsmIv",
        "contractType",
        "dte",
        "expiration",
        "observedAt",
        "openInterest",
        "source",
        "strike",
        "underlyingPrice",
      ].sort(),
    );
  });
});
