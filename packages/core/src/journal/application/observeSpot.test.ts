/**
 * observeSpot.test.ts — SNAP-01 event-move orchestration (REVIEW CR-01 / WR-04).
 *
 * Covers the observe → detect → cooldown → enqueue pipeline that previously lived
 * untested in apps/server/src/main.ts. The headline regression is CR-01: an
 * unparseable sidecar timestamp must be skipped WITHOUT throwing (the RTH gate's
 * Intl.DateTimeFormat throws RangeError on an Invalid Date, which used to sever the
 * synchronous sidecar tick loop and permanently kill the live stream).
 */
import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { StorageError } from "./ports.ts";
import { makeSpotObserver } from "./observeSpot.ts";

// Monday 2026-07-06 — a normal RTH trading day. 15:00 UTC = 11:00 ET (open).
const RTH_T1 = "2026-07-06T15:00:00.000Z";
const RTH_T2 = "2026-07-06T15:01:00.000Z"; // 1 min later, still RTH
// Pre-open weekday clock: 08:00 UTC = 04:00 ET (before the 09:30 open).
const OFF_HOURS = "2026-07-06T08:00:00.000Z";
// New Year's Day 2026 during RTH hours (15:00 UTC = 10:00 ET) — NYSE closed (holiday).
const HOLIDAY = "2026-01-01T15:00:00.000Z";

// A ~1.17% up-move (6000 → 6070) clears the 1% MOVE_THRESHOLD_PCT.
const PRICE_BASE = 6000;
const PRICE_MOVED = 6070;

type EnqueueSpy = {
  readonly enqueue: () => Promise<void>;
  readonly count: () => number;
};

function makeEnqueueSpy(): EnqueueSpy {
  let calls = 0;
  return {
    enqueue: async () => {
      calls += 1;
    },
    count: () => calls,
  };
}

const okNoSnapshot = async (): Promise<Result<Date | null, StorageError>> => ok(null);

describe("makeSpotObserver.observe", () => {
  it("skips an unparseable timestamp without throwing and never reads/enqueues (CR-01)", async () => {
    let readCalled = false;
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: async () => {
        readCalled = true;
        return ok(null);
      },
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    // Must resolve (not reject) and must not throw synchronously.
    await expect(observer.observe(PRICE_BASE, "not-a-real-timestamp")).resolves.toBeUndefined();
    expect(readCalled).toBe(false);
    expect(enqueue.count()).toBe(0);
  });

  it("skips off-hours ticks (RTH gate)", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: okNoSnapshot,
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, OFF_HOURS);
    await observer.observe(PRICE_MOVED, OFF_HOURS);
    expect(enqueue.count()).toBe(0);
  });

  it("skips a holiday tick even during RTH hours", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: okNoSnapshot,
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, HOLIDAY);
    await observer.observe(PRICE_MOVED, HOLIDAY);
    expect(enqueue.count()).toBe(0);
  });

  it("does not enqueue on a sub-threshold move", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: okNoSnapshot,
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, RTH_T1);
    await observer.observe(PRICE_BASE + 5, RTH_T2); // ~0.08% — below 1%
    expect(enqueue.count()).toBe(0);
  });

  it("enqueues once on a large move when outside cooldown", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: okNoSnapshot, // no prior snapshot → never in cooldown
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, RTH_T1); // cold-start window seed — no trigger
    await observer.observe(PRICE_MOVED, RTH_T2); // >1% move → trigger → enqueue
    expect(enqueue.count()).toBe(1);
  });

  it("suppresses the enqueue while within the cooldown window", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      // Last snapshot 6 min before T2 — inside the 15-min cooldown.
      readLatestSnapshotTime: async () => ok(new Date("2026-07-06T14:55:00.000Z")),
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, RTH_T1);
    await observer.observe(PRICE_MOVED, RTH_T2);
    expect(enqueue.count()).toBe(0);
  });

  it("skips the enqueue (fail-safe) when the cooldown read errors", async () => {
    const enqueue = makeEnqueueSpy();
    const observer = makeSpotObserver({
      readLatestSnapshotTime: async () =>
        err({ kind: "storage-error" as const, message: "boom" }),
      enqueueEventMoveSnapshot: enqueue.enqueue,
    });

    await observer.observe(PRICE_BASE, RTH_T1);
    await observer.observe(PRICE_MOVED, RTH_T2);
    expect(enqueue.count()).toBe(0);
  });

  it("does not reject even when the enqueue port itself throws", async () => {
    const observer = makeSpotObserver({
      readLatestSnapshotTime: okNoSnapshot,
      enqueueEventMoveSnapshot: async () => {
        throw new Error("enqueue exploded");
      },
    });

    await observer.observe(PRICE_BASE, RTH_T1);
    await expect(observer.observe(PRICE_MOVED, RTH_T2)).resolves.toBeUndefined();
  });
});
