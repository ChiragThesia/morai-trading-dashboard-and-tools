/**
 * Re-auth contract tests (Phase 37, Plan 02 — REAUTH-05).
 *
 * All four schemas are `.strict()`. The exchange response is a bare `{ app, ok }` — an extra
 * key (a `code`/`state` echo, or a `redirectUrl`) must be REJECTED, enforcing the no-leak
 * invariant (T-37-06) at the type boundary.
 */

import { describe, it, expect } from "vitest";
import {
  reauthStartRequest,
  reauthStartSidecarResponse,
  reauthStartResponse,
  reauthExchangeRequest,
  reauthExchangeResponse,
} from "./reauth.ts";

describe("reauthStartRequest", () => {
  it("parses a valid app value", () => {
    expect(() => reauthStartRequest.parse({ app: "trader" })).not.toThrow();
    expect(() => reauthStartRequest.parse({ app: "market" })).not.toThrow();
  });

  it("rejects an unknown app value", () => {
    expect(() => reauthStartRequest.parse({ app: "other" })).toThrow();
  });

  it("rejects an extra key", () => {
    expect(() => reauthStartRequest.parse({ app: "trader", extra: "nope" })).toThrow();
  });
});

describe("reauthStartSidecarResponse", () => {
  it("parses the real 3-key sidecar body {app, authUrl, state}", () => {
    // CR-01 regression: the sidecar's StartResponse always carries `app` — the adapter's schema
    // MUST accept it, or /reauth/start 500s against the real sidecar.
    expect(() =>
      reauthStartSidecarResponse.parse({
        app: "trader",
        authUrl: "https://api.schwabapi.com/oauth/authorize",
        state: "nonce-1",
      }),
    ).not.toThrow();
  });

  it("rejects a non-URL authUrl", () => {
    expect(() =>
      reauthStartSidecarResponse.parse({ app: "trader", authUrl: "not-a-url", state: "nonce-1" }),
    ).toThrow();
  });

  it("rejects an unknown app value", () => {
    expect(() =>
      reauthStartSidecarResponse.parse({
        app: "other",
        authUrl: "https://api.schwabapi.com/oauth/authorize",
        state: "nonce-1",
      }),
    ).toThrow();
  });

  it("rejects an extra key (e.g. a code echo)", () => {
    expect(() =>
      reauthStartSidecarResponse.parse({
        app: "trader",
        authUrl: "https://api.schwabapi.com/oauth/authorize",
        state: "nonce-1",
        code: "leak",
      }),
    ).toThrow();
  });
});

describe("reauthStartResponse", () => {
  it("parses the real slim server body { authUrl } with no state", () => {
    // CR-02 regression: the server route returns { authUrl } ONLY — the browser-facing schema
    // MUST accept a state-free body, or the wizard's Authorize button silently dies.
    expect(() =>
      reauthStartResponse.parse({ authUrl: "https://api.schwabapi.com/oauth/authorize" }),
    ).not.toThrow();
  });

  it("rejects a non-URL authUrl", () => {
    expect(() => reauthStartResponse.parse({ authUrl: "not-a-url" })).toThrow();
  });

  it("rejects a state field — the CSRF nonce must never reach the browser (no-leak invariant)", () => {
    expect(() =>
      reauthStartResponse.parse({ authUrl: "https://api.schwabapi.com/oauth/authorize", state: "nonce-1" }),
    ).toThrow();
  });

  it("rejects an extra key (e.g. a code echo)", () => {
    expect(() =>
      reauthStartResponse.parse({
        authUrl: "https://api.schwabapi.com/oauth/authorize",
        code: "leak",
      }),
    ).toThrow();
  });
});

describe("reauthExchangeRequest", () => {
  it("parses a valid redirectUrl", () => {
    expect(() =>
      reauthExchangeRequest.parse({ redirectUrl: "https://morai.wtf/?code=abc&state=nonce-1" }),
    ).not.toThrow();
  });

  it("rejects a non-URL redirectUrl", () => {
    expect(() => reauthExchangeRequest.parse({ redirectUrl: "not-a-url" })).toThrow();
  });

  it("rejects an extra key", () => {
    expect(() =>
      reauthExchangeRequest.parse({ redirectUrl: "https://morai.wtf/?code=abc", extra: "nope" }),
    ).toThrow();
  });
});

describe("reauthExchangeResponse", () => {
  it("parses a valid app + ok payload", () => {
    expect(() => reauthExchangeResponse.parse({ app: "trader", ok: true })).not.toThrow();
    expect(() => reauthExchangeResponse.parse({ app: "market", ok: false })).not.toThrow();
  });

  it("rejects an unknown app value", () => {
    expect(() => reauthExchangeResponse.parse({ app: "other", ok: true })).toThrow();
  });

  it("rejects a code/state echo on the exchange response", () => {
    expect(() => reauthExchangeResponse.parse({ app: "trader", ok: true, code: "leak" })).toThrow();
    expect(() => reauthExchangeResponse.parse({ app: "trader", ok: true, state: "leak" })).toThrow();
  });

  it("rejects a redirectUrl on the exchange response", () => {
    expect(() =>
      reauthExchangeResponse.parse({ app: "trader", ok: true, redirectUrl: "https://morai.wtf/" }),
    ).toThrow();
  });
});
