/**
 * refresh-tokens handler tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - No RTH gate: handler runs even outside market hours (04:00 ET design)
 *   - Both apps attempted even if trader fails (D-13 independence)
 *   - Handler does NOT throw on per-app failure (per-app errors → console.warn only)
 *   - pg-boss v12 guard: undefined job → no-op
 *   - warnExpirySoon → console.warn with expiry message
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-05 implements makeRefreshTokensHandler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok } from "@morai/shared";
import { makeRefreshTokensHandler } from "./refresh-tokens.ts";

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
});
