import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok } from "@morai/shared";
import type { ForGettingStatus } from "@morai/core";
import { statusResponse } from "@morai/contracts";
import { statusRoutes } from "./status.routes.ts";

// Helper: build a test Hono app with an injected getStatus double
function buildTestApp(getStatus: ForGettingStatus) {
  const app = new Hono();
  app.route("/api", statusRoutes(getStatus));
  return app;
}

const okGetStatus: ForGettingStatus = async () =>
  ok({
    db: "ok" as const,
    tokenFreshness: "none yet" as const,
    lastJobRuns: "none yet" as const,
    version: "0.0.1",
    uptime: 42,
  });

const downGetStatus: ForGettingStatus = async () =>
  ok({
    db: "down" as const,
    tokenFreshness: "none yet" as const,
    lastJobRuns: "none yet" as const,
    version: "0.0.1",
    uptime: 42,
  });

// NEW: getStatus with populated lastJobRuns (D-10)
const populatedJobRunsGetStatus: ForGettingStatus = async () =>
  ok({
    db: "ok" as const,
    tokenFreshness: "none yet" as const,
    lastJobRuns: {
      "fetch-cboe-chain": {
        lastSuccessAt: "2026-06-15T14:00:00.000Z",
        lastErrorAt: null,
        lastError: null,
      },
      "fetch-rates": {
        lastSuccessAt: null,
        lastErrorAt: "2026-06-15T09:01:00.000Z",
        lastError: "FRED timeout",
      },
    },
    version: "0.0.1",
    uptime: 100,
  });

describe("GET /api/status", () => {
  it("returns 200 with db:ok on a healthy ping", async () => {
    const app = buildTestApp(okGetStatus);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = statusResponse.parse(body);
    expect(parsed.db).toBe("ok");
  });

  it("returns 200 with db:down on an errored ping", async () => {
    const app = buildTestApp(downGetStatus);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = statusResponse.parse(body);
    expect(parsed.db).toBe("down");
  });

  it("body passes statusResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(okGetStatus);
    const res = await app.request("/api/status");
    const body: unknown = await res.json();
    // This will throw if the body does not match the schema
    expect(() => statusResponse.parse(body)).not.toThrow();
  });

  it("includes required fields: tokenFreshness, lastJobRuns, version, uptime", async () => {
    const app = buildTestApp(okGetStatus);
    const res = await app.request("/api/status");
    const body: unknown = await res.json();
    const parsed = statusResponse.parse(body);
    expect(parsed.tokenFreshness).toBe("none yet");
    expect(parsed.lastJobRuns).toBe("none yet");
    expect(typeof parsed.version).toBe("string");
    expect(typeof parsed.uptime).toBe("number");
  });

  // NEW: populated lastJobRuns round-trips through statusResponse (MCP-02, D-10)
  it("populated lastJobRuns round-trips through statusResponse.parse (MCP-02)", async () => {
    const app = buildTestApp(populatedJobRunsGetStatus);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must not throw
    const parsed = statusResponse.parse(body);
    expect(parsed.lastJobRuns).not.toBe("none yet");
    const jobRuns = parsed.lastJobRuns;
    if (jobRuns !== "none yet") {
      expect(jobRuns["fetch-cboe-chain"]?.lastSuccessAt).toBe(
        "2026-06-15T14:00:00.000Z",
      );
      expect(jobRuns["fetch-rates"]?.lastError).toBe("FRED timeout");
    }
  });
});
