/**
 * makePgBossJobQueue — pg-boss adapter implementing ForEnqueueingJob (JOB-01, Plan 05-04).
 *
 * Wraps boss.send() with singletonKey for deterministic deduplication.
 * CRITICAL (RESEARCH Pitfall 1): ALWAYS use singletonKey for deduplication.
 *   singletonKey deduplicates by explicit business key (deterministic, our strategy).
 *   Never use the time-window-based alternative — it causes races at window boundaries.
 *
 * Returns ok(jobId) on success; ok(null) when pg-boss returns null (key already active, no-op).
 *
 * Architecture: this file is the ONLY place in the codebase that calls boss.send().
 * Composition root (main.ts) wires this adapter to the enqueueJob use-case.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForEnqueueingJob, StorageError } from "@morai/core";
import type { PgBoss } from "pg-boss";

export type PgBossJobQueue = {
  readonly enqueue: ForEnqueueingJob;
};

/**
 * makePgBossJobQueue — factory that returns a ForEnqueueingJob implementation.
 *
 * @param boss - active PgBoss instance (must have been boss.start()-ed)
 */
export function makePgBossJobQueue(boss: PgBoss): PgBossJobQueue {
  const enqueue: ForEnqueueingJob = async (
    name: string,
    payload: Readonly<Record<string, unknown>>,
    dedupeKey: string | null,
  ): Promise<Result<string | null, StorageError>> => {
    try {
      const sendOptions =
        dedupeKey !== null
          ? { singletonKey: dedupeKey } // RESEARCH Pitfall 1: always singletonKey
          : {};

      const jobId = await boss.send(name, payload, sendOptions);
      return ok(jobId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { enqueue };
}
