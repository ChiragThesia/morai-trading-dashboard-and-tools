import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { TRIGGERABLE_JOBS, triggerJobPayload } from "@morai/contracts";
import type { StorageError } from "@morai/core";
import type { Result } from "@morai/shared";

/**
 * jobsRoutes — factory returning a Hono router for on-demand job trigger endpoints.
 *
 * Architecture law: zero business logic here.
 * Pattern: Zod-validate param + body → call use-case → map Result → respond.
 *
 * T-05-21: This router MUST be mounted inside the bearer-token middleware group
 *          (Security Domain — Elevation-of-Privilege mitigated at mount site in main.ts).
 * T-05-22: z.enum(TRIGGERABLE_JOBS) rejects arbitrary job names (V5 Input Validation).
 * MCP-02: Both HTTP and MCP adapters call the same enqueueJob use-case
 *         and share the same TRIGGERABLE_JOBS + triggerJobPayload from @morai/contracts.
 */

// The enqueueJob use-case (makeEnqueueJobUseCase output) takes name + payload;
// the dedupe key is computed internally by the use-case, not at the route layer.
export type ForTriggeringJob = (
  name: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<Result<string | null, StorageError>>;

export function jobsRoutes(enqueueJob: ForTriggeringJob): Hono {
  throw new Error("not implemented");
  const router = new Hono();

  router.post(
    "/jobs/:name/trigger",
    zValidator("param", z.object({ name: z.enum(TRIGGERABLE_JOBS) })),
    zValidator("json", triggerJobPayload),
    async (_c) => {
      void enqueueJob;
      throw new Error("not implemented");
    },
  );

  return router;
}
