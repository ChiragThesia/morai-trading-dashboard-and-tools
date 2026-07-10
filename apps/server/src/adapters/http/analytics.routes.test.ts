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
import type {
  ForRunningGetTermStructure,
  ForRunningGetSkew,
  ForRunningGetCot,
  ForRunningGetMacro,
  ForRunningGetRegimeBoard,
} from "@morai/core";
import { termStructureResponse, skewResponse, cotResponse, macroResponse, regimeResponse } from "@morai/contracts";
import { analyticsRoutes } from "./analytics.routes.ts";

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Default fakes (empty) — overridable per test for the /skew, /cot, /macro, and /regime cases.
const skewEmpty: ForRunningGetSkew = async () => ok([]);
const cotEmpty: ForRunningGetCot = async () => ok([]);
const macroEmpty: ForRunningGetMacro = async () => ok({});
const regimeEmpty: ForRunningGetRegimeBoard = async () => ok([]);

function buildApp(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew = skewEmpty,
  getCot: ForRunningGetCot = cotEmpty,
  getMacro: ForRunningGetMacro = macroEmpty,
  getRegimeBoard: ForRunningGetRegimeBoard = regimeEmpty,
) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(getTermStructure, getSkew, getCot, getMacro, getRegimeBoard));
  return app;
}

function buildSkewApp(getSkew: ForRunningGetSkew) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, getSkew, cotEmpty, macroEmpty, regimeEmpty));
  return app;
}

function buildCotApp(getCot: ForRunningGetCot) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, skewEmpty, getCot, macroEmpty, regimeEmpty));
  return app;
}

function buildMacroApp(getMacro: ForRunningGetMacro) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, skewEmpty, cotEmpty, getMacro, regimeEmpty));
  return app;
}

function buildRegimeApp(getRegimeBoard: ForRunningGetRegimeBoard) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(empty, skewEmpty, cotEmpty, macroEmpty, getRegimeBoard));
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

// ─── Macro (FRED + VVIX series, MAC-02) ────────────────────────────────────────

const macroWithData: ForRunningGetMacro = async () =>
  ok({
    DFF: [{ time: "2026-04-01", value: 4.33 }],
    VVIX: [{ time: "2026-04-01", value: 89.0 }],
  });

const macroErrored: ForRunningGetMacro = async () =>
  err({ kind: "storage-error", message: "boom" });

describe("GET /api/analytics/macro", () => {
  it("returns a contract-valid map with the default window when no query params are given", async () => {
    const app = buildMacroApp(macroWithData);
    const res = await app.request("/api/analytics/macro");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Parsing must succeed — proves MCP-02 contract conformance.
    const parsed = macroResponse.parse(body);
    expect(parsed.DFF).toHaveLength(1);
    expect(parsed.DFF?.[0]?.value).toBe(4.33);
    expect(parsed.VVIX?.[0]?.value).toBe(89.0);
  });

  it("returns a contract-valid EMPTY map (not an error) when there is no data", async () => {
    const app = buildMacroApp(macroEmpty);
    const res = await app.request("/api/analytics/macro");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(macroResponse.parse(body)).toEqual({});
  });

  it("parses ?days=365&series=DFF,VVIX via macroQuery and forwards them to the use-case", async () => {
    let received: { days?: number; series?: ReadonlyArray<string> } | undefined;
    const spy: ForRunningGetMacro = async (query) => {
      received = query;
      return ok({ DFF: [{ time: "2026-04-01", value: 4.33 }] });
    };
    const app = buildMacroApp(spy);
    const res = await app.request("/api/analytics/macro?days=365&series=DFF,VVIX");
    expect(res.status).toBe(200);
    expect(received?.days).toBe(365);
    expect(received?.series).toEqual(["DFF", "VVIX"]);
    const body: unknown = await res.json();
    const parsed = macroResponse.parse(body);
    expect(Object.keys(parsed)).toEqual(["DFF"]);
  });

  it("rejects an invalid days param with 400 and never calls the use-case (T-14-01)", async () => {
    let calls = 0;
    const spy: ForRunningGetMacro = async () => {
      calls += 1;
      return ok({});
    };
    const app = buildMacroApp(spy);
    const res = await app.request("/api/analytics/macro?days=99999");
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("rejects an invalid series param with 400 and never calls the use-case (T-14-01)", async () => {
    let calls = 0;
    const spy: ForRunningGetMacro = async () => {
      calls += 1;
      return ok({});
    };
    const app = buildMacroApp(spy);
    const res = await app.request("/api/analytics/macro?series=BOGUS");
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("maps a storage error to a flat {error:'internal'} 500 (T-14-14)", async () => {
    const app = buildMacroApp(macroErrored);
    const res = await app.request("/api/analytics/macro");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
  });
});

// ─── Regime board (Phase 24, BOARD-01/02/03) ───────────────────────────────────

const regimeIndicator = {
  id: "vix-term-structure",
  label: "VIX/VIX3M Term Structure",
  value: 0.9,
  band: "warning" as const,
  bandWarn: 0.9,
  bandCrisis: 0.95,
  asOf: "2026-07-07",
  source: "eco3min.fr",
  rationale: "0.90 warn / 0.95 crisis.",
  inputs: { VIXCLS: 18.0, VXVCLS: 20.0 },
};

const regimeWithData: ForRunningGetRegimeBoard = async () => ok([regimeIndicator]);

const regimeErrored: ForRunningGetRegimeBoard = async () =>
  err({ kind: "storage-error", message: "boom" });

describe("GET /api/analytics/regime", () => {
  it("returns a contract-valid array with ≥1 present indicator when data exists (MCP-02)", async () => {
    const app = buildRegimeApp(regimeWithData);
    const res = await app.request("/api/analytics/regime");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Parsing must succeed — proves MCP-02 contract conformance.
    const parsed = regimeResponse.parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("vix-term-structure");
    expect(parsed[0]?.band).toBe("warning");
    expect(parsed[0]?.asOf).toBe("2026-07-07");
  });

  it("returns a contract-valid EMPTY array (not an error) when there is no data", async () => {
    const app = buildRegimeApp(regimeEmpty);
    const res = await app.request("/api/analytics/regime");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(regimeResponse.parse(body)).toEqual([]);
  });

  it("maps a storage error to a flat {error:'internal'} 500 (T-24-08)", async () => {
    const app = buildRegimeApp(regimeErrored);
    const res = await app.request("/api/analytics/regime");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
  });
});
