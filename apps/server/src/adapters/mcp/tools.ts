import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { statusResponse } from "@morai/contracts";
import type { ForGettingStatus } from "@morai/core";

/**
 * registerStatusTool — registers the get_status MCP tool on the given McpServer.
 *
 * Architecture law (mcp-and-plugins.md): adapter contains zero business logic.
 * Pattern: call use-case → parse result through statusResponse schema → return content.
 *
 * MCP-02: the SAME statusResponse schema used by the HTTP route is used here.
 * A one-sided field rename will fail bun run typecheck because both adapters
 * import the same StatusResponse inferred type.
 */
export function registerStatusTool(
  server: McpServer,
  getStatus: ForGettingStatus,
): void {
  server.registerTool(
    "get_status",
    {
      title: "Get Morai Status",
      description:
        "Returns DB health, token freshness, and last job run times for the Morai server.",
      // Empty raw shape — get_status takes no parameters.
      // ZodRawShapeCompat is Record<string, AnySchema>; {} satisfies this.
      inputSchema: {},
    },
    async () => {
      const result = await getStatus();
      // ForGettingStatus: StatusError = never — always returns ok(payload).
      // Guard with result.ok for the type narrower (exactOptionalPropertyTypes).
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = statusResponse.parse(result.value);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  );
}
