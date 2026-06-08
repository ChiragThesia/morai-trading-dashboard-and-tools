import type { MiddlewareHandler } from "hono";

/**
 * bearerAuth — Hono middleware that guards routes behind a pre-shared bearer token.
 *
 * T-01-11: no/wrong bearer → 401. Token is compared exactly.
 * T-01-12: the token value is never logged.
 *
 * Usage: app.use("/mcp/*", bearerAuth(config.MCP_BEARER_TOKEN))
 */
export function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
