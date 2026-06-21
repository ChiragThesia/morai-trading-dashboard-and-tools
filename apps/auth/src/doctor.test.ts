/**
 * doctor.test.ts — Unit tests for pure doctor diagnostic functions.
 *
 * All three conditions tested with in-memory/fake deps — no process.env,
 * no network, no DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkEnvCompleteness,
  checkCallbackExactMatch,
  checkLiveRefresh,
  runDoctorCommand,
} from "./doctor.ts";
import { makeMemoryBrokerTokensRepo } from "@morai/adapters";
import { ok, err } from "@morai/shared";
import type { SchwabTokenRow } from "@morai/core";

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

// ─── runDoctorCommand — real wiring (SC2 regression) ─────────────────────────
//
// SC2 regression: the old implementation used a hardcoded dummy token
// "__doctor_probe__" and ignored the real stored refresh token.
// These tests verify that runDoctorCommand reads the REAL stored token
// and drives makeRefreshTokenUseCase correctly.

const BASE_CONFIG = {
  TOKEN_ENCRYPTION_KEY: "a".repeat(32),
  SCHWAB_TRADER_APP_KEY: "trader-key",
  SCHWAB_TRADER_APP_SECRET: "trader-secret",
  SCHWAB_TRADER_CALLBACK_URL: "https://127.0.0.1:8182",
  SCHWAB_MARKET_APP_KEY: "market-key",
  SCHWAB_MARKET_APP_SECRET: "market-secret",
  SCHWAB_MARKET_CALLBACK_URL: "https://127.0.0.1:8183",
};

const TRADER_TOKEN: SchwabTokenRow = {
  appId: "trader",
  accessToken: "real-access-token",
  refreshToken: "real-refresh-token",
  issuedAt: new Date(),
  refreshIssuedAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
};

describe("runDoctorCommand — real wiring (SC2)", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("reports live-refresh OK when the real use-case succeeds (not NETWORK_ERROR)", async () => {
    // Seed an in-memory repo with a real trader token
    const repo = makeMemoryBrokerTokensRepo();
    await repo.seed("trader", TRADER_TOKEN);

    // Fake oauth client returns a valid token response
    const fakeRefreshTokensFn = vi.fn().mockResolvedValue(
      ok({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 1800,
      }),
    );

    await runDoctorCommand(BASE_CONFIG, repo, fakeRefreshTokensFn);

    // The real refresh token from the repo must have been passed to the oauth client
    expect(fakeRefreshTokensFn).toHaveBeenCalledWith("real-refresh-token");
    expect(fakeRefreshTokensFn).not.toHaveBeenCalledWith("__doctor_probe__");

    // Doctor should report OK, not NETWORK_ERROR
    const warnCalls = consoleWarnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    const errorCalls = consoleErrorSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    const liveRefreshOk = warnCalls.some((msg: string) => msg.includes("live refresh: OK"));
    const networkError = errorCalls.some((msg: string) => msg.includes("NETWORK_ERROR"));
    expect(liveRefreshOk).toBe(true);
    expect(networkError).toBe(false);
  });

  it("reports AUTH_EXPIRED when the oauth client returns invalid_grant", async () => {
    const repo = makeMemoryBrokerTokensRepo();
    await repo.seed("trader", TRADER_TOKEN);

    // Fake oauth client returns invalid_grant
    const fakeRefreshTokensFn = vi.fn().mockResolvedValue(
      err({
        kind: "oauth-error" as const,
        code: "invalid_grant" as const,
        message: "token expired",
      }),
    );

    await runDoctorCommand(BASE_CONFIG, repo, fakeRefreshTokensFn);

    const errorCalls = consoleErrorSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    const authExpired = errorCalls.some((msg: string) => msg.includes("AUTH_EXPIRED"));
    expect(authExpired).toBe(true);
  });
});
