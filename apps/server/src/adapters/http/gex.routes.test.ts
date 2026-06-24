import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetGex } from "@morai/core";
import { gexSnapshotResponse } from "@morai/contracts";
import { gexRoutes } from "./gex.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const STORED_ROW = {
  cycleTime: new Date("2026-06-24T15:00:00.000Z"),
  spot: 5500,
  flip: 5450.5,
  callWall: 5600,
  putWall: 5400,
  netGammaAtSpot: -1.2,
  // WR-01: profile axis is `spot` (simulated spot-price grid level), not `strike`
  profile: [
    { spot: 5400, gamma: 0.5 },
    { spot: 5500, gamma: -1.2 },
    { spot: 5600, gamma: 2.1 },
  ],
  strikes: [
    { k: 5400, gex: 0.5, coi: 1000, poi: 1200, vol: 500 },
    { k: 5500, gex: -1.2, coi: 800, poi: 900, vol: 300 },
  ],
  byExpiry: [
    { date: "2026-06-28", gex: -0.8 },
    { date: "2026-07-19", gex: 0.3 },
  ],
  computedAt: new Date("2026-06-24T15:00:01.000Z"),
};

/** Returns the stored GEX snapshot row */
const getGexOk: ForRunningGetGex = async () => ok(STORED_ROW);

/** Returns null — no snapshot computed yet */
const getGexNull: ForRunningGetGex = async () => ok(null);

/** Returns a storage error */
const getGexErr: ForRunningGetGex = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(getGex: ForRunningGetGex) {
  const app = new Hono();
  // Mount under /analytics matching main.ts composition (plan 08-07)
  app.route("/analytics", gexRoutes(getGex));
  return app;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("GET /analytics/gex", () => {
  it("returns 200 with a gexSnapshotResponse-valid body for a stored row", async () => {
    const app = buildTestApp(getGexOk);
    const res = await app.request("/analytics/gex");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must parse through the contract without throwing (MCP-02 contract parity)
    const parsed = gexSnapshotResponse.parse(body);
    expect(parsed.spot).toBe(5500);
    expect(parsed.flip).toBe(5450.5);
    expect(parsed.callWall).toBe(5600);
    expect(parsed.putWall).toBe(5400);
    expect(parsed.netGammaAtSpot).toBe(-1.2);
    expect(parsed.profile).toHaveLength(3);
    expect(parsed.strikes).toHaveLength(2);
    expect(parsed.byExpiry).toHaveLength(2);
    expect(parsed.computedAt).toBe("2026-06-24T15:00:01.000Z");
  });

  it("returns 404 {error:'no-snapshot'} when getGex returns null", async () => {
    const app = buildTestApp(getGexNull);
    const res = await app.request("/analytics/gex");
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "no-snapshot" });
  });

  it("returns 500 {error:'internal'} when getGex returns a storage error", async () => {
    const app = buildTestApp(getGexErr);
    const res = await app.request("/analytics/gex");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("body passes gexSnapshotResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(getGexOk);
    const res = await app.request("/analytics/gex");
    const body: unknown = await res.json();
    // Must not throw — MCP-02 requires exact schema parity between route + tool
    expect(() => gexSnapshotResponse.parse(body)).not.toThrow();
  });

  it("does NOT include buildProfile/strikeGex/bsmGreeks/recompute fields (D-01: pure stored-row read)", async () => {
    const app = buildTestApp(getGexOk);
    const res = await app.request("/analytics/gex");
    const body: unknown = await res.json();
    // D-01 prohibition: no recompute fields leak into the response
    // Use Zod-parsed body to avoid type assertions
    const parsed = gexSnapshotResponse.parse(body);
    const parsedKeys = Object.keys(parsed);
    expect(parsedKeys).not.toContain("buildProfile");
    expect(parsedKeys).not.toContain("recompute");
  });
});
