import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TRIGGERABLE_JOBS, triggerJobPayload } from "@morai/contracts";
import type { ForTriggeringJob } from "../../http/jobs.routes.ts";

/**
 * registerTriggerJobTool — registers the trigger_job MCP tool on the given McpServer.
 *
 * Architecture law (mcp-and-plugins.md): adapter contains zero business logic.
 * Pattern: safeParse args at boundary → call use-case → return content.
 *
 * MCP-02: Shares TRIGGERABLE_JOBS + triggerJobPayload from @morai/contracts with the HTTP route.
 *         A one-sided rename fails typecheck on both adapters (MCP-02 single schema source).
 *
 * T-05-21: The MCP transport is already bearer-guarded by the /mcp/* middleware.
 * T-05-22: z.enum(TRIGGERABLE_JOBS) + triggerJobPayload validate all user-supplied input.
 * T-05-24: rebuildDedupeKey inside the use-case collapses duplicate rebuild requests.
 */
export function registerTriggerJobTool(
  server: McpServer,
  enqueueJob: ForTriggeringJob,
): void {
  server.registerTool(
    "trigger_job",
    {
      title: "Trigger Job",
      description:
        "Manually trigger a background job by name. Returns { jobId } on success; jobId is null when the job was already queued (dedup no-op). Supported jobs: rebuild-journal, sync-fills, refresh-tokens, compute-bsm-greeks.",
      inputSchema: {
        name: z.enum(TRIGGERABLE_JOBS),
        // triggerJobPayload.shape.calendarId — MCP-02: same schema as HTTP body
        calendarId: triggerJobPayload.shape.calendarId,
      },
    },
    async (args) => {
      // safeParse at MCP boundary — never throw on invalid input (SPEC §7, CR-02).
      // MCP-02: same validation schema as the HTTP route (shared contracts).
      const parsed = z
        .object({
          name: z.enum(TRIGGERABLE_JOBS),
          calendarId: z.string().uuid().optional(),
        })
        .safeParse(args);

      if (!parsed.success) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "invalid params" }) },
          ],
        };
      }

      const { name, calendarId } = parsed.data;
      // Build payload as Record<string, unknown> — matches ForTriggeringJob signature.
      // calendarId omitted when undefined (exactOptionalPropertyTypes).
      const payload: Record<string, unknown> = {};
      if (calendarId !== undefined) {
        payload["calendarId"] = calendarId;
      }

      const result = await enqueueJob(name, payload);
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error.message }) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ jobId: result.value }) }],
      };
    },
  );
}
