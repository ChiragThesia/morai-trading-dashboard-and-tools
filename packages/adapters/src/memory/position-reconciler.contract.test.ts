/**
 * In-memory position reconciler contract test
 *
 * RED phase: Fails until makeMemoryPositionReconciler is implemented.
 *
 * Verifies:
 *   - makeMemoryPositionReconciler(seed) implements ForReconcilingPositions
 *   - Returns ok(ReadonlyArray<ReconciledPosition>) with the seeded positions
 *   - Shape parity: ReconciledPosition fields match streamReconcileEvent positions fields
 *     (occSymbol, longQty, shortQty, underlyingSymbol, marketValue nullable)
 */

import { describe, it, expect } from "vitest";
import { makeMemoryPositionReconciler } from "./position-reconciler.ts";
import type { ReconciledPosition } from "@morai/core";
import { streamReconcileEvent } from "@morai/contracts";

describe("makeMemoryPositionReconciler", () => {
  const seedPositions: ReadonlyArray<ReconciledPosition> = [
    {
      occSymbol: "SPX   260620C05000000",
      longQty: 1,
      shortQty: 0,
      underlyingSymbol: "SPX",
      marketValue: 1250.0,
    },
    {
      occSymbol: "SPX   260620C05100000",
      longQty: 0,
      shortQty: 1,
      underlyingSymbol: "SPX",
      marketValue: null,
    },
  ];

  it("resolves with the seeded positions", async () => {
    const reconcile = makeMemoryPositionReconciler(seedPositions);
    const result = await reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual(seedPositions[0]);
    expect(result.value[1]).toEqual(seedPositions[1]);
  });

  it("resolves with an empty array when no seed is provided", async () => {
    const reconcile = makeMemoryPositionReconciler([]);
    const result = await reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("shape parity: ReconciledPosition parses as streamReconcileEvent positions item", () => {
    // This asserts the structural contract between the domain type and the SSE payload schema.
    // If this fails, the domain type and the Zod contract have drifted.
    const reconcilePayload = {
      positions: seedPositions,
      asOf: "2026-06-28T14:30:00.000Z",
    };
    const parsed = streamReconcileEvent.safeParse(reconcilePayload);
    expect(parsed.success).toBe(true);
  });

  it("nullable marketValue in ReconciledPosition passes streamReconcileEvent parse", () => {
    const nullMarketValue: ReconciledPosition = {
      occSymbol: "SPX   260620P05000000",
      longQty: 0,
      shortQty: 2,
      underlyingSymbol: "SPX",
      marketValue: null,
    };
    const parsed = streamReconcileEvent.safeParse({
      positions: [nullMarketValue],
      asOf: "2026-06-28T14:30:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("returns a fresh result on each call (idempotent)", async () => {
    const reconcile = makeMemoryPositionReconciler(seedPositions);
    const r1 = await reconcile();
    const r2 = await reconcile();
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value).toEqual(r2.value);
  });
});
