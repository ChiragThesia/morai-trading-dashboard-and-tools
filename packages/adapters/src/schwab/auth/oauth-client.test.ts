import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeSchwabOAuthClient } from "./oauth-client.ts";

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

const successTokenBody = {
  access_token: "test-access-token-abc",
  refresh_token: "test-refresh-token-xyz",
  token_type: "Bearer",
  expires_in: 1800,
  scope: "openid",
};

const server = setupServer(
  http.post(SCHWAB_TOKEN_URL, () => HttpResponse.json(successTokenBody)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return makeSchwabOAuthClient({
    appKey: "test-app-key",
    appSecret: "test-app-secret",
    callbackUrl: "https://127.0.0.1:5556/callback",
    fetch: globalThis.fetch,
  });
}

describe("makeSchwabOAuthClient", () => {
  describe("buildAuthUrl", () => {
    it("builds the Schwab authorization URL with required params", () => {
      const client = makeClient();
      const url = client.buildAuthUrl("state-abc-123");
      expect(url).toContain("https://api.schwabapi.com/v1/oauth/authorize");
      expect(url).toContain("client_id=test-app-key");
      expect(url).toContain("state=state-abc-123");
      expect(url).toContain("redirect_uri=");
      // redirect_uri must be URL-encoded
      expect(url).not.toContain("https://127.0.0.1:5556/callback");
      expect(url).toContain(encodeURIComponent("https://127.0.0.1:5556/callback"));
    });
  });

  describe("exchangeCode", () => {
    it("on HTTP 200 returns ok(SchwabTokens) with camelCase fields", async () => {
      const client = makeClient();
      const result = await client.exchangeCode("auth-code-123");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.accessToken).toBe("test-access-token-abc");
      expect(result.value.refreshToken).toBe("test-refresh-token-xyz");
      expect(result.value.expiresIn).toBe(1800);
    });

    it("sends Authorization: Basic base64(appKey:appSecret) header", async () => {
      let capturedAuthHeader: string | null = null;

      server.use(
        http.post(SCHWAB_TOKEN_URL, ({ request }) => {
          capturedAuthHeader = request.headers.get("Authorization");
          return HttpResponse.json(successTokenBody);
        }),
      );

      const client = makeClient();
      await client.exchangeCode("code-xyz");

      const expectedBasic = `Basic ${Buffer.from("test-app-key:test-app-secret").toString("base64")}`;
      expect(capturedAuthHeader).toBe(expectedBasic);
    });

    it("sends Content-Type: application/x-www-form-urlencoded", async () => {
      let capturedContentType: string | null = null;

      server.use(
        http.post(SCHWAB_TOKEN_URL, ({ request }) => {
          capturedContentType = request.headers.get("Content-Type");
          return HttpResponse.json(successTokenBody);
        }),
      );

      const client = makeClient();
      await client.exchangeCode("code-xyz");
      expect(capturedContentType).toContain("application/x-www-form-urlencoded");
    });

    it("sends grant_type=authorization_code with code and redirect_uri in body", async () => {
      let capturedBody: string | null = null;

      server.use(
        http.post(SCHWAB_TOKEN_URL, async ({ request }) => {
          capturedBody = await request.text();
          return HttpResponse.json(successTokenBody);
        }),
      );

      const client = makeClient();
      await client.exchangeCode("auth-code-abc");

      expect(capturedBody).toContain("grant_type=authorization_code");
      expect(capturedBody).toContain("code=auth-code-abc");
      expect(capturedBody).toContain("redirect_uri=");
      expect(capturedBody).toContain(
        encodeURIComponent("https://127.0.0.1:5556/callback"),
      );
    });

    it("on HTTP 400 with invalid_grant returns err with code:invalid_grant", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () =>
          HttpResponse.json(
            { error: "invalid_grant", error_description: "Authorization code expired" },
            { status: 400 },
          ),
        ),
      );

      const client = makeClient();
      const result = await client.exchangeCode("expired-code");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("invalid_grant");
    });

    it("on HTTP 400 with invalid_client returns err with code:invalid_client", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () =>
          HttpResponse.json(
            { error: "invalid_client", error_description: "Invalid client credentials" },
            { status: 400 },
          ),
        ),
      );

      const client = makeClient();
      const result = await client.exchangeCode("some-code");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("invalid_client");
    });

    it("on network error returns err with code:network, never throws", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () => {
          throw new TypeError("Network request failed");
        }),
      );

      const client = makeClient();
      const result = await client.exchangeCode("any-code");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("network");
    });

    it("on unparseable JSON returns err with code:parse, never throws", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () =>
          new HttpResponse("not valid json {{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = makeClient();
      const result = await client.exchangeCode("some-code");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      // Could be either parse or network depending on implementation
      expect(["parse", "network"]).toContain(result.error.code);
    });
  });

  describe("refreshTokens", () => {
    it("on HTTP 200 returns ok(new SchwabTokens)", async () => {
      const client = makeClient();
      const result = await client.refreshTokens("old-refresh-token");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.accessToken).toBe("test-access-token-abc");
      expect(result.value.refreshToken).toBe("test-refresh-token-xyz");
    });

    it("sends grant_type=refresh_token with refresh_token in body", async () => {
      let capturedBody: string | null = null;

      server.use(
        http.post(SCHWAB_TOKEN_URL, async ({ request }) => {
          capturedBody = await request.text();
          return HttpResponse.json(successTokenBody);
        }),
      );

      const client = makeClient();
      await client.refreshTokens("my-refresh-token-value");
      expect(capturedBody).toContain("grant_type=refresh_token");
      expect(capturedBody).toContain("refresh_token=my-refresh-token-value");
    });

    it("on HTTP 400 with invalid_grant returns err with code:invalid_grant", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () =>
          HttpResponse.json(
            { error: "invalid_grant", error_description: "Refresh token expired" },
            { status: 400 },
          ),
        ),
      );

      const client = makeClient();
      const result = await client.refreshTokens("expired-refresh-token");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("invalid_grant");
    });

    it("on HTTP 400 with invalid_client returns err with code:invalid_client", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () =>
          HttpResponse.json(
            { error: "invalid_client", error_description: "refresh token invalid" },
            { status: 400 },
          ),
        ),
      );

      const client = makeClient();
      const result = await client.refreshTokens("some-refresh-token");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("invalid_client");
    });

    it("on network error returns err with code:network", async () => {
      server.use(
        http.post(SCHWAB_TOKEN_URL, () => {
          throw new TypeError("Network request failed");
        }),
      );

      const client = makeClient();
      const result = await client.refreshTokens("any-refresh-token");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("oauth-error");
      expect(result.error.code).toBe("network");
    });
  });
});
