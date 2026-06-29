/**
 * analytics.routes.test.ts — ANLY-03 HTTP route tests for GET /api/analytics/term-structure,
 * GET /api/analytics/skew, and GET /api/analytics/cot.
 *
 * MCP-02: the SAME termStructureResponse / skewResponse / cotResponse schemas are used here
 * and in the corresponding MCP tools. A one-sided field rename fails typecheck.
 *
 * SPEC R5: empty array (not error) when no data; flat {error:"internal"} on storage error.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetTermStructure, ForRunningGetSkew, ForRunningGetCot } from "@morai/core";
import { termStructureResponse, skewResponse, cotResponse } from "@morai/contracts";
import { analyticsRoutes } from "./analytics.routes.ts";

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Default fakes (empty) — overridable per test for the /skew and /cot cases.
const skewEmpty: ForRunningGetSkew = async () => ok([]);
const cotEmpty: ForRunningGetCot = async () => ok([]);

function buildApp(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew = skewEmpty,
  getCot: ForRunningGetCot = cotEmpty,
) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(getTermStructure, getSkew, getCot));
  return app;
}

function buildSkewApp(getSkew: ForRunningGetSkew) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, getSkew, cotEmpty));
  return app;
}

function buildCotApp(getCot: ForRunningGetCot) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, skewEmpty, getCot));
  return app;
}

const withData: ForRunningGetTermStructure = async () =>
  ok([
    {
      snapshotTime: new Date("2026-07-01T19:00:00Z"),
      calendarId: CAL_A,
      value: 0.05,
      frontIv: 0.2,
      backIv: 0.25,
    },
  ]);

const empty: ForRunningGetTermStructure = async () => ok([]);

const errored: ForRunningGetTermStructure = async () =>
  err({ kind: "storage-error", message: "boom" });

// ─── Skew (headline risk-reversal) fakes ───────────────────────────────────────
const skewWithData: ForRunningGetSkew = async () =>
  ok([
    {
      snapshotTime: new Date("2026-07-01T19:00:00Z"),
      underlying: "SPX",
      expiration: "2026-07-17",
      riskReversal: 0.06,
      rrRank: 50,
    },
  ]);

const skewErrored: ForRunningGetSkew = async () =>
  err({ kind: "storage-error", message: "boom" });

describe("GET /api/analytics/term-structure", () => {
  it("returns a contract-valid array with ≥1 entry when data exists", async () => {
    const app = buildApp(withData);
    const res = await app.request("/api/analytics/term-structure");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Parsing must succeed — proves MCP-02 contract conformance.
    const parsed = termStructureResponse.parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.calendarId).toBe(CAL_A);
    expect(parsed[0]?.value).toBe(0.05);
    expect(parsed[0]?.time).toBe("2026-07-01T19:00:00.000Z");
  });

  it("returns a contract-valid EMPTY array (not an error) when there is no data", async () => {
    const app = buildApp(empty);
    const res = await app.request("/api/analytics/term-structure");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = termStructureResponse.parse(body);
    expect(parsed).toEqual([]);
  });

  it("forwards the optional ?calendarId filter to the use-case", async () => {
    let received: { readonly calendarId?: string } | undefined;
    const spy: ForRunningGetTermStructure = async (query) => {
      received = query;
      return ok([]);
    };
    const app = buildApp(spy);
    await app.request(`/api/analytics/term-structure?calendarId=${CAL_A}`);
    expect(received?.calendarId).toBe(CAL_A);
  });

  it("maps a storage error to a flat {error:'internal'} 500 (T-06-08)", async () => {
    const app = buildApp(errored);
    const res = await app.request("/api/analytics/term-structure");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
  });
});

describe("GET /api/analytics/skew", () => {
  it("returns a contract-valid array with ≥1 entry when data exists (value=risk_reversal + rrRank)", async () => {
    const app = buildSkewApp(skewWithData);
    const res = await app.request("/api/analytics/skew");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Parsing must succeed — proves MCP-02 contract conformance.
    const parsed = skewResponse.parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.underlying).toBe("SPX");
    expect(parsed[0]?.expiration).toBe("2026-07-17");
    expect(parsed[0]?.value).toBe(0.06);
    expect(parsed[0]?.rrRank).toBe(50);
    expect(parsed[0]?.time).toBe("2026-07-01T19:00:00.000Z");
  });

  it("returns a contract-valid EMPTY array (not an error) when there is no data", async () => {
    const app = buildSkewApp(skewEmpty);
    const res = await app.request("/api/analytics/skew");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(skewResponse.parse(body)).toEqual([]);
  });

  it("forwards the optional ?underlying and ?expiration filters to the use-case", async () => {
    let received: { underlying?: string; expiration?: string } | undefined;
    const spy: ForRunningGetSkew = async (query) => {
      received = query;
      return ok([]);
    };
    const app = buildSkewApp(spy);
    await app.request("/api/analytics/skew?underlying=SPX&expiration=2026-07-17");
    expect(received?.underlying).toBe("SPX");
    expect(received?.expiration).toBe("2026-07-17");
  });

  it("maps a storage error to a flat {error:'internal'} 500 (T-06-13)", async () => {
    const app = buildSkewApp(skewErrored);
    const res = await app.request("/api/analytics/skew");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
  });
});

// ─── COT (CFTC TFF weekly series) fakes ───────────────────────────────────────

const cotEntry = {
  asOf: "2026-04-08",
  publishedAt: "2026-04-11T14:00:00.000Z",
  contractCode: "13874A",
  openInterest: 1_000_000,
  dealerLong: 100,
  dealerShort: 50,
  netDealer: 50,
  assetMgrLong: 200,
  assetMgrShort: 100,
  netAssetManager: 100,
  levMoneyLong: 300,
  levMoneyShort: 200,
  netLeveraged: 100,
  otherReptLong: 50,
  otherReptShort: 30,
  netOther: 20,
  nonreptLong: 40,
  nonreptShort: 20,
  netNonreportable: 20,
};

const cotWithData: ForRunningGetCot = async () => ok([cotEntry]);

const cotErrored: ForRunningGetCot = async () =>
  err({ kind: "storage-error", message: "boom" });

describe("GET /api/analytics/cot", () => {
  it("returns a contract-valid array with ≥1 entry when data exists (MCP-02)", async () => {
    const app = buildCotApp(cotWithData);
    const res = await app.request("/api/analytics/cot");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Parsing must succeed — proves MCP-02 contract conformance.
    const parsed = cotResponse.parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.asOf).toBe("2026-04-08");
    expect(parsed[0]?.contractCode).toBe("13874A");
    expect(parsed[0]?.netLeveraged).toBe(100);
  });

  it("returns a contract-valid EMPTY array (not an error) when there is no data", async () => {
    const app = buildCotApp(cotEmpty);
    const res = await app.request("/api/analytics/cot");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = cotResponse.parse(body);
    expect(parsed).toEqual([]);
  });

  it("maps a storage error to a flat {error:'internal'} 500 (T-13-06-INJ)", async () => {
    const app = buildCotApp(cotErrored);
    const res = await app.request("/api/analytics/cot");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
  });
});
