import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetPicker, PickerSnapshotRow } from "@morai/core";
import { pickerSnapshotResponse } from "@morai/contracts";
import { pickerRoutes } from "./picker.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const STORED_ROW: PickerSnapshotRow = {
  observedAt: new Date("2026-07-01T14:30:00.000Z"),
  snapshot: {
    asOf: "2026-07-01",
    spot: 7500,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    termStructure: [
      { dte: 7, iv: 0.15 },
      { dte: 30, iv: 0.17 },
    ],
    gex: { flip: 7450.5, callWall: 7600, putWall: 7400, netGammaAtSpot: -1.2, absGammaStrike: 7500 },
    events: [{ date: "2026-07-04", name: "FOMC" }],
    candidates: [
      {
        id: "cal-1",
        name: "7500 Put Calendar",
        score: 82,
        breakdown: [
          { criterion: "slope", weight: 40, rawValue: 0.02, contribution: 35 },
          { criterion: "fwdEdge", weight: 20, rawValue: 0.01, contribution: 18 },
        ],
        debit: 150,
        theta: 5.2,
        vega: 12.1,
        delta: -0.05,
        fwdIv: 0.16,
        fwdIvGuard: "ok",
        slope: 0.02,
        fwdEdge: 0.01,
        expectedMove: 90,
        frontEvents: ["FOMC"],
        backEvents: [],
        frontLeg: { strike: 7500, putCall: "P", dte: 7, iv: 0.15 },
        backLeg: { strike: 7500, putCall: "P", dte: 30, iv: 0.17 },
        exitPlan: { profitTargetPct: 0.25, stopPct: 0.175, manageShortDte: 3, closeByExpiry: "2026-07-08" },
      },
    ],
  },
};

/** Returns the stored picker snapshot row */
const getPickerOk: ForRunningGetPicker = async () => ok(STORED_ROW);

/** Returns null — no snapshot computed yet */
const getPickerNull: ForRunningGetPicker = async () => ok(null);

/** Returns a storage error */
const getPickerErr: ForRunningGetPicker = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(getPicker: ForRunningGetPicker) {
  const app = new Hono();
  app.route("/", pickerRoutes(getPicker));
  return app;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("GET /picker/candidates", () => {
  it("returns 200 with a pickerSnapshotResponse-valid body for a stored row", async () => {
    const app = buildTestApp(getPickerOk);
    const res = await app.request("/picker/candidates");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must parse through the contract without throwing (MCP-02 contract parity)
    const parsed = pickerSnapshotResponse.parse(body);
    expect(parsed.asOf).toBe("2026-07-01");
    expect(parsed.spot).toBe(7500);
    expect(parsed.source).toBe("schwab");
    expect(parsed.gexContextStatus).toBe("ok");
    expect(parsed.eventsContextStatus).toBe("ok");
    expect(parsed.termStructure).toHaveLength(2);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.id).toBe("cal-1");
  });

  it("returns 404 {error:'no-snapshot'} when getPicker returns null", async () => {
    const app = buildTestApp(getPickerNull);
    const res = await app.request("/picker/candidates");
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "no-snapshot" });
  });

  it("returns 500 {error:'internal'} when getPicker returns a storage error", async () => {
    const app = buildTestApp(getPickerErr);
    const res = await app.request("/picker/candidates");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("body passes pickerSnapshotResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(getPickerOk);
    const res = await app.request("/picker/candidates");
    const body: unknown = await res.json();
    expect(() => pickerSnapshotResponse.parse(body)).not.toThrow();
  });

  it("does not leak storage-error internals into the response (T-19-16)", async () => {
    const app = buildTestApp(getPickerErr);
    const res = await app.request("/picker/candidates");
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).not.toContain("db connection failed");
  });
});
