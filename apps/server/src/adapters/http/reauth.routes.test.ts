import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForStartingReauth, ForExchangingReauth, ReauthError } from "@morai/core";
import { reauthExchangeResponse } from "@morai/contracts";
import { reauthRoutes } from "./reauth.routes.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NETWORK_ERROR: ReauthError = { kind: "network-error", message: "fetch failed to sidecar host 10.0.0.7 secret-token-xyz" };

// ─── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(startReauth: ForStartingReauth, exchangeReauth: ForExchangingReauth) {
  const app = new Hono();
  app.route("/api", reauthRoutes(startReauth, exchangeReauth));
  return app;
}

describe("POST /api/reauth/start", () => {
  it("returns 200 with { authUrl } on a valid app — no state field (T-37-06, never crosses this boundary)", async () => {
    const startReauth: ForStartingReauth = async () => ok({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
    const exchangeReauth: ForExchangingReauth = async () => ok({ app: "trader", ok: true });
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: "trader" }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
  });

  it("returns 500 with a generic body that leaks no upstream detail when the use-case errs", async () => {
    const startReauth: ForStartingReauth = async () => err(NETWORK_ERROR);
    const exchangeReauth: ForExchangingReauth = async () => ok({ app: "trader", ok: true });
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: "trader" }),
    });

    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("secret-token-xyz");
    expect(JSON.stringify(body)).not.toContain("10.0.0.7");
  });

  it("returns 400 on an invalid app enum before the use-case is ever called", async () => {
    let called = false;
    const startReauth: ForStartingReauth = async () => {
      called = true;
      return ok({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
    };
    const exchangeReauth: ForExchangingReauth = async () => ok({ app: "trader", ok: true });
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: "not-a-real-app" }),
    });

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe("POST /api/reauth/exchange", () => {
  it("returns 200 with { app, ok } on a valid redirectUrl", async () => {
    const startReauth: ForStartingReauth = async () => ok({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
    const exchangeReauth: ForExchangingReauth = async () => ok({ app: "market", ok: true });
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUrl: "https://morai.wtf/?code=abc&state=xyz" }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = reauthExchangeResponse.parse(body);
    expect(parsed).toEqual({ app: "market", ok: true });
  });

  it("returns 500 with a generic body that leaks no upstream detail when the use-case errs", async () => {
    const startReauth: ForStartingReauth = async () => ok({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
    const exchangeReauth: ForExchangingReauth = async () => err(NETWORK_ERROR);
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUrl: "https://morai.wtf/?code=abc&state=xyz" }),
    });

    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("secret-token-xyz");
    expect(JSON.stringify(body)).not.toContain("10.0.0.7");
  });

  it("returns 400 on a non-URL redirectUrl before the use-case is ever called", async () => {
    let called = false;
    const startReauth: ForStartingReauth = async () => ok({ authUrl: "https://api.schwabapi.com/v1/oauth/authorize?x=1" });
    const exchangeReauth: ForExchangingReauth = async () => {
      called = true;
      return ok({ app: "trader", ok: true });
    };
    const app = buildTestApp(startReauth, exchangeReauth);

    const res = await app.request("/api/reauth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUrl: "not-a-url" }),
    });

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});
