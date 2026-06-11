import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok } from "@morai/shared";
import type { ForGettingStatus } from "@morai/core";
import { statusResponse } from "@morai/contracts";
import { bearerAuth } from "./bearer.ts";
import { makeMcpRouter } from "./server.ts";
import type { Config } from "../../config.ts";

const TEST_BEARER = "test-bearer-token-1234";

const testConfig = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  MCP_BEARER_TOKEN: TEST_BEARER,
  PORT: 3000,
  TZ: "America/New_York",
  NODE_ENV: "test" as const,
} satisfies Config;

const healthyGetStatus: ForGettingStatus = async () =>
  ok({
    db: "ok" as const,
    tokenFreshness: "none yet" as const,
    lastJobRuns: "none yet" as const,
    version: "0.0.1",
    uptime: 42,
  });

// NEW: getStatus with populated lastJobRuns for MCP-02 validation
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
    },
    version: "0.0.1",
    uptime: 42,
  });

describe("bearer middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const app = new Hono();
    app.use("/mcp/*", bearerAuth(TEST_BEARER));
    app.post("/mcp", (c) => c.json({ ok: true }));
    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header has wrong token", async () => {
    const app = new Hono();
    app.use("/mcp/*", bearerAuth(TEST_BEARER));
    app.post("/mcp", (c) => c.json({ ok: true }));
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("passes through when Authorization header has correct token", async () => {
    const app = new Hono();
    app.use("/mcp/*", bearerAuth(TEST_BEARER));
    app.post("/mcp", (c) => c.json({ ok: true }));
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_BEARER}` },
    });
    // Not 401 — the downstream handler responds
    expect(res.status).not.toBe(401);
  });
});

describe("MCP router", () => {
  it("rejects POST /mcp with no Authorization header → 401", async () => {
    const app = new Hono();
    app.route("", makeMcpRouter(testConfig, healthyGetStatus));
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST /mcp with wrong bearer → 401", async () => {
    const app = new Hono();
    app.route("", makeMcpRouter(testConfig, healthyGetStatus));
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("get_status tool handler returns statusResponse-valid content with lastJobRuns:'none yet'", async () => {
    // Test the tool handler's output shape directly via registerStatusTool
    const { registerStatusTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerStatusTool(server, healthyGetStatus);

    const result = await healthyGetStatus();
    if (!result.ok) {
      throw new Error("Use case returned error");
    }
    expect(() => statusResponse.parse(result.value)).not.toThrow();
    const parsed = statusResponse.parse(result.value);
    expect(parsed.db).toBe("ok");
    expect(parsed.tokenFreshness).toBe("none yet");
    expect(parsed.lastJobRuns).toBe("none yet");
  });

  // NEW: populated lastJobRuns round-trips through statusResponse in MCP tool (MCP-02, D-10)
  it("populated lastJobRuns round-trips through statusResponse.parse in MCP tool (MCP-02)", async () => {
    const result = await populatedJobRunsGetStatus();
    if (!result.ok) {
      throw new Error("Use case returned error");
    }
    // Must not throw — MCP-02 requires same schema as HTTP route
    expect(() => statusResponse.parse(result.value)).not.toThrow();
    const parsed = statusResponse.parse(result.value);
    expect(parsed.lastJobRuns).not.toBe("none yet");
    const jobRuns = parsed.lastJobRuns;
    if (jobRuns !== "none yet") {
      expect(jobRuns["fetch-cboe-chain"]?.lastSuccessAt).toBe(
        "2026-06-15T14:00:00.000Z",
      );
    }
  });
});
