import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  ForGettingStatus,
  ForListingCalendars,
  ForReadingJournal,
  ForRunningGetLiveGreeks,
  ForRunningGetTermStructure,
  ForRunningGetSkew,
  ForRunningGetGex,
  ForRunningGetCot,
  ForRunningGetMacro,
  ForRunningGetPicker,
  ForGettingPositions,
  ForGettingTransactions,
  ForGettingOrders,
  ForRunningGetCalendarEventsWithRules,
  ForRunningSetRuleTags,
  ForRunningGetCalendarLifecycle,
} from "@morai/core";
import type { Config } from "../../config.ts";
import { bearerAuth } from "./bearer.ts";
import {
  registerStatusTool,
  registerListCalendarsTool,
  registerGetJournalTool,
  registerGetLiveGreeksTool,
  registerGetTermStructureTool,
  registerGetSkewTool,
  registerGetGexTool,
  registerGetCotTool,
  registerGetMacroTool,
  registerGetPickerCandidatesTool,
  registerGetPositionsTool,
  registerGetTransactionsTool,
  registerGetOrdersTool,
  registerTriggerJobTool,
  registerGetRuleTagsTool,
  registerSetRuleTagsTool,
  registerGetJournalLifecycleTool,
} from "./tools.ts";
import type { ForTriggeringJob } from "../http/jobs.routes.ts";

/**
 * makeMcpRouter — returns a Hono router that mounts the MCP transport at /mcp.
 *
 * Architecture law (mcp-and-plugins.md): MCP server = inbound adapter over the SAME
 * use-cases. Zero business logic here — all logic is in the use-case layer.
 *
 * Uses WebStandardStreamableHTTPServerTransport (native Fetch API transport) since
 * Bun + Hono are web-standard environments. No fetch-to-node bridge needed.
 * Each request creates a fresh server+transport (stateless — no sessionIdGenerator).
 *
 * T-01-11: bearer middleware on /mcp/* ensures no/wrong token → 401.
 * T-01-13: transport validates Origin header internally.
 *
 * MCP-01: base tools — get_status, list_calendars, get_journal, get_live_greeks,
 *         get_term_structure, get_skew.
 * MCP-02: each tool shares the same Zod contract as its HTTP route (wired in tools.ts).
 * MCP-02: trigger_job registered here (Phase 5) — shares ForTriggeringJob use-case with HTTP route.
 * GEX-02 / MCP-02: get_gex registered here (Phase 8, 08-07) — shares gexSnapshotResponse with
 *         GET /api/analytics/gex; injected as optional for backward compat with existing call sites.
 * COT-02 / MCP-02: get_cot registered here (Phase 13, 13-06) — shares cotResponse with
 *         GET /api/analytics/cot; injected as optional for backward compat with existing call sites.
 * MAC-02 / MCP-02: get_macro registered here (Phase 14, 14-06) — shares macroResponse with
 *         GET /api/analytics/macro; injected as optional for backward compat with existing call sites.
 * PICK-02 / MCP-02 (Phase 19, 19-07): get_picker_candidates registered here — shares
 *         pickerSnapshotResponse with GET /api/picker/candidates; injected as optional for
 *         backward compat with existing call sites.
 * RULE-01 / MCP-02 (Phase 20, 20-10): get_rule_tags + set_rule_tags registered here — share
 *         getEventsWithRulesResponse/setRuleTagsRequest/setRuleTagsResponse with GET/PUT
 *         /api/journal/*rules; injected as optional for backward compat with existing call sites.
 * JRNL-01 / MCP-02 (Phase 22, 22-03): get_journal_lifecycle registered here — shares
 *         lifecycleResponse with GET /api/journal/:calendarId/lifecycle; injected as optional
 *         for backward compat with existing call sites.
 */
export function makeMcpRouter(
  config: Config,
  getStatus: ForGettingStatus,
  listCalendars: ForListingCalendars,
  getJournal: ForReadingJournal,
  getLiveGreeks: ForRunningGetLiveGreeks,
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
  getGex?: ForRunningGetGex,
  getCot?: ForRunningGetCot,
  getMacro?: ForRunningGetMacro,
  getPicker?: ForRunningGetPicker,
  getPositions?: ForGettingPositions,
  getTransactions?: ForGettingTransactions,
  getOrders?: ForGettingOrders,
  enqueueJob?: ForTriggeringJob,
  getEventsWithRules?: ForRunningGetCalendarEventsWithRules,
  setRuleTags?: ForRunningSetRuleTags,
  getCalendarLifecycle?: ForRunningGetCalendarLifecycle,
): Hono {
  const router = new Hono();

  // T-01-11: bearer gate on all /mcp routes
  router.use("/mcp/*", bearerAuth(config.MCP_BEARER_TOKEN));

  // Helper: build a fresh McpServer + transport per request (stateless).
  // Omit sessionIdGenerator entirely (exactOptionalPropertyTypes: undefined != absent).
  function makeServerAndTransport() {
    // Stateless: no sessionIdGenerator — each request is independent
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = new McpServer({ name: "morai", version: "1.0.0" });
    // MCP-01: register all six base tools
    registerStatusTool(server, getStatus);
    registerListCalendarsTool(server, listCalendars);
    registerGetJournalTool(server, getJournal);
    registerGetLiveGreeksTool(server, getLiveGreeks);
    registerGetTermStructureTool(server, getTermStructure);
    registerGetSkewTool(server, getSkew);
    // GEX-02 / MCP-02: get_gex tool — optional, wired when getGex use-case is available (Phase 8)
    if (getGex !== undefined) {
      registerGetGexTool(server, getGex);
    }
    // COT-02 / MCP-02: get_cot tool — optional, wired when getCot use-case is available (Phase 13)
    if (getCot !== undefined) {
      registerGetCotTool(server, getCot);
    }
    // MAC-02 / MCP-02: get_macro tool — optional, wired when getMacro use-case is available (Phase 14)
    if (getMacro !== undefined) {
      registerGetMacroTool(server, getMacro);
    }
    // PICK-02 / MCP-02: get_picker_candidates tool — optional, wired when getPicker use-case
    // is available (Phase 19)
    if (getPicker !== undefined) {
      registerGetPickerCandidatesTool(server, getPicker);
    }
    // BRK-02 / MCP-02: trader data tools (optional — wired when trader adapters are available)
    if (getPositions !== undefined) {
      registerGetPositionsTool(server, getPositions);
    }
    if (getTransactions !== undefined) {
      registerGetTransactionsTool(server, getTransactions);
    }
    if (getOrders !== undefined) {
      registerGetOrdersTool(server, getOrders);
    }
    // MCP-02: trigger_job tool — optional, wired when enqueueJob is available (Phase 5)
    if (enqueueJob !== undefined) {
      registerTriggerJobTool(server, enqueueJob);
    }
    // RULE-01 / MCP-02: get_rule_tags + set_rule_tags tools — optional, wired when the
    // RULE-01 use-cases are available (Phase 20, 20-10)
    if (getEventsWithRules !== undefined) {
      registerGetRuleTagsTool(server, getEventsWithRules);
    }
    if (setRuleTags !== undefined) {
      registerSetRuleTagsTool(server, setRuleTags);
    }
    // JRNL-01 / MCP-02: get_journal_lifecycle tool — optional, wired when the getCalendarLifecycle
    // use-case is available (Phase 22, 22-03)
    if (getCalendarLifecycle !== undefined) {
      registerGetJournalLifecycleTool(server, getCalendarLifecycle);
    }
    return { server, transport };
  }

  // POST /mcp — main JSON-RPC entrypoint (tool calls, resource fetches, etc.)
  // Do NOT close synchronously: handleRequest returns a Response wrapping an open
  // SSE ReadableStream whose body is written asynchronously after this returns.
  // Closing here tears the stream down before the response is enqueued (empty
  // content-length:0 → client "Failed to connect"). The SDK closes the stream
  // itself once the response is sent; the per-request server/transport are then
  // GC'd. Matches the official @modelcontextprotocol/sdk Hono web-standard example.
  router.post("/mcp", async (c) => {
    const { server, transport } = makeServerAndTransport();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // GET /mcp — SSE stream for server→client notifications (Phase 1: mostly no-op)
  router.get("/mcp", async (c) => {
    const { server, transport } = makeServerAndTransport();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return router;
}
