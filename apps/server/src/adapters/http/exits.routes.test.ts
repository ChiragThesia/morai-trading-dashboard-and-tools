import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForRunningGetExitAdvice, ExitAdviceSnapshot } from "@morai/core";
import { exitsResponse } from "@morai/contracts";
import { exitRoutes } from "./exits.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

const SNAPSHOT: ExitAdviceSnapshot = {
  asOf: "2026-07-09",
  observedAt: new Date("2026-07-09T14:30:00.000Z"),
  marketSession: "rth",
  positions: [
    {
      calendarId: "cal-1",
      name: "7500 Put Calendar",
      strike: 7500,
      optionType: "P",
      verdict: {
        verdict: "STOP",
        rung: "-25%",
        ruleId: "stop-25",
        metric: { name: "pnlPct", value: -0.261, threshold: -0.25 },
        indicative: false,
        escalate: true,
        roll: null,
      },
      changed: true,
      pnlPct: -0.261,
      basis: { openNetDebit: 150, netMark: 110.85 },
    },
  ],
  ruleSet: [{ id: "stop-25", kind: "trigger", rationale: "Cut losers at -25% of debit." }],
};

/** Returns the stored exit-advice snapshot */
const getExitAdviceOk: ForRunningGetExitAdvice = async () => ok(SNAPSHOT);

/** Returns null — no verdicts computed yet (cold start) */
const getExitAdviceNull: ForRunningGetExitAdvice = async () => ok(null);

/** Returns a storage error */
const getExitAdviceErr: ForRunningGetExitAdvice = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(getExitAdvice: ForRunningGetExitAdvice) {
  const app = new Hono();
  app.route("/", exitRoutes(getExitAdvice));
  return app;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("GET /exits", () => {
  it("returns 200 with an exitsResponse-valid body for a stored snapshot", async () => {
    const app = buildTestApp(getExitAdviceOk);
    const res = await app.request("/exits");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must parse through the contract without throwing (MCP-02 contract parity)
    const parsed = exitsResponse.parse(body);
    expect(parsed.asOf).toBe("2026-07-09");
    expect(parsed.marketSession).toBe("rth");
    expect(parsed.positions).toHaveLength(1);
    expect(parsed.positions[0]?.calendarId).toBe("cal-1");
    expect(parsed.positions[0]?.strike).toBe(7500);
    expect(parsed.positions[0]?.optionType).toBe("P");
    expect(parsed.positions[0]?.verdict).toBe("STOP");
    expect(parsed.positions[0]?.rung).toBe("-25%");
    expect(parsed.positions[0]?.ruleId).toBe("stop-25");
    expect(parsed.positions[0]?.escalate).toBe(true);
    expect(parsed.positions[0]?.changed).toBe(true);
    expect(parsed.ruleSet).toHaveLength(1);
  });

  it("returns 404 {error:'no-verdicts'} when getExitAdvice returns null (cold start)", async () => {
    const app = buildTestApp(getExitAdviceNull);
    const res = await app.request("/exits");
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "no-verdicts" });
  });

  it("returns 500 {error:'internal'} when getExitAdvice returns a storage error", async () => {
    const app = buildTestApp(getExitAdviceErr);
    const res = await app.request("/exits");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("body passes exitsResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(getExitAdviceOk);
    const res = await app.request("/exits");
    const body: unknown = await res.json();
    expect(() => exitsResponse.parse(body)).not.toThrow();
  });

  it("does not leak storage-error internals into the response (T-26-13)", async () => {
    const app = buildTestApp(getExitAdviceErr);
    const res = await app.request("/exits");
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).not.toContain("db connection failed");
  });
});
