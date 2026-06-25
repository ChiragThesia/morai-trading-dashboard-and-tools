/**
 * auth-integration.test.ts — auth group integration tests (SC-4 / AUTH-01 / D20).
 *
 * Validates:
 *   (a) No-JWT → 200 on GET /api/status (public healthcheck — Railway healthcheckPath)
 *   (a2) No-JWT → 401 on data routes (T-08-AUTH1)
 *   (b) Valid ES256 JWT with correct audience → passes gate (not 401) (T-08-AUTH2)
 *   (c) Tampered / invalid JWT → 401 on data routes (T-08-AUTH2)
 *   (d) Preflight OPTIONS from WEB_ORIGIN → CORS headers returned,
 *       Access-Control-Allow-Origin = WEB_ORIGIN (not '*') (T-08-AUTH3 / Pitfall 7)
 *   (e) Request from a different origin → no WEB_ORIGIN allow-origin header (T-08-AUTH3)
 *   (f) Token signed by a DIFFERENT (wrong) ES256 key → 401 (proves real signature verify)
 *
 * Test JWTs are signed with ES256 via jose SignJWT.
 * The test app wires makeSupabaseJwtAuth with createLocalJWKSet (offline — no network).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
} from "jose";
import type { JWTVerifyGetKey } from "jose";
import { ok } from "@morai/shared";
import type { ForRunningGetGex } from "@morai/core";
import { gexRoutes } from "./gex.routes.ts";
import type { ForGettingStatus } from "@morai/core";
import { statusRoutes } from "./status.routes.ts";
import { makeSupabaseJwtAuth } from "./supabase-auth.ts";

// ── Test constants ────────────────────────────────────────────────────────────

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

// ── ES256 key material (generated once per suite) ─────────────────────────────

type KeyMaterial = {
  privateKey: CryptoKey;
  localJwks: JWTVerifyGetKey;
};

type WrongKeyMaterial = {
  privateKey: CryptoKey;
};

let keys: KeyMaterial;
let wrongKeys: WrongKeyMaterial;

beforeAll(async () => {
  // Primary ES256 keypair — used for valid tokens
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  // Set alg and use so createLocalJWKSet can select this key correctly
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  const localJwks = createLocalJWKSet({ keys: [publicJwk] });
  keys = { privateKey, localJwks };

  // Wrong ES256 keypair — proves a foreign key is rejected
  const { privateKey: wrongPrivateKey } = await generateKeyPair("ES256");
  wrongKeys = { privateKey: wrongPrivateKey };
});

// ── Test app builder (mirrors the main.ts composition) ───────────────────────

/**
 * buildAuthApp — build a Hono test app that mirrors the main.ts auth composition:
 *   CORS first → public /api/status → JWKS-authenticated authReadGroup → data routes.
 * Accepts an injectable getKey so tests run fully offline.
 *
 * /api/status is mounted PUBLIC (outside the auth group) so Railway's healthcheckPath
 * can reach it without a JWT token (SC-4 / healthcheck fix).
 */
function buildAuthApp(getKey: JWTVerifyGetKey) {
  const app = new Hono();

  // Pitfall 7: CORS must be FIRST — before the auth group.
  app.use(
    "/*",
    cors({
      origin: TEST_WEB_ORIGIN,
      credentials: true,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // PUBLIC: /api/status — no JWT required (Railway healthcheck + status page).
  app.route("/api", statusRoutes(okGetStatus));

  // JWKS-authenticated read group (ES256 asymmetric verify — same structure as main.ts).
  // Data routes are gated; /api/status is NOT in this group.
  const dataRouter = new Hono().route("/analytics", gexRoutes(getGexNull));

  const authReadGroup = new Hono();
  authReadGroup.use("/*", makeSupabaseJwtAuth({ getKey }));
  authReadGroup.route("/", dataRouter);
  app.route("/api", authReadGroup);

  return app;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Mint a valid ES256 JWT with the correct audience using the primary test keypair. */
async function signValidJwt(
  payload: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({ sub: "test-user", ...payload })
    .setProtectedHeader({ alg: "ES256" })
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}

/** Mint an ES256 JWT signed by the WRONG keypair (simulates a forged token). */
async function signWrongKeyJwt(): Promise<string> {
  return new SignJWT({ sub: "attacker" })
    .setProtectedHeader({ alg: "ES256" })
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(wrongKeys.privateKey);
}

// ── Auth integration tests ────────────────────────────────────────────────────

describe("Supabase Auth JWT gate — ES256 JWKS verify (SC-4 / AUTH-01 / D20)", () => {
  it("(a) no Authorization header → 200 on GET /api/status (public healthcheck)", async () => {
    const app = buildAuthApp(keys.localJwks);
    const res = await app.request("/api/status");
    // /api/status is public — Railway healthcheckPath must reach it without a JWT.
    expect(res.status).toBe(200);
  });

  it("(a2) no Authorization header → 401 on GET /api/analytics/gex (data route stays gated)", async () => {
    const app = buildAuthApp(keys.localJwks);
    const res = await app.request("/api/analytics/gex");
    expect(res.status).toBe(401);
  });

  it("(b) valid ES256 JWT → passes gate (not 401) on GET /api/status", async () => {
    const app = buildAuthApp(keys.localJwks);
    const token = await signValidJwt();
    const res = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Should be 200 — route is public so token is irrelevant, but must not 401.
    expect(res.status).not.toBe(401);
  });

  it("(b) valid ES256 JWT → passes gate (not 401) on GET /api/analytics/gex", async () => {
    const app = buildAuthApp(keys.localJwks);
    const token = await signValidJwt();
    const res = await app.request("/api/analytics/gex", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // getGexNull → 404 (no-snapshot), which proves the gate was passed (not 401)
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it("(b) minted token is a 3-part JWT with alg:ES256 header", async () => {
    const token = await signValidJwt({ role: "authenticated" });
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(3); // header.payload.signature
    const header = JSON.parse(atob(parts[0] ?? ""));
    expect(header.alg).toBe("ES256");
  });

  it("(c) tampered JWT → 401 on data route", async () => {
    const app = buildAuthApp(keys.localJwks);
    const token = await signValidJwt();
    // Tamper the signature portion
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.TAMPERED_SIGNATURE_HERE`;
    const res = await app.request("/api/analytics/gex", {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("(c) completely invalid JWT string → 401 on data route", async () => {
    const app = buildAuthApp(keys.localJwks);
    const res = await app.request("/api/analytics/gex", {
      headers: { Authorization: "Bearer not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("(f) token signed by a DIFFERENT (wrong) ES256 key → 401 on data route (real signature verification)", async () => {
    const app = buildAuthApp(keys.localJwks);
    const wrongToken = await signWrongKeyJwt();
    const res = await app.request("/api/analytics/gex", {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("CORS headers (SC-4 / T-08-AUTH3 / Pitfall 7)", () => {
  it("(d) preflight OPTIONS from WEB_ORIGIN → 200 + Access-Control-Allow-Origin = WEB_ORIGIN", async () => {
    const app = buildAuthApp(keys.localJwks);
    const res = await app.request("/api/status", {
      method: "OPTIONS",
      headers: {
        Origin: TEST_WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    // Preflight must not be blocked by the auth gate (CORS is applied first — Pitfall 7)
    expect(res.status).not.toBe(401);
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    // Must be the exact origin, never '*'
    expect(allowOrigin).toBe(TEST_WEB_ORIGIN);
    expect(allowOrigin).not.toBe("*");
  });

  it("(d) CORS allows credentials (required for auth header delivery)", async () => {
    const app = buildAuthApp(keys.localJwks);
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
    const app = buildAuthApp(keys.localJwks);
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
    const app = buildAuthApp(keys.localJwks);
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
