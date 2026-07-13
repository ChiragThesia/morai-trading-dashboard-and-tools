/**
 * reauth-adapter tests (Phase 37, Plan 02, Task 3 — TDD RED phase).
 *
 * Chain-adapter idiom (chain-adapter.test.ts): a makeFakeFetch(body, status) returning
 * `new Response(JSON.stringify(body), { status })`. Covers the ok path, the
 * X-Sidecar-Admin-Token header assertion, 401/503 → err(upstream-error), a thrown fetch →
 * err(network-error), and a malformed body → err(parse-error).
 */

import { describe, it, expect } from "vitest";
import { makeSidecarReauthAdapter } from "./reauth-adapter.ts";

const ADMIN_TOKEN = "fake-admin-token-for-tests";
const BASE_URL = "http://sidecar.railway.internal:8000";

/** Captures every fetch call's URL + init alongside returning a canned Response. */
function makeCapturingFetch(
  body: unknown,
  status: number,
): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: ReadonlyArray<{ readonly url: string; readonly init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, calls };
}

function parsedBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("expected a string request body");
  return JSON.parse(body);
}

describe("makeSidecarReauthAdapter", () => {
  describe("startReauth", () => {
    it("POSTs {app} with the X-Sidecar-Admin-Token header, Zod-parses the real 3-key sidecar body into ok({authUrl})", async () => {
      // CR-01 regression: the sidecar's StartResponse ALWAYS carries {app, authUrl, state}
      // (reauth_admin.py). The adapter must parse that exact body — a strict schema that omits
      // `app` rejects the real sidecar and /reauth/start can never return 200 in production.
      const { fetch, calls } = makeCapturingFetch(
        { app: "trader", authUrl: "https://api.schwabapi.com/oauth/authorize", state: "server-side-nonce" },
        200,
      );
      const adapter = makeSidecarReauthAdapter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetch });

      const result = await adapter.startReauth("trader");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.value).toEqual({ authUrl: "https://api.schwabapi.com/oauth/authorize" });

      const call = calls[0];
      if (call === undefined) throw new Error("expected one fetch call");
      expect(call.url).toBe(`${BASE_URL}/sidecar/admin/reauth/start`);
      expect(call.init?.method).toBe("POST");
      expect(parsedBody(call.init)).toEqual({ app: "trader" });
      expect(new Headers(call.init?.headers).get("X-Sidecar-Admin-Token")).toBe(ADMIN_TOKEN);
    });

    it("maps a 401 response to err(upstream-error)", async () => {
      const { fetch } = makeCapturingFetch({ error: "unauthorized" }, 401);
      const adapter = makeSidecarReauthAdapter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetch });

      const result = await adapter.startReauth("trader");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected err result");
      expect(result.error.kind).toBe("upstream-error");
    });

    it("maps a thrown fetch to err(network-error)", async () => {
      const throwingFetch: typeof globalThis.fetch = async () => {
        throw new Error("ECONNREFUSED");
      };
      const adapter = makeSidecarReauthAdapter({
        baseUrl: BASE_URL,
        adminToken: ADMIN_TOKEN,
        fetch: throwingFetch,
      });

      const result = await adapter.startReauth("trader");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected err result");
      expect(result.error.kind).toBe("network-error");
    });

    it("maps a malformed body to err(parse-error)", async () => {
      const { fetch } = makeCapturingFetch({ invalid: "response" }, 200);
      const adapter = makeSidecarReauthAdapter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetch });

      const result = await adapter.startReauth("trader");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected err result");
      expect(result.error.kind).toBe("parse-error");
    });
  });

  describe("exchangeReauth", () => {
    it("POSTs {redirectUrl} with the header, Zod-parses 200 into ok({app, ok})", async () => {
      const { fetch, calls } = makeCapturingFetch({ app: "market", ok: true }, 200);
      const adapter = makeSidecarReauthAdapter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetch });

      const result = await adapter.exchangeReauth("https://morai.wtf/?code=abc&state=nonce-1");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.value).toEqual({ app: "market", ok: true });

      const call = calls[0];
      if (call === undefined) throw new Error("expected one fetch call");
      expect(call.url).toBe(`${BASE_URL}/sidecar/admin/reauth/exchange`);
      expect(parsedBody(call.init)).toEqual({ redirectUrl: "https://morai.wtf/?code=abc&state=nonce-1" });
      expect(new Headers(call.init?.headers).get("X-Sidecar-Admin-Token")).toBe(ADMIN_TOKEN);
    });

    it("maps a 503 response to err(upstream-error)", async () => {
      const { fetch } = makeCapturingFetch({ error: "unavailable" }, 503);
      const adapter = makeSidecarReauthAdapter({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetch });

      const result = await adapter.exchangeReauth("https://morai.wtf/?code=abc&state=nonce-1");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected err result");
      expect(result.error.kind).toBe("upstream-error");
    });
  });
});
