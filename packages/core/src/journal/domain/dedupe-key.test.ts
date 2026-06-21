/**
 * dedupe-key — unit tests (TDD RED phase, Plan 05-04 Task 1)
 *
 * Behaviors tested:
 *   - scheduledDedupeKey floors now to the window boundary → deterministic key
 *   - Two times within the same window → identical key
 *   - Adjacent windows → different keys
 *   - rebuildDedupeKey returns "rebuild-journal:{calendarId}"
 */

import { describe, it, expect } from "vitest";
import { scheduledDedupeKey, rebuildDedupeKey } from "./dedupe-key.ts";

describe("scheduledDedupeKey", () => {
  it("formats as '{jobName}:{windowStart.toISOString()}'", () => {
    const now = new Date("2026-06-21T14:12:00.000Z");
    const key = scheduledDedupeKey("sync-fills", now, 10);
    expect(key).toMatch(/^sync-fills:2026-06-21T14:/);
    expect(key.startsWith("sync-fills:")).toBe(true);
  });

  it("floors to the 10-min window boundary", () => {
    // 14:12 should floor to 14:10
    const now = new Date("2026-06-21T14:12:34.000Z");
    const key = scheduledDedupeKey("sync-fills", now, 10);
    // windowStart = floor(14:12:34 / 10min) * 10min = 14:10:00
    expect(key).toBe("sync-fills:2026-06-21T14:10:00.000Z");
  });

  it("same window → identical key", () => {
    const t1 = new Date("2026-06-21T14:10:00.000Z");
    const t2 = new Date("2026-06-21T14:19:59.999Z");
    expect(scheduledDedupeKey("sync-fills", t1, 10)).toBe(
      scheduledDedupeKey("sync-fills", t2, 10),
    );
  });

  it("adjacent windows → different keys", () => {
    const t1 = new Date("2026-06-21T14:09:59.999Z"); // window at 14:00
    const t2 = new Date("2026-06-21T14:10:00.000Z"); // window at 14:10
    expect(scheduledDedupeKey("sync-fills", t1, 10)).not.toBe(
      scheduledDedupeKey("sync-fills", t2, 10),
    );
  });

  it("uses the provided window size (30 min)", () => {
    const now = new Date("2026-06-21T14:35:00.000Z");
    const key = scheduledDedupeKey("fetch-schwab-chain", now, 30);
    // 14:35 → floor to 14:30
    expect(key).toBe("fetch-schwab-chain:2026-06-21T14:30:00.000Z");
  });

  it("window boundary exactly on the minute is part of that window", () => {
    const now = new Date("2026-06-21T14:10:00.000Z");
    const key = scheduledDedupeKey("sync-fills", now, 10);
    expect(key).toBe("sync-fills:2026-06-21T14:10:00.000Z");
  });
});

describe("rebuildDedupeKey", () => {
  it("formats as 'rebuild-journal:{calendarId}'", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(rebuildDedupeKey(id)).toBe(`rebuild-journal:${id}`);
  });

  it("different calendarIds produce different keys", () => {
    expect(rebuildDedupeKey("id-1")).not.toBe(rebuildDedupeKey("id-2"));
  });
});
