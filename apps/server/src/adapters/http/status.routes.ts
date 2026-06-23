import { Hono } from "hono";
import type { ForGettingStatus } from "@morai/core";
import { toStatusResponse } from "../status-dto.ts";

/**
 * statusRoutes — factory returning a Hono router for the status endpoints.
 *
 * Architecture law (api-design.md): adapter contains zero business logic.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * The ForGettingStatus use-case is injected so the route is testable without
 * a real DB. No Drizzle imports here — all DB access is in the use-case layer.
 */
export function statusRoutes(getStatus: ForGettingStatus) {
  const router = new Hono();

  router.get("/status", async (c) => {
    const result = await getStatus();
    // ForGettingStatus: StatusError = never — use-case always returns ok(payload).
    // Guard with result.ok for the type narrower (exactOptionalPropertyTypes).
    if (!result.ok) {
      // unreachable — StatusError = never; satisfies the type checker
      return c.json({ error: "internal" }, 500);
    }
    return c.json(toStatusResponse(result.value));
  });

  return router;
}
