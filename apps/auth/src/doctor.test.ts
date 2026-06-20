/**
 * doctor.test.ts — Unit tests for pure doctor diagnostic functions.
 *
 * All three conditions tested with in-memory/fake deps — no process.env,
 * no network, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  checkEnvCompleteness,
  checkCallbackExactMatch,
  checkLiveRefresh,
} from "./doctor.ts";

// ─── checkEnvCompleteness ─────────────────────────────────────────────────────

describe("checkEnvCompleteness", () => {
  const FULL_ENV = {
    TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    SCHWAB_TRADER_APP_KEY: "trader-key",
    SCHWAB_TRADER_APP_SECRET: "trader-secret",
    SCHWAB_TRADER_CALLBACK_URL: "https://127.0.0.1:8182",
    SCHWAB_MARKET_APP_KEY: "market-key",
    SCHWAB_MARKET_APP_SECRET: "market-secret",
    SCHWAB_MARKET_CALLBACK_URL: "https://127.0.0.1:8183",
  };

  it("returns ok with no missing keys when all required fields are present", () => {
    const result = checkEnvCompleteness(FULL_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missing).toHaveLength(0);
    }
  });

  it("reports missing TOKEN_ENCRYPTION_KEY", () => {
    const env = { ...FULL_ENV, TOKEN_ENCRYPTION_KEY: "" };
    const result = checkEnvCompleteness(env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missing).toContain("TOKEN_ENCRYPTION_KEY");
    }
  });

  it("reports missing SCHWAB_TRADER_APP_KEY", () => {
    const { SCHWAB_TRADER_APP_KEY: _, ...rest } = FULL_ENV;
    const result = checkEnvCompleteness(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missing).toContain("SCHWAB_TRADER_APP_KEY");
    }
  });

  it("reports multiple missing keys", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "postgres://localhost/test",
    };
    const result = checkEnvCompleteness(env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.missing.length).toBeGreaterThan(1);
    }
  });
});

// ─── checkCallbackExactMatch ──────────────────────────────────────────────────

describe("checkCallbackExactMatch", () => {
  it("returns ok match=true when URLs are identical", () => {
    const url = "https://127.0.0.1:8182";
    const result = checkCallbackExactMatch(url, url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.match).toBe(true);
    }
  });

  it("returns ok match=false when trailing slash differs (Pitfall 1)", () => {
    const result = checkCallbackExactMatch(
      "https://127.0.0.1:8182",
      "https://127.0.0.1:8182/",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.match).toBe(false);
    }
  });

  it("returns ok match=false when ports differ", () => {
    const result = checkCallbackExactMatch(
      "https://127.0.0.1:8182",
      "https://127.0.0.1:9999",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.match).toBe(false);
    }
  });

  it("returns ok match=false when registered URL has path suffix", () => {
    const result = checkCallbackExactMatch(
      "https://127.0.0.1:8182/callback",
      "https://127.0.0.1:8182",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.match).toBe(false);
    }
  });
});

// ─── checkLiveRefresh ─────────────────────────────────────────────────────────

describe("checkLiveRefresh", () => {
  it("returns ok status=ok when refresh succeeds", async () => {
    const fakRefresh = async () => ({ ok: true as const, value: undefined });
    const result = await checkLiveRefresh(fakRefresh);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("ok");
    }
  });

  it("returns ok status=auth-expired when refresh returns auth-expired", async () => {
    const fakeRefresh = async () => ({
      ok: false as const,
      error: { kind: "auth-expired" as const, appId: "trader" as const },
    });
    const result = await checkLiveRefresh(fakeRefresh);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("auth-expired");
    }
  });

  it("returns ok status=network-error when refresh throws", async () => {
    const fakeRefresh = async (): Promise<never> => {
      throw new Error("ECONNREFUSED");
    };
    const result = await checkLiveRefresh(fakeRefresh);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("network-error");
    }
  });

  it("returns ok status=network-error when refresh returns storage-error", async () => {
    const fakeRefresh = async () => ({
      ok: false as const,
      error: { kind: "storage-error" as const, message: "DB down" },
    });
    const result = await checkLiveRefresh(fakeRefresh);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("network-error");
    }
  });
});
