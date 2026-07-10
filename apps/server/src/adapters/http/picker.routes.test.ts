import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetPicker, ForAnalyzingAdHocCalendar, PickerSnapshotRow } from "@morai/core";
import { analyzeAdHocCalendarResponse, pickerSnapshotResponse } from "@morai/contracts";
import { pickerRoutes } from "./picker.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const STORED_ROW: PickerSnapshotRow = {
  observedAt: new Date("2026-07-01T14:30:00.000Z"),
  snapshot: {
    asOf: "2026-07-01",
    observedAt: "2026-07-01T14:30:00.000Z",
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

/** A fully valid analyzeAdHocCalendarRequest body (7500P calendar, no client-supplied spot). */
const VALID_ANALYZE_BODY = {
  putCall: "P" as const,
  strike: 7500,
  frontDte: 7,
  backDte: 30,
  qty: 1,
  frontIv: 0.15,
  backIv: 0.17,
  debit: 1.5,
  frontExpiry: "2026-07-08",
  backExpiry: "2026-07-29",
};

/** A scored PickerCandidateDomain the ad-hoc use-case would return for VALID_ANALYZE_BODY. */
const ANALYZED_CANDIDATE = {
  id: "adhoc-5D-7500-2026-07-08-2026-07-29",
  name: "7500P 2026-07-08 / 2026-07-29",
  score: 62,
  breakdown: [{ criterion: "slope" as const, weight: 40, rawValue: 0.02, contribution: 35 }],
  debit: 150,
  theta: 5.2,
  vega: 12.1,
  delta: -0.05,
  fwdIv: 0.16,
  fwdIvGuard: "ok" as const,
  slope: 0.02,
  fwdEdge: 0.01,
  expectedMove: 90,
  frontEvents: [],
  backEvents: [],
  context: [],
  bucket: "standard" as const,
  frontLeg: { strike: 7500, putCall: "P" as const, dte: 7, iv: 0.15 },
  backLeg: { strike: 7500, putCall: "P" as const, dte: 30, iv: 0.17 },
  exitPlan: {
    profitTargetPct: 0.25,
    stopPct: 0.175,
    manageShortDte: 3,
    closeByExpiry: "2026-07-08",
    thetaCapturePct: null,
  },
};

/** Scores VALID_ANALYZE_BODY into ANALYZED_CANDIDATE. */
const analyzeOk: ForAnalyzingAdHocCalendar = async () =>
  ok({ scored: true, candidate: ANALYZED_CANDIDATE });

/** No snapshot yet — binding #2: still a clean ok(), never a hard error. */
const analyzeNoSnapshot: ForAnalyzingAdHocCalendar = async () =>
  ok({ scored: false, reason: "no-snapshot" });

/** Use-case returns a storage error. */
const analyzeErr: ForAnalyzingAdHocCalendar = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(
  getPicker: ForRunningGetPicker,
  analyzeAdHocCalendar: ForAnalyzingAdHocCalendar = analyzeOk,
) {
  const app = new Hono();
  app.route("/", pickerRoutes(getPicker, analyzeAdHocCalendar));
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

describe("POST /picker/analyze", () => {
  function postAnalyze(app: Hono, body: unknown) {
    return app.request("/picker/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 200 {scored:true, candidate, reason:null} for a valid body with a snapshot present", async () => {
    const app = buildTestApp(getPickerOk, analyzeOk);
    const res = await postAnalyze(app, VALID_ANALYZE_BODY);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = analyzeAdHocCalendarResponse.parse(body);
    expect(parsed.scored).toBe(true);
    expect(parsed.candidate?.id).toBe(ANALYZED_CANDIDATE.id);
    expect(parsed.reason).toBeNull();
  });

  it("returns 200 {scored:false, candidate:null, reason} when no snapshot exists yet (binding #2 — never a hard error)", async () => {
    const app = buildTestApp(getPickerOk, analyzeNoSnapshot);
    const res = await postAnalyze(app, VALID_ANALYZE_BODY);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = analyzeAdHocCalendarResponse.parse(body);
    expect(parsed.scored).toBe(false);
    expect(parsed.candidate).toBeNull();
    expect(parsed.reason).toBe("no-snapshot");
  });

  it("returns 400 on an invalid body (backDte <= frontDte)", async () => {
    let called = false;
    const analyzeSpy: ForAnalyzingAdHocCalendar = async () => {
      called = true;
      return ok({ scored: true, candidate: ANALYZED_CANDIDATE });
    };
    const app = buildTestApp(getPickerOk, analyzeSpy);
    const res = await postAnalyze(app, { ...VALID_ANALYZE_BODY, backDte: 5 });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 on a body with a client-supplied spot key (.strict() rejects it)", async () => {
    const app = buildTestApp(getPickerOk, analyzeOk);
    const res = await postAnalyze(app, { ...VALID_ANALYZE_BODY, spot: 7500 });
    expect(res.status).toBe(400);
  });

  it("returns 500 {error:'internal'} when the use-case returns a storage error", async () => {
    const app = buildTestApp(getPickerOk, analyzeErr);
    const res = await postAnalyze(app, VALID_ANALYZE_BODY);
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("does not leak storage-error internals into the response (T-30-16)", async () => {
    const app = buildTestApp(getPickerOk, analyzeErr);
    const res = await postAnalyze(app, VALID_ANALYZE_BODY);
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).not.toContain("db connection failed");
  });
});
