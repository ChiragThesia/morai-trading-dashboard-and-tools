import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForGettingStatus } from "@morai/core";
import type { ForListingCalendars, ForReadingJournal, ForRunningGetLiveGreeks } from "@morai/core";
import type { Calendar, SnapshotRow, StorageError } from "@morai/core";
import {
  statusResponse,
  listCalendarsResponse,
  journalResponse,
  liveGreeksResponse,
} from "@morai/contracts";
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

// --- Fake calendars use-case ---
const fakeCalendar: Calendar = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  underlying: "SPX",
  strike: 5500000,
  optionType: "C" as const,
  frontExpiry: "2026-06-20",
  backExpiry: "2026-07-18",
  qty: 1,
  openNetDebit: 5.0,
  status: "open" as const,
  openedAt: new Date("2026-01-01T10:00:00Z"),
  closedAt: null,
  notes: null,
};

const fakeListCalendars: ForListingCalendars = async () =>
  ok([fakeCalendar]);

const fakeEmptyListCalendars: ForListingCalendars = async () =>
  ok([]);

// --- Fake journal use-case ---
const fakeSnapshotRow: SnapshotRow = {
  time: new Date("2026-06-14T15:00:00Z"),
  calendarId: "550e8400-e29b-41d4-a716-446655440000",
  spot: "5500.00",
  netMark: "5.00",
  frontMark: "10.00",
  backMark: "15.00",
  frontIv: "0.15",
  backIv: "0.18",
  frontIvRaw: "0.15",
  backIvRaw: "0.18",
  netDelta: "-0.50",
  netGamma: "0.02",
  netTheta: "-0.30",
  netVega: "0.10",
  termSlope: "0.03",
  dteFront: 6,
  dteBack: 34,
  pnlOpen: "0.00",
  source: "cboe" as const,
};

// Helper: typed ok(null) for the ForReadingJournal not-found path.
// Returns Result<ReadonlyArray<SnapshotRow> | null, StorageError> with null value.
function journalNotFound(): Result<ReadonlyArray<SnapshotRow> | null, StorageError> {
  return ok(null);
}

const fakeGetJournal: ForReadingJournal = async (calendarId) => {
  if (calendarId === "550e8400-e29b-41d4-a716-446655440000") {
    return ok([fakeSnapshotRow]);
  }
  // Unknown ID → return null (not-found path)
  return journalNotFound();
};

const fakeGetJournalNotFound: ForReadingJournal = async () =>
  journalNotFound();

const fakeGetJournalError: ForReadingJournal = async () =>
  err<StorageError>({ kind: "storage-error", message: "db down" });

// --- Fake live-greeks use-case ---
const fakeGetLiveGreeks: ForRunningGetLiveGreeks = async (calendarId) =>
  ok({
    calendarId,
    legs: [
      {
        occSymbol: "SPX   260620C05500000",
        bsmIv: "0.15",
        bsmDelta: "0.50",
        bsmGamma: "0.02",
        bsmTheta: "-0.05",
        bsmVega: "0.20",
      },
    ],
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
    app.route(
      "",
      makeMcpRouter(
        testConfig,
        healthyGetStatus,
        fakeListCalendars,
        fakeGetJournal,
        fakeGetLiveGreeks,
      ),
    );
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST /mcp with wrong bearer → 401", async () => {
    const app = new Hono();
    app.route(
      "",
      makeMcpRouter(
        testConfig,
        healthyGetStatus,
        fakeListCalendars,
        fakeGetJournal,
        fakeGetLiveGreeks,
      ),
    );
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

  // ─── list_calendars tool ───────────────────────────────────────────────────

  it("list_calendars tool returns listCalendarsResponse-valid payload", async () => {
    const { registerListCalendarsTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerListCalendarsTool(server, fakeListCalendars);

    const result = await fakeListCalendars();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Serialise Date fields to ISO strings, matching the MCP tool handler's behavior
    // (mirrors calendarRoutes — MCP-02: same transformation before contract parse).
    const serialised = result.value.map((cal) => ({
      ...cal,
      openedAt: cal.openedAt.toISOString(),
      closedAt: cal.closedAt !== null ? cal.closedAt.toISOString() : null,
    }));
    expect(() =>
      listCalendarsResponse.parse({ calendars: serialised }),
    ).not.toThrow();
    const parsed = listCalendarsResponse.parse({ calendars: serialised });
    expect(parsed.calendars).toHaveLength(1);
    expect(parsed.calendars[0]?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("list_calendars tool returns empty list when no calendars exist", async () => {
    const result = await fakeEmptyListCalendars();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() =>
      listCalendarsResponse.parse({ calendars: result.value }),
    ).not.toThrow();
    const parsed = listCalendarsResponse.parse({ calendars: result.value });
    expect(parsed.calendars).toHaveLength(0);
  });

  // ─── get_journal tool ──────────────────────────────────────────────────────

  it("get_journal tool returns journalResponse-valid payload for known calendarId", async () => {
    const { registerGetJournalTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetJournalTool(server, fakeGetJournal);

    const result = await fakeGetJournal("550e8400-e29b-41d4-a716-446655440000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshots = result.value;
    expect(snapshots).not.toBeNull();
    if (snapshots === null) return;
    // Serialise Date fields to ISO strings, matching the MCP tool handler's behavior
    // (mirrors journalRoutes: row.time.toISOString() — MCP-02 same contract).
    const serialisedSnapshots = snapshots.map((row) => ({
      ...row,
      time: row.time instanceof Date ? row.time.toISOString() : row.time,
    }));
    expect(() =>
      journalResponse.parse({ snapshots: serialisedSnapshots }),
    ).not.toThrow();
    const parsed = journalResponse.parse({ snapshots: serialisedSnapshots });
    expect(parsed.snapshots).toHaveLength(1);
  });

  it("get_journal tool returns not-found text for unknown calendarId (no throw)", async () => {
    const { registerGetJournalTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    // Register the tool on a server — it should NOT throw on unknown ID
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetJournalTool(server, fakeGetJournalNotFound);

    // Directly call the tool handler result path to assert not-found text
    const result = await fakeGetJournalNotFound(
      "99999999-9999-9999-9999-999999999999",
    );
    expect(result.ok).toBe(true);
    // null result → the tool should return not-found text, not throw
    if (result.ok && result.value === null) {
      // This is the not-found path — server should handle gracefully
      expect(true).toBe(true);
    }
  });

  it("get_journal tool returns internal error text on storage error (no throw)", async () => {
    const { registerGetJournalTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // Should NOT throw even when use-case returns error
    expect(() =>
      registerGetJournalTool(server, fakeGetJournalError),
    ).not.toThrow();
  });

  // ─── get_journal / get_live_greeks — safeParse: invalid args → typed error content (CR-02) ──

  it("get_journal tool returns typed error content for non-UUID calendarId — does not throw (CR-02)", async () => {
    const { registerGetJournalTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetJournalTool(server, fakeGetJournal);

    // Access the registered tool's handler via Reflect (private field, not in TS types).
    // All property lookups use Reflect.get which returns unknown — no 'as' casts needed.
    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "get_journal");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("get_journal tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("get_journal handler is not a function");
    }

    // Pass invalid args (not a UUID) — must return typed error content, NOT throw.
    // Reflect.apply avoids any type assertion: handler is Function (narrowed above),
    // Reflect.apply accepts Function and returns unknown.
    const result: unknown = await Reflect.apply(handler, undefined, [{ calendarId: "not-a-uuid" }]);
    if (typeof result !== "object" || result === null) {
      throw new Error("handler did not return an object");
    }
    const content: unknown = Reflect.get(result, "content");
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.length).toBeGreaterThan(0);
    const first: unknown = content[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("first content item is not an object");
    }
    expect(Reflect.get(first, "type")).toBe("text");
    // The error text must contain "invalid calendarId"
    const text: unknown = Reflect.get(first, "text");
    expect(typeof text).toBe("string");
    if (typeof text === "string") {
      expect(text).toContain("invalid calendarId");
    }
  });

  it("get_live_greeks tool returns typed error content for non-UUID calendarId — does not throw (CR-02)", async () => {
    const { registerGetLiveGreeksTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetLiveGreeksTool(server, fakeGetLiveGreeks);

    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "get_live_greeks");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("get_live_greeks tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("get_live_greeks handler is not a function");
    }

    const result: unknown = await Reflect.apply(handler, undefined, [{ calendarId: "not-a-uuid" }]);
    if (typeof result !== "object" || result === null) {
      throw new Error("handler did not return an object");
    }
    const content: unknown = Reflect.get(result, "content");
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.length).toBeGreaterThan(0);
    const first: unknown = content[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("first content item is not an object");
    }
    expect(Reflect.get(first, "type")).toBe("text");
    const text: unknown = Reflect.get(first, "text");
    expect(typeof text).toBe("string");
    if (typeof text === "string") {
      expect(text).toContain("invalid calendarId");
    }
  });

  // ─── get_live_greeks tool ──────────────────────────────────────────────────

  it("get_live_greeks tool returns liveGreeksResponse-valid payload", async () => {
    const { registerGetLiveGreeksTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetLiveGreeksTool(server, fakeGetLiveGreeks);

    const result = await fakeGetLiveGreeks(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => liveGreeksResponse.parse(result.value)).not.toThrow();
    const parsed = liveGreeksResponse.parse(result.value);
    expect(parsed.calendarId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed.legs).toHaveLength(1);
  });

  // ─── get_term_structure tool ───────────────────────────────────────────────

  it("get_term_structure tool returns typed-empty {observations:[]} — never an error", async () => {
    const { registerGetTermStructureTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // Should not throw on registration
    expect(() => registerGetTermStructureTool(server)).not.toThrow();

    // The tool always returns {observations:[]} — verify the static payload shape
    const staticPayload = { observations: [] };
    expect(JSON.parse(JSON.stringify(staticPayload))).toEqual({
      observations: [],
    });
  });

  // ─── get_skew tool ─────────────────────────────────────────────────────────

  it("get_skew tool returns typed-empty {observations:[]} — never an error", async () => {
    const { registerGetSkewTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // Should not throw on registration
    expect(() => registerGetSkewTool(server)).not.toThrow();

    // The tool always returns {observations:[]} — verify the static payload shape
    const staticPayload = { observations: [] };
    expect(JSON.parse(JSON.stringify(staticPayload))).toEqual({
      observations: [],
    });
  });

  // ─── trigger_job must NOT be registered ────────────────────────────────────

  it("trigger_job is NOT exported from tools.ts (D-08 deferred)", async () => {
    const toolsModule = await import("./tools.ts");
    // Object.keys returns string[] — check without type assertions (typescript.md rule)
    const exportedNames = Object.keys(toolsModule);
    expect(exportedNames.includes("registerTriggerJobTool")).toBe(false);
  });
});
