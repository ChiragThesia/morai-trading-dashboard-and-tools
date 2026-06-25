/**
 * supabase-auth.ts — Hono middleware factory for Supabase JWT verification.
 *
 * Verifies Supabase user access tokens asymmetrically via JWKS (ES256).
 * Accepts an injectable JWKS resolver so tests can use createLocalJWKSet (offline)
 * while production uses createRemoteJWKSet pointed at the Supabase JWKS endpoint.
 *
 * Architecture: thin driving adapter — no business logic. Auth failure → 401;
 * success → set "jwtPayload" on context and call next().
 *
 * D20 / SC-4 / AUTH-01: JWKS asymmetric verify (ES256). No shared secret.
 */

import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import type { JWTVerifyGetKey, JWTPayload } from "jose";

export type SupabaseJwtAuthDeps = {
  /** JWKS key resolver. Production: createRemoteJWKSet. Tests: createLocalJWKSet. */
  getKey: JWTVerifyGetKey;
};

/**
 * makeSupabaseJwtAuth — factory returning a Hono middleware that verifies
 * Supabase access tokens (ES256, aud:"authenticated") via JWKS.
 *
 * On success: sets c.set("jwtPayload", payload) and calls next().
 * On failure: returns 401 JSON {"error":"Unauthorized"}.
 */
export function makeSupabaseJwtAuth(deps: SupabaseJwtAuthDeps): MiddlewareHandler {
  const { getKey } = deps;

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader === undefined || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice("Bearer ".length);
    if (token.length === 0) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, getKey, {
        // Supabase access tokens always carry aud:"authenticated"
        audience: "authenticated",
      });
      payload = result.payload;
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("jwtPayload", payload);
    await next();
  };
}
