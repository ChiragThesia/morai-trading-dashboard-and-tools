/**
 * refreshTokens use-case tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - Per-app independence: trader failure does NOT block market refresh (D-13)
 *   - Per-app independence: market failure does NOT block trader refresh (D-13)
 *   - Proactive expiry warning: warnExpirySoon = true when refreshIssuedAt ≥ 6 days ago (D-14)
 *   - No expiry warning when refreshIssuedAt < 6 days ago
 *   - Both apps succeed → result carries ok: true for both
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-05 implements makeRefreshTokensUseCase.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForRefreshingToken, ForReadingTokenFreshness } from "./ports.ts";
import type { StorageError, AuthExpiredError } from "./ports.ts";
import type { TokenFreshnessMap } from "./ports.ts";
import type { SchwabTokens } from "./refreshToken.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STUB_TOKENS: SchwabTokens = {
  accessToken: "stub-access",
  refreshToken: "stub-refresh",
  expiresIn: 1800,
};

function makeFreshnessMap(opts: {
  traderRefreshIssuedAt?: Date;
  marketRefreshIssuedAt?: Date;
  now?: Date;
}): TokenFreshnessMap {
  const now = opts.now ?? new Date("2026-06-15T04:00:00Z");
  const traderIssued = opts.traderRefreshIssuedAt ?? new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
  const marketIssued = opts.marketRefreshIssuedAt ?? new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  return {
    trader: {
      status: "fresh",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      refreshIssuedAt: traderIssued,
    },
    market: {
      status: "fresh",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      refreshIssuedAt: marketIssued,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeRefreshTokensUseCase", () => {
  it("both apps succeed → result has ok: true for both apps", async () => {
    const { makeRefreshTokensUseCase } = await import("./refreshTokens.ts");
    const now = new Date("2026-06-15T04:00:00Z");

    const refreshTraderToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const refreshMarketToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok(makeFreshnessMap({ now }));

    const refreshTokens = makeRefreshTokensUseCase({
      refreshTraderToken,
      refreshMarketToken,
      readTokenFreshness,
      now: () => now,
    });

    const result = await refreshTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trader.ok).toBe(true);
    expect(result.value.market.ok).toBe(true);
  });

  it("trader refresh fails → market still runs; result reflects per-app outcome (D-13)", async () => {
    const { makeRefreshTokensUseCase } = await import("./refreshTokens.ts");
    const now = new Date("2026-06-15T04:00:00Z");

    const traderErr: AuthExpiredError = { kind: "auth-expired", appId: "trader" };
    const refreshTraderToken: ForRefreshingToken = async (_appId) => err(traderErr);
    const refreshMarketToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok(makeFreshnessMap({ now }));

    const refreshTokens = makeRefreshTokensUseCase({
      refreshTraderToken,
      refreshMarketToken,
      readTokenFreshness,
      now: () => now,
    });

    const result = await refreshTokens();
    expect(result.ok).toBe(true); // use-case always returns ok (errors in result.value)
    if (!result.ok) return;
    expect(result.value.trader.ok).toBe(false);
    expect(result.value.market.ok).toBe(true);
  });

  it("market refresh fails → trader still runs; result reflects per-app outcome (D-13)", async () => {
    const { makeRefreshTokensUseCase } = await import("./refreshTokens.ts");
    const now = new Date("2026-06-15T04:00:00Z");

    const marketErr: AuthExpiredError = { kind: "auth-expired", appId: "market" };
    const refreshTraderToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const refreshMarketToken: ForRefreshingToken = async (_appId) => err(marketErr);
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok(makeFreshnessMap({ now }));

    const refreshTokens = makeRefreshTokensUseCase({
      refreshTraderToken,
      refreshMarketToken,
      readTokenFreshness,
      now: () => now,
    });

    const result = await refreshTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trader.ok).toBe(true);
    expect(result.value.market.ok).toBe(false);
  });

  it("refreshIssuedAt ≥ 6 days ago → warnExpirySoon true for that app (D-14)", async () => {
    const { makeRefreshTokensUseCase } = await import("./refreshTokens.ts");
    const now = new Date("2026-06-15T04:00:00Z");
    // 6 days and 1 minute ago — within the 1-day warning window
    const nearExpiry = new Date(now.getTime() - (6 * 24 * 60 + 1) * 60 * 1000);

    const refreshTraderToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const refreshMarketToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok(makeFreshnessMap({ traderRefreshIssuedAt: nearExpiry, now }));

    const refreshTokens = makeRefreshTokensUseCase({
      refreshTraderToken,
      refreshMarketToken,
      readTokenFreshness,
      now: () => now,
    });

    const result = await refreshTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trader.warnExpirySoon).toBe(true);
  });

  it("refreshIssuedAt < 6 days ago → warnExpirySoon false", async () => {
    const { makeRefreshTokensUseCase } = await import("./refreshTokens.ts");
    const now = new Date("2026-06-15T04:00:00Z");
    // Only 1 day ago — well within the safe window
    const freshIssued = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const refreshTraderToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const refreshMarketToken: ForRefreshingToken = async (_appId) => ok(STUB_TOKENS);
    const readTokenFreshness: ForReadingTokenFreshness = async () =>
      ok(makeFreshnessMap({ traderRefreshIssuedAt: freshIssued, now }));

    const refreshTokens = makeRefreshTokensUseCase({
      refreshTraderToken,
      refreshMarketToken,
      readTokenFreshness,
      now: () => now,
    });

    const result = await refreshTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trader.warnExpirySoon).toBe(false);
  });
});
