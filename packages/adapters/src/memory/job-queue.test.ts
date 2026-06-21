/**
 * makeMemoryJobQueue — unit tests (TDD RED phase, Plan 05-04 Task 1)
 *
 * Behaviors tested:
 *   - enqueue returns ok(jobId) on first enqueue
 *   - second enqueue with SAME dedupeKey is a no-op (returns existing jobId, no duplicate)
 *   - different dedupeKey → new entry
 *   - getAll() length unchanged on re-enqueue with same key
 */

import { describe, it, expect } from "vitest";
import { makeMemoryJobQueue } from "./job-queue.ts";

describe("makeMemoryJobQueue", () => {
  it("enqueue returns ok(jobId) on first enqueue", async () => {
    const q = makeMemoryJobQueue();
    const result = await q.enqueue("sync-fills", {}, "sync-fills:2026-06-21T14:10:00.000Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value).toBe("string");
      expect(result.value).not.toBeNull();
    }
  });

  it("second enqueue with SAME dedupeKey is a no-op (returns existing jobId)", async () => {
    const q = makeMemoryJobQueue();
    const key = "sync-fills:2026-06-21T14:10:00.000Z";
    const first = await q.enqueue("sync-fills", {}, key);
    const second = await q.enqueue("sync-fills", {}, key);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      // Same jobId returned — no duplicate
      expect(second.value).toBe(first.value);
    }
  });

  it("getAll() length unchanged on re-enqueue with same dedupeKey", async () => {
    const q = makeMemoryJobQueue();
    const key = "rebuild-journal:abc-123";
    await q.enqueue("rebuild-journal", { calendarId: "abc-123" }, key);
    const beforeCount = q.getAll().length;
    await q.enqueue("rebuild-journal", { calendarId: "abc-123" }, key);
    expect(q.getAll().length).toBe(beforeCount);
  });

  it("different dedupeKeys produce separate entries", async () => {
    const q = makeMemoryJobQueue();
    await q.enqueue("sync-fills", {}, "sync-fills:2026-06-21T14:10:00.000Z");
    await q.enqueue("sync-fills", {}, "sync-fills:2026-06-21T14:20:00.000Z");
    expect(q.getAll().length).toBe(2);
  });

  it("dedupeKey=null enqueues a new entry each time (no dedup)", async () => {
    const q = makeMemoryJobQueue();
    await q.enqueue("rebuild-journal", {}, null);
    await q.enqueue("rebuild-journal", {}, null);
    // Each null-key enqueue is treated as distinct
    expect(q.getAll().length).toBe(2);
  });
});
