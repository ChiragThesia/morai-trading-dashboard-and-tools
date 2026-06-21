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
import { makeEnqueueJobUseCase } from "./enqueueJob.ts";
import { makeMemoryJobQueue } from "../../../../adapters/src/memory/job-queue.ts";

// A fixed 10-min window boundary
const BASE_TIME = new Date("2026-06-21T14:10:00.000Z");

describe("makeEnqueueJobUseCase", () => {
  it("enqueues a scheduled job and returns ok(jobId)", async () => {
    const q = makeMemoryJobQueue();
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
    const q = makeMemoryJobQueue();
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
    const q = makeMemoryJobQueue();
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
    const q = makeMemoryJobQueue();
    const enqueueJob = makeEnqueueJobUseCase({
      jobQueue: q.enqueue,
      now: () => BASE_TIME,
    });

    await enqueueJob("rebuild-journal", { calendarId: "cal-aaa" });
    await enqueueJob("rebuild-journal", { calendarId: "cal-bbb" });
    expect(q.getAll().length).toBe(2);
  });

  it("different scheduled job names produce different entries", async () => {
    const q = makeMemoryJobQueue();
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
