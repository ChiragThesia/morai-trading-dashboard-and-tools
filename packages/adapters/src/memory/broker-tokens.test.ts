import { describe, it, expect } from "vitest";
import { makeMemoryBrokerTokensRepo } from "./broker-tokens.ts";
import type { SchwabTokenRow } from "@morai/core";

/**
 * Tests for the in-memory broker-tokens twin (review WR-04,
 * architecture-boundaries §8). No Docker, no network — runs always.
 *
 * WR-04 regression: recordRefreshOutcome(appId, null) stores an explicit null
 * meaning "last refresh succeeded — clear the flag". A `??`-based merge treats
 * that stored null as absent and falls back to the row's stale lastRefreshError,
 * diverging from the Postgres repo (which persists the NULL). The merge must be
 * `has()`-based so an explicit null wins over the row value.
 */

const now = new Date("2026-07-02T14:00:00Z");

function traderRow(lastRefreshError: string | null): SchwabTokenRow {
  return {
    appId: "trader",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    issuedAt: new Date("2026-07-02T13:50:00Z"),
    refreshIssuedAt: new Date("2026-07-01T14:00:00Z"),
    expiresAt: new Date("2026-07-02T14:20:00Z"),
    lastRefreshError,
  };
}

describe("makeMemoryBrokerTokensRepo — recordRefreshOutcome null-clear (WR-04)", () => {
  it("clears a seeded lastRefreshError in readTokens after a successful refresh outcome", async () => {
    const repo = makeMemoryBrokerTokensRepo(() => now);
    await repo.seed("trader", traderRow("refresh failed: boom"));

    const recorded = await repo.recordRefreshOutcome("trader", null);
    expect(recorded.ok).toBe(true);

    const result = await repo.readTokens("trader");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    if (result.value === null) return;
    expect(result.value.lastRefreshError).toBeNull();
  });

  it("clears a seeded lastRefreshError in readTokenFreshness after a successful refresh outcome", async () => {
    const repo = makeMemoryBrokerTokensRepo(() => now);
    await repo.seed("trader", traderRow("refresh failed: boom"));

    const recorded = await repo.recordRefreshOutcome("trader", null);
    expect(recorded.ok).toBe(true);

    const result = await repo.readTokenFreshness();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe("none yet");
    if (result.value === "none yet") return;
    expect(result.value.trader.lastRefreshError).toBeNull();
  });

  it("surfaces a recorded non-null error over the row value (flag ownership baseline)", async () => {
    const repo = makeMemoryBrokerTokensRepo(() => now);
    await repo.seed("trader", traderRow(null));

    const recorded = await repo.recordRefreshOutcome("trader", "invalid_grant");
    expect(recorded.ok).toBe(true);

    const result = await repo.readTokenFreshness();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe("none yet");
    if (result.value === "none yet") return;
    expect(result.value.trader.lastRefreshError).toBe("invalid_grant");
  });
});
