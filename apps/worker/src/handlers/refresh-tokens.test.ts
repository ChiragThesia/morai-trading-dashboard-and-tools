/**
 * refresh-tokens handler tests — 05-05 TDD suite.
 *
 * Covers:
 *   - No RTH gate: handler runs even outside market hours (04:00 ET design)
 *   - Both apps attempted even if trader fails (D-13 independence)
 *   - Handler does NOT throw on per-app failure (per-app errors → console.warn only)
 *   - pg-boss v12 guard: undefined job → no-op
 *   - warnExpirySoon → console.warn with expiry message
 *   - SC2 status surface: after trader-fail / market-ok, readTokenFreshness() returns
 *     trader.lastRefreshError non-null and market.lastRefreshError null (D-14, flag-only)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok } from "@morai/shared";
import { makeRefreshTokensHandler } from "./refresh-tokens.ts";
import { makeMemoryBrokerTokensRepo } from "@morai/adapters";

describe("makeRefreshTokensHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(): Job<object> {
    return {
      id: "test-refresh-job",
      name: "refresh-tokens",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("runs even outside RTH (04:00 ET is outside market hours by design — no RTH gate)", async () => {
    // 04:00 ET = 09:00 UTC — outside RTH (which starts 09:30 ET / 14:30 UTC on weekdays)
    const preMarket = new Date("2026-06-15T09:00:00Z"); // 05:00 ET
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({ trader: { ok: true, warnExpirySoon: false }, market: { ok: true, warnExpirySoon: false } }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      now: () => preMarket,
    });

    await handler([makeJob()]);
    // Must have called the use-case even though it's outside RTH
    expect(refreshTokensUseCase).toHaveBeenCalledOnce();
  });

  it("trader app failure → console.warn with appId; handler does NOT throw (D-13)", async () => {
    const normalTime = new Date("2026-06-15T09:00:00Z");
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({
        trader: { ok: false, error: "invalid_grant", warnExpirySoon: false },
        market: { ok: true, warnExpirySoon: false },
      }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      now: () => normalTime,
    });

    // Must not throw
    await expect(handler([makeJob()])).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("trader"));
  });

  it("market app failure → console.warn; handler does NOT throw (D-13)", async () => {
    const normalTime = new Date("2026-06-15T09:00:00Z");
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({
        trader: { ok: true, warnExpirySoon: false },
        market: { ok: false, error: "invalid_grant", warnExpirySoon: false },
      }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      now: () => normalTime,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("market"));
  });

  it("warnExpirySoon true → console.warn with expiry message (D-14)", async () => {
    const normalTime = new Date("2026-06-15T09:00:00Z");
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({
        trader: { ok: true, warnExpirySoon: true },
        market: { ok: true, warnExpirySoon: false },
      }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      now: () => normalTime,
    });

    await handler([makeJob()]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("expir"));
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({ trader: { ok: true, warnExpirySoon: false }, market: { ok: true, warnExpirySoon: false } }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      now: () => new Date(),
    });

    await handler([undefined]);
    expect(refreshTokensUseCase).not.toHaveBeenCalled();
  });

  // SC2 status surface: the getStatus path exposes per-app refresh failure (D-14).
  // After a trader-fail / market-ok run, readTokenFreshness() must return:
  //   trader.lastRefreshError = non-null string
  //   market.lastRefreshError = null
  // This is the end-to-end assertion through the read model.
  it("SC2: trader-fail / market-ok → readTokenFreshness returns trader.lastRefreshError non-null, market null", async () => {
    const now = new Date("2026-06-15T04:00:00Z");
    const repo = makeMemoryBrokerTokensRepo(() => now);

    // refreshTokensUseCase returns trader failure, market success
    const refreshTokensUseCase = vi.fn().mockResolvedValue(
      ok({
        trader: { ok: false, error: "trader: auth-expired", warnExpirySoon: false },
        market: { ok: true, warnExpirySoon: false },
      }),
    );

    const handler = makeRefreshTokensHandler({
      refreshTokensUseCase,
      recordRefreshOutcome: repo.recordRefreshOutcome,
      now: () => now,
    });

    await handler([makeJob()]);

    // After the handler runs, read the freshness map (same path getStatus uses)
    const freshnessResult = await repo.readTokenFreshness();
    expect(freshnessResult.ok).toBe(true);
    if (!freshnessResult.ok) return;
    // "none yet" is not expected since recordRefreshOutcome has been called
    expect(freshnessResult.value).not.toBe("none yet");
    if (freshnessResult.value === "none yet") return;
    expect(freshnessResult.value.trader.lastRefreshError).not.toBeNull();
    expect(freshnessResult.value.market.lastRefreshError).toBeNull();
  });
});
