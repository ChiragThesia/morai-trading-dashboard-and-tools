import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeRefreshTokenUseCase } from "./refreshToken.ts";
import type { ForReadingTokens, ForWritingTokens, AuthExpiredError, SchwabTokenRow } from "./ports.ts";
import type { SchwabTokens, OAuthError, ForRefreshingToken } from "./refreshToken.ts";

// ─── Test doubles ─────────────────────────────────────────────────────────────

const now = new Date();
const thirtyMinLater = new Date(now.getTime() + 30 * 60 * 1000);

function makeStoredRow(overrides: Partial<SchwabTokenRow> = {}): SchwabTokenRow {
  return {
    appId: "trader",
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
    issuedAt: now,
    refreshIssuedAt: now,
    expiresAt: thirtyMinLater,
    lastRefreshError: null,
    ...overrides,
  };
}

function makeNewTokens(overrides: Partial<SchwabTokens> = {}): SchwabTokens {
  return {
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
    expiresIn: 1800,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeRefreshTokenUseCase", () => {
  it("happy path: reads tokens, calls refreshTokens, writes rotated tokens, returns ok(newTokens)", async () => {
    const storedRow = makeStoredRow();
    const newTokens = makeNewTokens();

    let writtenAppId: string | undefined;
    let writtenTokens: SchwabTokenRow | undefined;

    const readTokens: ForReadingTokens = async (appId) => {
      expect(appId).toBe("trader");
      return ok(storedRow);
    };

    const writeTokens: ForWritingTokens = async (appId, tokens) => {
      writtenAppId = appId;
      writtenTokens = tokens;
      return ok(undefined);
    };

    const refreshTokensFn = async (_refreshToken: string) => ok(newTokens);

    const useCase: ForRefreshingToken = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    const result = await useCase("trader");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessToken).toBe("new-access-token");
    expect(result.value.refreshToken).toBe("new-refresh-token");

    // Verify that the rotated tokens were persisted
    expect(writtenAppId).toBe("trader");
    expect(writtenTokens?.accessToken).toBe("new-access-token");
    expect(writtenTokens?.refreshToken).toBe("new-refresh-token");
  });

  it("happy path: passes the stored refresh token to refreshTokens", async () => {
    const storedRow = makeStoredRow({ refreshToken: "the-exact-stored-refresh-token" });
    const newTokens = makeNewTokens();

    let capturedRefreshToken: string | undefined;

    const readTokens: ForReadingTokens = async () => ok(storedRow);
    const writeTokens: ForWritingTokens = async () => ok(undefined);
    const refreshTokensFn = async (refreshToken: string) => {
      capturedRefreshToken = refreshToken;
      return ok(newTokens);
    };

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    await useCase("trader");
    expect(capturedRefreshToken).toBe("the-exact-stored-refresh-token");
  });

  it("on invalid_grant: returns err({kind:auth-expired,appId}) and does NOT write", async () => {
    const storedRow = makeStoredRow();
    let writeCallCount = 0;

    const readTokens: ForReadingTokens = async () => ok(storedRow);
    const writeTokens: ForWritingTokens = async () => {
      writeCallCount++;
      return ok(undefined);
    };
    const refreshTokensFn = async () =>
      err<OAuthError>({
        kind: "oauth-error",
        code: "invalid_grant",
        message: "Refresh token expired",
      });

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    const result = await useCase("trader");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth-expired");
    if (result.error.kind !== "auth-expired") return;
    expect(result.error.appId).toBe("trader");
    // MUST NOT write half-state (T-04-08)
    expect(writeCallCount).toBe(0);
  });

  it("on invalid_client: returns err({kind:auth-expired,appId}) and does NOT write", async () => {
    const storedRow = makeStoredRow({ appId: "market" });
    let writeCallCount = 0;

    const readTokens: ForReadingTokens = async () => ok(storedRow);
    const writeTokens: ForWritingTokens = async () => {
      writeCallCount++;
      return ok(undefined);
    };
    const refreshTokensFn = async () =>
      err<OAuthError>({
        kind: "oauth-error",
        code: "invalid_client",
        message: "refresh token invalid",
      });

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    const result = await useCase("market");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth-expired");
    if (result.error.kind !== "auth-expired") return;
    expect(result.error.appId).toBe("market");
    expect(writeCallCount).toBe(0);
  });

  it("on network error from refreshTokens: surfaces as auth-expired (safe degradation)", async () => {
    const storedRow = makeStoredRow();

    const readTokens: ForReadingTokens = async () => ok(storedRow);
    const writeTokens: ForWritingTokens = async () => ok(undefined);
    const refreshTokensFn = async () =>
      err<OAuthError>({
        kind: "oauth-error",
        code: "network",
        message: "network timeout",
      });

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    const result = await useCase("trader");
    // Any OAuth error should surface as a typed error — never throw
    expect(result.ok).toBe(false);
  });

  it("no stored tokens for appId: returns err (auth-expired style)", async () => {
    const readTokens: ForReadingTokens = async () => ok(null);
    const writeTokens: ForWritingTokens = async () => ok(undefined);
    const refreshTokensFn = async () => ok(makeNewTokens());

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    const result = await useCase("trader");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Must return some typed error, not throw
    expect(result.error.kind).toBe("auth-expired");
    if (result.error.kind !== "auth-expired") return;
    expect(result.error.appId).toBe("trader");
  });

  it("does not throw — readTokens storage error surfaces as typed error", async () => {
    const readTokens: ForReadingTokens = async () =>
      err({ kind: "storage-error" as const, message: "DB down" });
    const writeTokens: ForWritingTokens = async () => ok(undefined);
    const refreshTokensFn = async () => ok(makeNewTokens());

    const useCase = makeRefreshTokenUseCase({
      readTokens,
      writeTokens,
      refreshTokens: refreshTokensFn,
    });

    // Must not throw — returns a typed Result
    const result = await useCase("trader");
    expect(result.ok).toBe(false);
  });
});
