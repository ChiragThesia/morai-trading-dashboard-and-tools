import { z } from "zod";

/**
 * jobs.ts — shared trigger_job contracts (MCP-02 single schema source).
 *
 * Both the HTTP route (POST /api/jobs/:name/trigger) and the MCP trigger_job tool
 * import from this file. A one-sided rename fails typecheck on both adapters.
 *
 * T-05-22: z.enum(TRIGGERABLE_JOBS) rejects arbitrary job names at both boundaries.
 */

export const TRIGGERABLE_JOBS = [
  "rebuild-journal",
  "sync-fills",
  "refresh-tokens",
  "compute-bsm-greeks",
] as const;

export type TriggerableJob = (typeof TRIGGERABLE_JOBS)[number];

/**
 * triggerJobPayload — optional calendarId (only rebuild-journal + sync-fills need it).
 * Both HTTP route (zValidator "json") and MCP tool (inputSchema + safeParse) share this schema.
 */
export const triggerJobPayload = z.object({
  calendarId: z.string().uuid().optional(),
});

export type TriggerJobPayload = z.infer<typeof triggerJobPayload>;

/**
 * triggerJobBodyFor — the request-body schema for a SPECIFIC job name (WR-04).
 *
 * The base triggerJobPayload cannot enforce per-job rules because it does not
 * carry the job name (the name lives in the route param). The route threads the
 * validated name here so the refinement can run:
 *
 *   - rebuild-journal ⇒ calendarId REQUIRED. An empty body fails parse, the route
 *     returns 400, and a null-keyed rebuild is never enqueued (no queue flood).
 *   - all other jobs ⇒ calendarId stays optional (unchanged).
 *
 * triggerJobPayload itself is untouched so the MCP tool's
 * `triggerJobPayload.shape.calendarId` reference (MCP-02) stays stable.
 */
export function triggerJobBodyFor(name: string): z.ZodType<TriggerJobPayload> {
  if (name === "rebuild-journal") {
    return triggerJobPayload.refine(
      (body) => body.calendarId !== undefined,
      { path: ["calendarId"], message: "calendarId is required for rebuild-journal" },
    );
  }
  return triggerJobPayload;
}

/**
 * triggerJobResponse — 202 response body with enqueued jobId.
 * jobId is null when the job was already queued (dedup no-op).
 */
export const triggerJobResponse = z.object({
  jobId: z.string().nullable(),
});

export type TriggerJobResponse = z.infer<typeof triggerJobResponse>;
