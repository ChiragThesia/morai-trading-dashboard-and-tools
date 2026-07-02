import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TRIGGERABLE_JOBS, triggerJobBodyFor, triggerJobPayload } from "@morai/contracts";
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
        "Manually trigger a background job by name. Returns { jobId } on success; jobId is null when the job was already queued (dedup no-op). Supported jobs: rebuild-journal, sync-fills, compute-bsm-greeks.",
      inputSchema: {
        name: z.enum(TRIGGERABLE_JOBS),
        // triggerJobPayload.shape.calendarId — MCP-02: same schema as HTTP body
        calendarId: triggerJobPayload.shape.calendarId,
      },
    },
    async (args) => {
      // safeParse at MCP boundary — never throw on invalid input (SPEC §7, CR-02).
      // CR-A1 / architecture-boundaries §9: route through the SAME per-job refinement
      // the HTTP route uses (triggerJobBodyFor) so both adapter surfaces stay in sync.

      // (1) Validate the job name first.
      const nameParsed = z
        .object({ name: z.enum(TRIGGERABLE_JOBS) })
        .safeParse(args);
      if (!nameParsed.success) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "invalid params" }) },
          ],
        };
      }
      const { name } = nameParsed.data;

      // (2) Once the name is known, validate the calendarId-bearing body with the
      // per-job schema (rebuild-journal ⇒ calendarId REQUIRED). A failed parse rejects
      // here and enqueueJob is NEVER called — this closes the WR-04 queue-flood path
      // through the agent-driven MCP surface (CR-A1). Mirrors jobs.routes.ts.
      const calendarIdRaw: unknown = Reflect.get(Object(args), "calendarId");
      const bodyParsed = triggerJobBodyFor(name).safeParse({ calendarId: calendarIdRaw });
      if (!bodyParsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "calendarId is required for rebuild-journal",
              }),
            },
          ],
        };
      }

      const { calendarId } = bodyParsed.data;
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
