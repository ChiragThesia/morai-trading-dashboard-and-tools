/**
 * enqueueJob use-case tests (TDD RED phase, Plan 05-04 Task 2)
 *
 * Behaviors tested:
 *   - makeEnqueueJobUseCase returns ForEnqueueingJob function
 *   - For scheduled job names: uses scheduledDedupeKey (window-based)
 *   - For "rebuild-journal": uses rebuildDedupeKey (calendar-scoped)
 *   - Repeated enqueue within same window → same jobId (no duplicate)
 *   - Delegates to injected jobQueue port
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeEnqueueJobUseCase } from "./enqueueJob.ts";
import type { ForEnqueueingJob, StorageError } from "./ports.ts";

// ─── In-core test double ──────────────────────────────────────────────────────
// Mirrors pg-boss singletonKey semantics: same dedupeKey → same jobId, no new entry.
// dedupeKey=null: every call creates a distinct entry (no dedup).
// Must NOT import from packages/adapters (architecture-boundaries.md §2).
// Must NOT import node:* builtins (eslint.config.js §core restriction).
// Uses a monotonic counter for unique job IDs — sufficient for test isolation.

type QueueEntry = {
  readonly jobId: string;
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey: string | null;
};

let _jobIdSeq = 0;
function nextJobId(): string {
  _jobIdSeq += 1;
  return `test-job-${_jobIdSeq}`;
}

function makeTestJobQueue(): {
  readonly enqueue: ForEnqueueingJob;
  readonly getAll: () => ReadonlyArray<QueueEntry>;
} {
  const dedupeStore = new Map<string, QueueEntry>();
  const unKeyed: QueueEntry[] = [];

  const enqueue: ForEnqueueingJob = async (
    name: string,
    payload: Readonly<Record<string, unknown>>,
    dedupeKey: string | null,
  ): Promise<Result<string | null, StorageError>> => {
    if (dedupeKey !== null) {
      const existing = dedupeStore.get(dedupeKey);
      if (existing !== undefined) return ok(existing.jobId);
      const jobId = nextJobId();
      dedupeStore.set(dedupeKey, { jobId, name, payload, dedupeKey });
      return ok(jobId);
    }
    const jobId = nextJobId();
    unKeyed.push({ jobId, name, payload, dedupeKey: null });
    return ok(jobId);
  };

  return {
    enqueue,
    getAll: () => [...dedupeStore.values(), ...unKeyed],
  };
}

// A fixed 10-min window boundary
const BASE_TIME = new Date("2026-06-21T14:10:00.000Z");

describe("makeEnqueueJobUseCase", () => {
  it("enqueues a scheduled job and returns ok(jobId)", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    const result = await enqueueJob("sync-fills", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value).toBe("string");
    }
  });

  it("repeated enqueue for a scheduled job in the same window returns same jobId", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    const first = await enqueueJob("sync-fills", {});
    // 5 minutes later, still in the same 10-min window
    const laterTime = new Date("2026-06-21T14:15:00.000Z");
    const enqueueJob2 = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => laterTime,
    });
    const second = await enqueueJob2("sync-fills", {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value).toBe(first.value); // same jobId — no duplicate
    }
  });

  it("rebuild-journal uses rebuildDedupeKey (calendar-scoped)", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    const calendarId = "550e8400-e29b-41d4-a716-446655440001";
    const result = await enqueueJob("rebuild-journal", { calendarId });
    expect(result.ok).toBe(true);
    // Same calendarId → same dedupeKey → no-op on re-enqueue
    const result2 = await enqueueJob("rebuild-journal", { calendarId });
    if (result.ok && result2.ok) {
      expect(result2.value).toBe(result.value);
    }
    expect(q.getAll().length).toBe(1); // only one entry
  });

  it("rebuild-journal with different calendarIds produces different entries", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    await enqueueJob("rebuild-journal", { calendarId: "cal-aaa" });
    await enqueueJob("rebuild-journal", { calendarId: "cal-bbb" });
    expect(q.getAll().length).toBe(2);
  });

  // JRNL-01 pnl-unit-mismatch fix: recompute-snapshot-pnl mirrors rebuild-journal's
  // calendar-scoped dedup — a window-based key would wrongly collapse two DIFFERENT
  // calendars triggered in the same 10-min window into one entry.
  it("recompute-snapshot-pnl uses recomputeSnapshotPnlDedupeKey (calendar-scoped)", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    const calendarId = "550e8400-e29b-41d4-a716-446655440002";
    const result = await enqueueJob("recompute-snapshot-pnl", { calendarId });
    expect(result.ok).toBe(true);
    // Same calendarId → same dedupeKey → no-op on re-enqueue
    const result2 = await enqueueJob("recompute-snapshot-pnl", { calendarId });
    if (result.ok && result2.ok) {
      expect(result2.value).toBe(result.value);
    }
    expect(q.getAll().length).toBe(1); // only one entry
  });

  it("recompute-snapshot-pnl with different calendarIds produces different entries", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    await enqueueJob("recompute-snapshot-pnl", { calendarId: "cal-aaa" });
    await enqueueJob("recompute-snapshot-pnl", { calendarId: "cal-bbb" });
    expect(q.getAll().length).toBe(2);
  });

  // journal-pnl-opennetdebit-units (round 3): wipe-derived-fills is account-wide (no
  // calendarId) — it falls into the default scheduledDedupeKey branch, which is itself a
  // valuable safety property here: it prevents a second accidental trigger of this
  // destructive account-wide delete within the same 10-min window.
  it("wipe-derived-fills uses scheduledDedupeKey (window-based, account-wide — no calendarId)", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    const result = await enqueueJob("wipe-derived-fills", {});
    expect(result.ok).toBe(true);
    // Same 10-min window → same dedupeKey → no duplicate trigger
    const result2 = await enqueueJob("wipe-derived-fills", {});
    if (result.ok && result2.ok) {
      expect(result2.value).toBe(result.value);
    }
    expect(q.getAll().length).toBe(1);
  });

  it("different scheduled job names produce different entries", async () => {
    const q = makeTestJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    await enqueueJob("sync-fills", {});
    await enqueueJob("refresh-tokens", {});
    expect(q.getAll().length).toBe(2);
  });

  it("propagates storage error from jobQueue port", async () => {
    const failingEnqueue = async () => ({
      ok: false as const,
      error: { kind: "storage-error" as const, message: "DB down" },
    });
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: failingEnqueue,
      now: () => BASE_TIME,
    });

    const result = await enqueueJob("sync-fills", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("storage-error");
    }
  });
});
