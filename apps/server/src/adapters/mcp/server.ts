import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ForGettingStatus } from "@morai/core";
import type { Config } from "../../config.ts";
import { bearerAuth } from "./bearer.ts";
import { registerStatusTool } from "./tools.ts";

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
 */
export function makeMcpRouter(
  config: Config,
  getStatus: ForGettingStatus,
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
    registerStatusTool(server, getStatus);
    return { server, transport };
  }

  // POST /mcp — main JSON-RPC entrypoint (tool calls, resource fetches, etc.)
  router.post("/mcp", async (c) => {
    const { server, transport } = makeServerAndTransport();
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    void server.close();
    return response;
  });

  // GET /mcp — SSE stream for server→client notifications (Phase 1: mostly no-op)
  router.get("/mcp", async (c) => {
    const { server, transport } = makeServerAndTransport();
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    void server.close();
    return response;
  });

  return router;
}
