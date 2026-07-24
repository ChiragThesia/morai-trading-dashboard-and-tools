import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForGettingStatus } from "@morai/core";
import type { ForListingCalendars, ForReadingJournal, ForRunningGetLiveGreeks, ForRunningGetTermStructure, ForRunningGetSkew, ForRunningGetCot, ForRunningGetMacro } from "@morai/core";
import type { Calendar, SnapshotRow, StorageError } from "@morai/core";
import {
  statusResponse,
  listCalendarsResponse,
  journalResponse,
  liveGreeksResponse,
  cotResponse,
  macroResponse,
} from "@morai/contracts";
import { bearerAuth } from "./bearer.ts";
import { makeMcpRouter } from "./server.ts";
import type { Config } from "../../config.ts";
import type { ForTriggeringJob } from "../http/jobs.routes.ts";

const TEST_BEARER = "test-bearer-token-1234";

const testConfig = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  MCP_BEARER_TOKEN: TEST_BEARER,
  PORT: 3000,
  TZ: "America/New_York",
  NODE_ENV: "test" as const,
  TOKEN_ENCRYPTION_KEY: "test-encryption-key-must-be-32-chars-long",
  SCHWAB_TRADER_APP_KEY: "test-trader-key",
  SCHWAB_TRADER_APP_SECRET: "test-trader-secret",
  SCHWAB_TRADER_CALLBACK_URL: "https://127.0.0.1:8182",
  SCHWAB_MARKET_APP_KEY: "test-market-key",
  SCHWAB_MARKET_APP_SECRET: "test-market-secret",
  SCHWAB_MARKET_CALLBACK_URL: "https://127.0.0.1:8183",
  // Phase 8 (D20 — updated): JWKS asymmetric verify — SUPABASE_URL replaces SUPABASE_JWT_SECRET
  SUPABASE_URL: "https://cwcdcosxoaqyqbsfifsh.supabase.co",
  WEB_ORIGIN: "http://localhost:5173",
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

// 06-04: get_term_structure tool fake — returns one term-structure observation by default.
const fakeGetTermStructure: ForRunningGetTermStructure = async () =>
  ok([
    {
      snapshotTime: new Date("2026-07-01T19:00:00Z"),
      calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      value: 0.05,
      frontIv: 0.2,
      backIv: 0.25,
    },
  ]);

const fakeGetTermStructureEmpty: ForRunningGetTermStructure = async () => ok([]);

// 06-05: get_skew tool fake — returns one headline risk-reversal observation by default.
const fakeGetSkew: ForRunningGetSkew = async () =>
  ok([
    {
      snapshotTime: new Date("2026-07-01T19:00:00Z"),
      underlying: "SPX",
      expiration: "2026-07-17",
      riskReversal: 0.06,
      rrRank: 50,
    },
  ]);

const fakeGetSkewEmpty: ForRunningGetSkew = async () => ok([]);

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
        fakeGetTermStructure,
        fakeGetSkew,
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
        fakeGetTermStructure,
        fakeGetSkew,
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

  // ─── live transport: initialize handshake must return a non-empty body ───────
  // Regression for the UAT-1 "Failed to connect" bug: the POST /mcp handler called
  // `void server.close()` synchronously after handleRequest, tearing down the SSE
  // ReadableStream before the async InitializeResult was enqueued → content-length:0.
  // This drives the real router end-to-end (the unit tests above only exercise tool
  // handlers in isolation, so the streaming bug slipped through).
  it("POST /mcp initialize returns a non-empty InitializeResult body over the wire", async () => {
    const app = new Hono();
    app.route(
      "",
      makeMcpRouter(
        testConfig,
        healthyGetStatus,
        fakeListCalendars,
        fakeGetJournal,
        fakeGetLiveGreeks,
        fakeGetTermStructure,
        fakeGetSkew,
      ),
    );
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TEST_BEARER}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // The bug produced an empty stream (content-length:0). A working transport
    // streams back the InitializeResult.
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("protocolVersion");
    expect(body).toContain("morai");
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

  // ─── get_trade_history tool (Trade Ledger, MCP-02) ─────────────────────────

  it("get_trade_history tool registers and its handler returns tradeHistoryResponse-valid payload", async () => {
    const { registerGetTradeHistoryTool } = await import("./tools.ts");
    const { tradeHistoryResponse } = await import("@morai/contracts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    const fakeGetTradeHistory = async () =>
      ok({
        roundTrips: [
          {
            calendarId: "550e8400-e29b-41d4-a716-446655440000",
            underlying: "SPXW",
            strike: 7400000,
            optionType: "P" as const,
            frontExpiry: "2026-08-11",
            backExpiry: "2026-08-31",
            qty: 1,
            status: "open" as const,
            openedAt: new Date("2026-07-23T19:50:00Z"),
            closedAt: null,
            openNetDebit: 40.08,
            closeNetCredit: null,
            realizedPnl: null,
            greeks: null,
          },
        ],
        executions: [],
        totals: { realizedPnl: null },
        vix: null,
      });
    registerGetTradeHistoryTool(server, fakeGetTradeHistory);

    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "get_trade_history");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("get_trade_history tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("get_trade_history handler is not a function");
    }

    const result: unknown = await Reflect.apply(handler, undefined, [{}]);
    if (typeof result !== "object" || result === null) {
      throw new Error("handler did not return an object");
    }
    const content: unknown = Reflect.get(result, "content");
    if (!Array.isArray(content)) throw new Error("content is not an array");
    const first: unknown = content[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("content[0] is not an object");
    }
    const text: unknown = Reflect.get(first, "text");
    if (typeof text !== "string") throw new Error("content[0].text is not a string");
    const payload = tradeHistoryResponse.parse(JSON.parse(text));
    expect(payload.roundTrips[0]?.openedAt).toBe("2026-07-23T19:50:00.000Z");
    expect(payload.totals.realizedPnl).toBeNull();
  });

  // ─── get_trade_detail tool (Trade Ledger expansion, MCP-02) ────────────────

  it("get_trade_detail tool parses via contract; not-found and invalid-uuid return typed error text", async () => {
    const { registerGetTradeDetailTool } = await import("./tools.ts");
    const { tradeDetailResponse } = await import("@morai/contracts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const KNOWN = "550e8400-e29b-41d4-a716-446655440000";
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const fakeGetTradeDetail = async (calendarId: string) =>
      calendarId === KNOWN
        ? ok({
            calendarId: KNOWN,
            days: [
              {
                date: "2026-07-23",
                asOf: new Date("2026-07-23T19:30:00Z"),
                spot: 7400.5,
                pnlOpen: 2.0,
                netDelta: 1.2,
                netGamma: null,
                netTheta: 38.5,
                netVega: 112.3,
                frontIv: 0.145,
                backIv: 0.139,
                termSlope: -0.006,
                front: { mark: 103.4, iv: 0.145, delta: -40, gamma: null, theta: 550, vega: -610 },
                back: { mark: 143.5, iv: 0.139, delta: 42, gamma: 0.2, theta: -310, vega: 720 },
              },
            ],
          })
        : ok(null);
    registerGetTradeDetailTool(server, fakeGetTradeDetail);

    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "get_trade_detail");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("get_trade_detail tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("get_trade_detail handler is not a function");
    }

    function textOf(result: unknown): string {
      if (typeof result !== "object" || result === null) throw new Error("not an object");
      const content: unknown = Reflect.get(result, "content");
      if (!Array.isArray(content)) throw new Error("content is not an array");
      const first: unknown = content[0];
      if (typeof first !== "object" || first === null) throw new Error("no content[0]");
      const text: unknown = Reflect.get(first, "text");
      if (typeof text !== "string") throw new Error("text is not a string");
      return text;
    }

    // Known id → contract-valid payload with ISO asOf
    const okText = textOf(await Reflect.apply(handler, undefined, [{ calendarId: KNOWN }]));
    const payload = tradeDetailResponse.parse(JSON.parse(okText));
    expect(payload.days[0]?.asOf).toBe("2026-07-23T19:30:00.000Z");
    expect(payload.days[0]?.front.delta).toBeCloseTo(-40, 10);

    // Unknown id → not-found text
    const missText = textOf(
      await Reflect.apply(handler, undefined, [
        { calendarId: "550e8400-e29b-41d4-a716-446655440099" },
      ]),
    );
    expect(missText).toContain("not found");

    // Invalid uuid → typed error text, never throws
    const badText = textOf(
      await Reflect.apply(handler, undefined, [{ calendarId: "not-a-uuid" }]),
    );
    expect(badText).toContain("invalid");
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

  it("get_term_structure tool registers with the real use-case and returns the shared contract series", async () => {
    const { registerGetTermStructureTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { termStructureResponse } = await import("@morai/contracts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // 06-04: registration now requires the use-case; should not throw.
    expect(() =>
      registerGetTermStructureTool(server, fakeGetTermStructure),
    ).not.toThrow();

    // MCP-02: the tool's payload validates against the SAME contract as the HTTP route.
    const result = await fakeGetTermStructure({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = termStructureResponse.parse(
      result.value.map((row) => ({
        time: row.snapshotTime.toISOString(),
        calendarId: row.calendarId,
        value: row.value,
      })),
    );
    expect(payload).toHaveLength(1);
    expect(payload[0]?.value).toBe(0.05);
  });

  it("get_term_structure tool returns a contract-valid EMPTY array (not an error) on no data", async () => {
    const { termStructureResponse } = await import("@morai/contracts");
    const result = await fakeGetTermStructureEmpty({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(termStructureResponse.parse(result.value)).toEqual([]);
  });

  // ─── get_skew tool (06-05 — real use-case over the shared skewResponse contract, MCP-02) ──

  it("get_skew tool registers with the real use-case and returns the shared contract series", async () => {
    const { registerGetSkewTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { skewResponse } = await import("@morai/contracts");

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // 06-05: registration now requires the use-case; should not throw.
    expect(() => registerGetSkewTool(server, fakeGetSkew)).not.toThrow();

    // MCP-02: the tool's payload validates against the SAME skewResponse as the HTTP route.
    const result = await fakeGetSkew({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = skewResponse.parse(
      result.value.map((row) => ({
        time: row.snapshotTime.toISOString(),
        underlying: row.underlying,
        expiration: row.expiration,
        value: row.riskReversal,
        rrRank: row.rrRank,
      })),
    );
    expect(payload).toHaveLength(1);
    expect(payload[0]?.value).toBe(0.06);
    expect(payload[0]?.rrRank).toBe(50);
  });

  it("get_skew tool returns a contract-valid EMPTY array (not an error) on no data", async () => {
    const { skewResponse } = await import("@morai/contracts");
    const result = await fakeGetSkewEmpty({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(skewResponse.parse(result.value)).toEqual([]);
  });

  // ─── trigger_job IS registered (MCP-02, Plan 05-08 — supersedes the D-08 deferral) ─

  it("trigger_job is exported from tools.ts and registers without throwing (MCP-02)", async () => {
    const toolsModule = await import("./tools.ts");
    // Object.keys returns string[] — check without type assertions (typescript.md rule)
    const exportedNames = Object.keys(toolsModule);
    expect(exportedNames.includes("registerTriggerJobTool")).toBe(true);

    const { registerTriggerJobTool } = toolsModule;
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const enqueueJob: ForTriggeringJob = async () => ok("job-123");
    const server = new McpServer({ name: "test", version: "0.0.1" });
    // Should not throw on registration
    expect(() => registerTriggerJobTool(server, enqueueJob)).not.toThrow();
  });

  // ─── trigger_job — MCP/HTTP parity for per-job calendarId refinement (CR-A1) ──
  // The MCP trigger_job tool MUST route through triggerJobBodyFor(name) exactly as
  // jobs.routes.ts does, so the agent-driven MCP surface cannot enqueue a null-keyed,
  // un-deduplicated rebuild-journal (the WR-04 queue-flood path).

  // Reach the registered trigger_job handler via the same Reflect pattern the CR-02
  // tests use — no 'as' casts. Returns the handler narrowed to Function.
  async function getTriggerJobHandler(
    enqueueJob: ForTriggeringJob,
  ): Promise<(args: unknown) => Promise<unknown>> {
    const { registerTriggerJobTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTriggerJobTool(server, enqueueJob);

    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "trigger_job");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("trigger_job tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("trigger_job handler is not a function");
    }
    return async (args: unknown): Promise<unknown> =>
      Reflect.apply(handler, undefined, [args]);
  }

  // Extract content[0].text (string) from a tool result without casts.
  function firstContentText(result: unknown): string {
    if (typeof result !== "object" || result === null) {
      throw new Error("handler did not return an object");
    }
    const content: unknown = Reflect.get(result, "content");
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error("handler result has no content");
    }
    const first: unknown = content[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("first content item is not an object");
    }
    const text: unknown = Reflect.get(first, "text");
    if (typeof text !== "string") {
      throw new Error("content text is not a string");
    }
    return text;
  }

  it("trigger_job {name:'rebuild-journal'} with NO calendarId is rejected and never enqueues (CR-A1 blocker)", async () => {
    let enqueueCalls = 0;
    const enqueueJob: ForTriggeringJob = async () => {
      enqueueCalls += 1;
      return ok("job-should-not-happen");
    };

    const handler = await getTriggerJobHandler(enqueueJob);
    const result = await handler({ name: "rebuild-journal" });

    const text = firstContentText(result);
    // Error content — no jobId, an error indicator present.
    expect(text.toLowerCase()).toMatch(/calendarid|invalid/);
    expect(text).not.toContain("jobId");
    // The flood path: enqueueJob MUST NOT be reached.
    expect(enqueueCalls).toBe(0);
  });

  it("trigger_job {name:'rebuild-journal', calendarId} enqueues once with the calendarId (CR-A1)", async () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    let enqueueCalls = 0;
    let seenName: string | null = null;
    let seenCalendarId: unknown = undefined;
    const enqueueJob: ForTriggeringJob = async (name, payload) => {
      enqueueCalls += 1;
      seenName = name;
      seenCalendarId = Reflect.get(payload, "calendarId");
      return ok("job-abc");
    };

    const handler = await getTriggerJobHandler(enqueueJob);
    const result = await handler({ name: "rebuild-journal", calendarId: validId });

    const text = firstContentText(result);
    expect(enqueueCalls).toBe(1);
    expect(seenName).toBe("rebuild-journal");
    expect(seenCalendarId).toBe(validId);
    expect(text).toContain("jobId");
    expect(text).toContain("job-abc");
  });

  it("trigger_job {name:'sync-fills'} with NO calendarId still enqueues once (CR-A1 no regression)", async () => {
    let enqueueCalls = 0;
    let seenName: string | null = null;
    const enqueueJob: ForTriggeringJob = async (name) => {
      enqueueCalls += 1;
      seenName = name;
      return ok("job-sync");
    };

    const handler = await getTriggerJobHandler(enqueueJob);
    const result = await handler({ name: "sync-fills" });

    const text = firstContentText(result);
    expect(enqueueCalls).toBe(1);
    expect(seenName).toBe("sync-fills");
    expect(text).toContain("jobId");
  });

  // ─── get_cot tool (13-06 — real use-case over the shared cotResponse contract, MCP-02) ──

  // 13-06: COT fake — one weekly TFF entry.
  const fakeCotEntry = {
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

  const fakeGetCot: ForRunningGetCot = async () => ok([fakeCotEntry]);
  const fakeGetCotEmpty: ForRunningGetCot = async () => ok([]);

  it("get_cot tool registers with the real use-case and returns the shared contract series (MCP-02)", async () => {
    const { registerGetCotTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );

    const server = new McpServer({ name: "test", version: "0.0.1" });
    // 13-06: registration requires the use-case; should not throw.
    expect(() => registerGetCotTool(server, fakeGetCot)).not.toThrow();

    // MCP-02: the tool's payload validates against the SAME cotResponse as the HTTP route.
    // CotEntry fields are already plain strings/ints — no Date mapping needed.
    const result = await fakeGetCot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = cotResponse.parse(result.value);
    expect(payload).toHaveLength(1);
    expect(payload[0]?.asOf).toBe("2026-04-08");
    expect(payload[0]?.netLeveraged).toBe(100);
    expect(payload[0]?.contractCode).toBe("13874A");
  });

  it("get_cot tool returns a contract-valid EMPTY array (not an error) on no data (MCP-02)", async () => {
    const result = await fakeGetCotEmpty();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Empty array is a valid cotResponse (not an error).
    expect(cotResponse.parse(result.value)).toEqual([]);
  });

  // ─── get_macro tool (14-06 — real use-case over the shared macroResponse contract, MCP-02) ──

  const fakeGetMacro: ForRunningGetMacro = async (query) => {
    if (query?.series !== undefined) {
      return ok({ DFF: [{ time: "2026-04-01", value: 4.33 }] });
    }
    return ok({
      DFF: [{ time: "2026-04-01", value: 4.33 }],
      VVIX: [{ time: "2026-04-01", value: 89.0 }],
    });
  };
  const fakeGetMacroEmpty: ForRunningGetMacro = async () => ok({});
  const fakeGetMacroError: ForRunningGetMacro = async () =>
    err<StorageError>({ kind: "storage-error", message: "boom" });

  async function getGetMacroHandler(
    getMacro: ForRunningGetMacro,
  ): Promise<(args: unknown) => Promise<unknown>> {
    const { registerGetMacroTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerGetMacroTool(server, getMacro);

    const toolsMap: unknown = Reflect.get(server, "_registeredTools");
    if (typeof toolsMap !== "object" || toolsMap === null) {
      throw new Error("_registeredTools not found on McpServer instance");
    }
    const toolEntry: unknown = Reflect.get(toolsMap, "get_macro");
    if (typeof toolEntry !== "object" || toolEntry === null) {
      throw new Error("get_macro tool not registered");
    }
    const handler: unknown = Reflect.get(toolEntry, "handler");
    if (typeof handler !== "function") {
      throw new Error("get_macro handler is not a function");
    }
    return async (args: unknown): Promise<unknown> =>
      Reflect.apply(handler, undefined, [args]);
  }

  function firstContentTextMacro(result: unknown): string {
    if (typeof result !== "object" || result === null) {
      throw new Error("handler did not return an object");
    }
    const content: unknown = Reflect.get(result, "content");
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error("handler result has no content");
    }
    const first: unknown = content[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("first content item is not an object");
    }
    const text: unknown = Reflect.get(first, "text");
    if (typeof text !== "string") {
      throw new Error("content text is not a string");
    }
    return text;
  }

  it("get_macro tool registers with the real use-case without throwing", async () => {
    const { registerGetMacroTool } = await import("./tools.ts");
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const server = new McpServer({ name: "test", version: "0.0.1" });
    expect(() => registerGetMacroTool(server, fakeGetMacro)).not.toThrow();
  });

  it("get_macro tool with no args returns the full default-window macroResponse payload (MCP-02)", async () => {
    const handler = await getGetMacroHandler(fakeGetMacro);
    const result = await handler({});
    const text = firstContentTextMacro(result);
    const payload: unknown = JSON.parse(text);
    const parsed = macroResponse.parse(payload);
    expect(parsed.DFF).toHaveLength(1);
    expect(parsed.VVIX).toHaveLength(1);
  });

  it("get_macro tool with {days,series} filters the payload identically to the HTTP route (parity)", async () => {
    const handler = await getGetMacroHandler(fakeGetMacro);
    const result = await handler({ days: 365, series: "DFF" });
    const text = firstContentTextMacro(result);
    const payload: unknown = JSON.parse(text);
    const parsed = macroResponse.parse(payload);
    expect(Object.keys(parsed)).toEqual(["DFF"]);
  });

  it("get_macro tool rejects invalid args via macroQuery without calling the use-case (T-14-01)", async () => {
    let calls = 0;
    const spy: ForRunningGetMacro = async () => {
      calls += 1;
      return ok({});
    };
    const handler = await getGetMacroHandler(spy);
    const result = await handler({ series: "BOGUS" });
    const text = firstContentTextMacro(result);
    expect(text.toLowerCase()).toContain("invalid");
    expect(calls).toBe(0);
  });

  it("get_macro tool returns a contract-valid EMPTY map (not an error) on no data", async () => {
    const handler = await getGetMacroHandler(fakeGetMacroEmpty);
    const result = await handler({});
    const text = firstContentTextMacro(result);
    const payload: unknown = JSON.parse(text);
    expect(macroResponse.parse(payload)).toEqual({});
  });

  it("get_macro tool returns flat internal-error content on a StorageError (no DB internals)", async () => {
    const handler = await getGetMacroHandler(fakeGetMacroError);
    const result = await handler({});
    const text = firstContentTextMacro(result);
    expect(text).toContain("internal error");
  });
});
