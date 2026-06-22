/**
 * analytics.routes.test.ts — ANLY-03 HTTP route tests for GET /api/analytics/term-structure.
 *
 * MCP-02: the SAME termStructureResponse schema is used here and in the get_term_structure MCP
 * tool. A one-sided field rename fails typecheck.
 *
 * SPEC R5: empty array (not error) when no data; flat {error:"internal"} on storage error.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetTermStructure } from "@morai/core";
import { termStructureResponse } from "@morai/contracts";
import { analyticsRoutes } from "./analytics.routes.ts";

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildApp(getTermStructure: ForRunningGetTermStructure) {
  const app = new Hono();
  app.route("/api", analyticsRoutes(getTermStructure));
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
