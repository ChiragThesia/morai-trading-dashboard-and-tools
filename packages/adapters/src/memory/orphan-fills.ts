/**
 * makeMemoryOrphanFillsRepo — in-memory twin of the Postgres orphan-fills adapter.
 *
 * Implements ForStoringOrphanFill using a plain Map — no Docker, no network.
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * Idempotency: Map keyed on fillId (PK equivalent) — same fillId = no-op.
 *
 * getAllOrphans + countOrphans: test helpers for contract verification.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringOrphanFill,
  OrphanFillInput,
  StorageError,
} from "@morai/core";

export type MemoryOrphanFill = {
  readonly fillId: string;
  readonly occSymbol: string;
  readonly side: "buy" | "sell";
  readonly qty: number;
  readonly price: number;
  readonly filledAt: Date;
  readonly reason: string;
};

export type MemoryOrphanFillsRepo = {
  readonly storeOrphanFill: ForStoringOrphanFill;
  /** countOrphans — test helper: count total orphan rows */
  readonly countOrphans: () => Promise<number>;
  /** getAllOrphans — test helper: return all orphan rows */
  readonly getAllOrphans: () => Promise<ReadonlyArray<MemoryOrphanFill>>;
};

export function makeMemoryOrphanFillsRepo(): MemoryOrphanFillsRepo {
  // Key: fillId (PK equivalent — idempotency on fillId)
  const store = new Map<string, MemoryOrphanFill>();

  const storeOrphanFill: ForStoringOrphanFill = async (
    orphan: OrphanFillInput,
  ): Promise<Result<void, StorageError>> => {
    if (!store.has(orphan.fillId)) {
      store.set(orphan.fillId, {
        fillId: orphan.fillId,
        occSymbol: orphan.occSymbol,
        side: orphan.side,
        qty: orphan.qty,
        price: orphan.price,
        filledAt: orphan.filledAt,
        reason: orphan.reason,
      });
    }
    return ok(undefined);
  };

  const countOrphans = async (): Promise<number> => store.size;

  const getAllOrphans = async (): Promise<ReadonlyArray<MemoryOrphanFill>> =>
    [...store.values()];

  return { storeOrphanFill, countOrphans, getAllOrphans };
}
