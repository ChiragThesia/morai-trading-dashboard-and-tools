/**
 * makeMemoryPositionReconciler — in-memory twin of the sidecar positions reconciler.
 *
 * Implements ForReconcilingPositions using a plain seeded array — no Docker, no network.
 * Always available for unit tests and local development.
 *
 * Architecture law: every driven port change updates the in-memory adapter in the same PR
 * (architecture-boundaries.md §8).
 *
 * Semantics: resolves the seeded ReadonlyArray<ReconciledPosition> on every call.
 * Idempotent — returns the same seed every time (mirrors the sidecar's stable positions
 * endpoint behavior within a single test run).
 *
 * Shape parity: ReconciledPosition fields match streamReconcileEvent positions items
 * (occSymbol, longQty, shortQty, underlyingSymbol, marketValue nullable).
 * Enforced by position-reconciler.contract.test.ts.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReconcilingPositions,
  ReconciledPosition,
  StreamReconcileError,
} from "@morai/core";

export type MemoryPositionReconciler = ForReconcilingPositions;

/**
 * Create an in-memory position reconciler seeded with the given positions.
 *
 * @param seed - Initial positions to return on every reconcile call
 * @returns A ForReconcilingPositions implementation that resolves with the seed
 */
export function makeMemoryPositionReconciler(
  seed: ReadonlyArray<ReconciledPosition>,
): MemoryPositionReconciler {
  const frozenArr: ReadonlyArray<ReconciledPosition> = Object.freeze([...seed]);

  const reconcile: ForReconcilingPositions = (): Promise<
    Result<ReadonlyArray<ReconciledPosition>, StreamReconcileError>
  > => {
    return Promise.resolve(ok(frozenArr));
  };

  return reconcile;
}
