import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { reauthStartRequest, reauthExchangeRequest, reauthExchangeResponse } from "@morai/contracts";
import type { ForStartingReauth, ForExchangingReauth } from "@morai/core";

/**
 * reauthRoutes — factory returning a Hono router for POST /reauth/start + POST /reauth/exchange
 * (Phase 37-05, REAUTH-05). Mirrors settings.routes.ts's shape exactly.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   Zod-parse input → call use-case → map Result → parse through contract schema → respond.
 *
 * This is a privileged auth-minting surface — mounted by main.ts inside the existing
 * Supabase-JWT-gated group (operator-only). Threat mitigations (37-05-PLAN.md threat register):
 *   T-37-04: no unauthenticated surface — JWT gate is the caller's responsibility (main.ts).
 *   T-37-06: `!result.ok` → generic `{error:"internal"}` 500. The sidecar detail, error code,
 *     and redirect URL NEVER reach the browser — success is re-parsed through the strict
 *     contract, which cannot carry that detail either.
 *
 * MCP scoped OUT deliberately: no MCP tool mints or exchanges Schwab authorize URLs (CONTEXT
 * decision) — this router is HTTP-only.
 */
export function reauthRoutes(startReauth: ForStartingReauth, exchangeReauth: ForExchangingReauth) {
  const router = new Hono();

  router.post("/reauth/start", zValidator("json", reauthStartRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await startReauth(body.app);
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    // Not reauthStartResponse.parse(): that schema validates the sidecar's raw wire body
    // (which includes `state`, consumed inside reauth-adapter.ts). ForStartingReauth's Result
    // deliberately narrows to { authUrl } only — the CSRF state never crosses into TS (T-37-06).
    return c.json({ authUrl: result.value.authUrl });
  });

  router.post("/reauth/exchange", zValidator("json", reauthExchangeRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await exchangeReauth(body.redirectUrl);
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(reauthExchangeResponse.parse(result.value));
  });

  return router;
}
