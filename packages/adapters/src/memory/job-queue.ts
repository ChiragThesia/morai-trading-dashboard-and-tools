/**
 * makeMemoryJobQueue — in-memory twin of the pg-boss JobQueue adapter (JOB-01, Plan 05-04).
 *
 * Implements ForEnqueueingJob using a plain Map keyed by dedupeKey.
 * A second enqueue with the SAME non-null dedupeKey is a no-op — mirrors pg-boss
 * singletonKey semantics (RESEARCH Pitfall 1: always singletonKey, never singletonSeconds).
 *
 * dedupeKey=null: every enqueue creates a new entry (no dedup), matching pg-boss
 * behavior when no singletonKey is provided.
 *
 * Architecture law: every driven port ships an in-memory twin (architecture-boundaries.md §8).
 * No I/O, no Docker required — always available for unit tests.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForEnqueueingJob, StorageError } from "@morai/core";
import { randomUUID } from "node:crypto";

export type MemoryJobQueueEntry = {
  readonly jobId: string;
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey: string | null;
};

export type MemoryJobQueue = {
  readonly enqueue: ForEnqueueingJob;
  /** Test helper — returns all entries for assertion */
  readonly getAll: () => ReadonlyArray<MemoryJobQueueEntry>;
};

export function makeMemoryJobQueue(): MemoryJobQueue {
  // keyed by dedupeKey (string) for dedup lookup
  const dedupeStore = new Map<string, MemoryJobQueueEntry>();
  // for null-key entries (each is distinct)
  const unKeyedEntries: MemoryJobQueueEntry[] = [];

  const enqueue: ForEnqueueingJob = async (
    name: string,
    payload: Readonly<Record<string, unknown>>,
    dedupeKey: string | null,
  ): Promise<Result<string | null, StorageError>> => {
    if (dedupeKey !== null) {
      // WR-05: dedup hit → ok(null), mirroring pg-boss singletonKey collisions
      // (the real adapter returns ok(null) when the key is already active).
      const existing = dedupeStore.get(dedupeKey);
      if (existing !== undefined) {
        return ok(null);
      }
      const jobId = randomUUID();
      dedupeStore.set(dedupeKey, { jobId, name, payload, dedupeKey });
      return ok(jobId);
    }

    // null dedupeKey — no dedup, always a new entry
    const jobId = randomUUID();
    unKeyedEntries.push({ jobId, name, payload, dedupeKey: null });
    return ok(jobId);
  };

  const getAll = (): ReadonlyArray<MemoryJobQueueEntry> => {
    return [...dedupeStore.values(), ...unKeyedEntries];
  };

  return { enqueue, getAll };
}
