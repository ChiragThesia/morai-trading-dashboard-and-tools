/**
 * getPositions.test.ts — BRK-02 use-case tests for getPositions, getTransactions, getOrders.
 *
 * Uses the in-memory twin (not the real adapter). Tests:
 *   - ok(data) passthrough from adapter
 *   - err(auth-expired) passthrough (D-09: trader expired pauses reads)
 *   - err(fetch-error) passthrough
 */
import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import { makeGetPositionsUseCase } from "./getPositions.ts";
import type { ForFetchingPositions, ForResolvingAccountHash, BrokerPosition } from "./ports.ts";

// ─── Test doubles ─────────────────────────────────────────────────────────────

const ACCOUNT_HASH = "HASH_ABC123";

function makePosition(): BrokerPosition {
  return {
    occSymbol: formatOccSymbol({
      root: "SPX",
      expiry: new Date(2026, 5, 20), // June 20, 2026
      type: "P",
      strike: 5950,
    }),
    putCall: "P",
    longQty: 0,
    shortQty: 1,
    averagePrice: 12.5,
    marketValue: -1250.0,
    underlyingSymbol: "SPX",
  };
}

function freshHashResolver(): ForResolvingAccountHash {
  return async () => ok(ACCOUNT_HASH);
}

function expiredHashResolver(): ForResolvingAccountHash {
  return async () => err({ kind: "auth-expired" as const, appId: "trader" as const });
}

function freshFetchPositions(positions: ReadonlyArray<BrokerPosition>): ForFetchingPositions {
  return async (_hash) => ok(positions);
}

function errorFetchPositions(): ForFetchingPositions {
  return async (_hash) => err({ kind: "fetch-error", message: "network error" });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeGetPositionsUseCase", () => {
  it("resolves account hash and returns ok(positions) from fetchPositions", async () => {
    const position = makePosition();
    const getPositions = makeGetPositionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchPositions: freshFetchPositions([position]),
    });
    const result = await getPositions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    const pos = result.value[0];
    expect(pos).toBeDefined();
    if (!pos) return;
    expect(pos.putCall).toBe("P");
    expect(pos.shortQty).toBe(1);
  });

  it("returns ok([]) when fetchPositions returns empty array", async () => {
    const getPositions = makeGetPositionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchPositions: freshFetchPositions([]),
    });
    const result = await getPositions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("returns err(auth-expired) when resolveAccountHash fails with auth-expired (D-09)", async () => {
    const getPositions = makeGetPositionsUseCase({
      resolveAccountHash: expiredHashResolver(),
      fetchPositions: freshFetchPositions([]),
    });
    const result = await getPositions();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth-expired");
  });

  it("returns err(fetch-error) when fetchPositions fails", async () => {
    const getPositions = makeGetPositionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchPositions: errorFetchPositions(),
    });
    const result = await getPositions();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });
});
