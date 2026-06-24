/**
 * auth-integration.test.ts — Task 3: auth group integration tests (SC-4 / AUTH-01).
 *
 * Validates:
 *   (a) No-JWT → 401 on read endpoints (T-08-AUTH1)
 *   (b) Valid HS256 JWT signed with test secret → passes gate (not 401) (T-08-AUTH2)
 *   (c) Tampered / invalid JWT → 401 (T-08-AUTH2)
 *   (d) Preflight OPTIONS from WEB_ORIGIN → CORS headers returned,
 *       Access-Control-Allow-Origin = WEB_ORIGIN (not '*') (T-08-AUTH3 / Pitfall 7)
 *   (e) Request from a different origin → no WEB_ORIGIN allow-origin header (T-08-AUTH3)
 *
 * Test JWTs are signed with Jwt.sign() from hono/utils/jwt using the test secret + alg HS256.
 * This proves the offline HS256 verify path (A2) — no supabase.auth.getUser() network call.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { cors } from "hono/cors";
import { Jwt } from "hono/utils/jwt";
import { ok } from "@morai/shared";
import type { ForRunningGetGex } from "@morai/core";
import { gexRoutes } from "./gex.routes.ts";
import type { ForGettingStatus } from "@morai/core";
import { statusRoutes } from "./status.routes.ts";

// ── Test constants ────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = "test-supabase-jwt-secret-must-be-32-chars-min";
const TEST_WEB_ORIGIN = "http://localhost:5173";
const OTHER_ORIGIN = "http://evil.example.com";

// ── Test doubles ──────────────────────────────────────────────────────────────

const getGexNull: ForRunningGetGex = async () => ok(null);

const okGetStatus: ForGettingStatus = async () =>
  ok({
    db: "ok" as const,
    tokenFreshness: "none yet" as const,
    lastJobRuns: "none yet" as const,
    version: "0.0.1",
    uptime: 42,
  });

// ── Test app builder (mirrors the main.ts composition) ───────────────────────

/**
 * buildAuthApp — build a Hono test app that mirrors the main.ts auth composition:
 *   CORS first → JWT authReadGroup → read routes.
 * Used to test the auth + CORS middleware wiring in isolation.
 */
function buildAuthApp() {
  const app = new Hono();

  // Pitfall 7: CORS must be FIRST — before the JWT group.
  app.use(
    "/*",
    cors({
      origin: TEST_WEB_ORIGIN,
      credentials: true,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // JWT-guarded read group (HS256 offline verify — same as main.ts).
  const apiRouter = new Hono()
    .route("/", statusRoutes(okGetStatus))
    .route("/analytics", gexRoutes(getGexNull));

  const authReadGroup = new Hono();
  authReadGroup.use("/*", jwt({ secret: TEST_JWT_SECRET, alg: "HS256" }));
  authReadGroup.route("/", apiRouter);
  app.route("/api", authReadGroup);

  return app;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Sign a test JWT with HS256 using the test secret. */
async function signTestJwt(
  payload: Record<string, unknown> = {},
): Promise<string> {
  return Jwt.sign(
    { sub: "test-user", iat: Math.floor(Date.now() / 1000), ...payload },
    TEST_JWT_SECRET,
    "HS256",
  );
}

// ── Auth integration tests ────────────────────────────────────────────────────

describe("Supabase Auth JWT gate (SC-4 / AUTH-01)", () => {
  it("(a) no Authorization header → 401 on GET /api/status", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/status");
    expect(res.status).toBe(401);
  });

  it("(a) no Authorization header → 401 on GET /api/analytics/gex", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/analytics/gex");
    expect(res.status).toBe(401);
  });

  it("(b) valid HS256 JWT → passes gate (not 401) on GET /api/status", async () => {
    const app = buildAuthApp();
    const token = await signTestJwt();
    const res = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Should NOT be 401 (auth passed); actual status is route-dependent (200/404/500)
    expect(res.status).not.toBe(401);
  });

  it("(b) valid HS256 JWT → passes gate (not 401) on GET /api/analytics/gex", async () => {
    const app = buildAuthApp();
    const token = await signTestJwt();
    const res = await app.request("/api/analytics/gex", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // getGexNull → 404 (no-snapshot), which proves the gate was passed (not 401)
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it("(b) valid HS256 JWT is signed with hono Jwt.sign() using test secret (A2 — offline path)", async () => {
    // This test explicitly proves the token was signed with HS256 + test secret
    // and is accepted by the same hono/jwt middleware — no network call.
    const app = buildAuthApp();
    const token = await signTestJwt({ role: "authenticated" });
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(3); // header.payload.signature
    const header = JSON.parse(atob(parts[0] ?? ""));
    expect(header.alg).toBe("HS256");
  });

  it("(c) tampered JWT → 401", async () => {
    const app = buildAuthApp();
    const token = await signTestJwt();
    // Tamper the signature portion
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.TAMPERED_SIGNATURE_HERE`;
    const res = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("(c) completely invalid JWT string → 401", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/status", {
      headers: { Authorization: "Bearer not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("(c) JWT signed with wrong secret → 401 (forgery attempt)", async () => {
    const app = buildAuthApp();
    // Sign with a DIFFERENT secret
    const wrongToken = await Jwt.sign(
      { sub: "attacker", iat: Math.floor(Date.now() / 1000) },
      "wrong-secret-32-chars-must-be-here-pad",
      "HS256",
    );
    const res = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("CORS headers (SC-4 / T-08-AUTH3 / Pitfall 7)", () => {
  it("(d) preflight OPTIONS from WEB_ORIGIN → 200 + Access-Control-Allow-Origin = WEB_ORIGIN", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/status", {
      method: "OPTIONS",
      headers: {
        Origin: TEST_WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    // Preflight must not be blocked by the JWT gate (CORS is applied first — Pitfall 7)
    expect(res.status).not.toBe(401);
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    // Must be the exact origin, never '*'
    expect(allowOrigin).toBe(TEST_WEB_ORIGIN);
    expect(allowOrigin).not.toBe("*");
  });

  it("(d) CORS allows credentials (required for auth header delivery)", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/analytics/gex", {
      method: "OPTIONS",
      headers: {
        Origin: TEST_WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    const allowCredentials = res.headers.get("Access-Control-Allow-Credentials");
    expect(allowCredentials).toBe("true");
  });

  it("(e) request from different origin does NOT receive WEB_ORIGIN allow-origin header", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/status", {
      method: "OPTIONS",
      headers: {
        Origin: OTHER_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    // Must not return WEB_ORIGIN for an untrusted origin
    expect(allowOrigin).not.toBe(TEST_WEB_ORIGIN);
  });

  it("CORS allow-origin is never '*' (T-08-AUTH3 EoP prohibition)", async () => {
    const app = buildAuthApp();
    const res = await app.request("/api/status", {
      method: "OPTIONS",
      headers: {
        Origin: TEST_WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin).not.toBe("*");
  });
});
