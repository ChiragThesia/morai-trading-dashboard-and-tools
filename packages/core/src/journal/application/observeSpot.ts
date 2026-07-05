/**
 * observeSpot use-case — SNAP-01 event-move orchestration (D-04/D-05/D-06, Pattern 2).
 *
 * Extracted from apps/server/src/main.ts (previously an untested composition-root blob —
 * REVIEW WR-04) so the observe → detect → cooldown → enqueue pipeline is a testable unit.
 *
 * Pipeline per valid SPX tick:
 *   1. Parse the sidecar timestamp. An unparseable/Invalid-Date `tsIso` is rejected FIRST
 *      (REVIEW CR-01): isWithinRth/isNyseHoliday call Intl.DateTimeFormat.formatToParts,
 *      which throws RangeError on an Invalid Date. That throw previously propagated into the
 *      synchronous sidecar tick loop and permanently killed the live stream. Here `observe`
 *      is async AND guards the bad timestamp before the RTH gate, so it can never throw into
 *      the caller — a single malformed tick is skipped, the stream survives.
 *   2. RTH + holiday gate (D-15) — no detection off-hours.
 *   3. Rolling-window % move detector (detectLargeMove) — mutable window state kept in the
 *      closure across ticks.
 *   4. Cross-process cooldown (Pitfall 2): the DB MAX(time) read is ground truth because the
 *      worker's 30-min cron writes rows in a different OS process.
 *   5. Fire the supplemental snapshot enqueue at most once per cooldown window.
 *
 * `observe` NEVER throws and NEVER rejects — every failure path is swallowed (logged via the
 * optional onWarn hook) so the sidecar tick loop that calls it stays alive.
 *
 * Pure-ish application layer: imports only @morai/shared + core domain/ports. Side effects
 * (DB read, enqueue) are injected ports.
 */

import { detectLargeMove, MOVE_WINDOW_MS, MOVE_THRESHOLD_PCT } from "../../streaming/index.ts";
import type { SpotSample } from "../../streaming/index.ts";
import { isWithinRth } from "../domain/rth-window.ts";
import { isNyseHoliday } from "../domain/nyse-holidays.ts";
import { isWithinCooldown, SNAPSHOT_COOLDOWN_MS } from "../domain/snapshot-cooldown.ts";
import type { ForReadingLatestSnapshotTime } from "./ports.ts";

export type SpotObserverDeps = {
  /** Ground-truth cooldown read — MAX(time) across calendar_snapshots (Pitfall 2). */
  readonly readLatestSnapshotTime: ForReadingLatestSnapshotTime;
  /**
   * Fire-and-forget enqueue of the supplemental snapshot-calendars job with
   * trigger:'event-move'. Resolves once the job is accepted; rejection is caught by
   * `observe` and reported via onWarn.
   */
  readonly enqueueEventMoveSnapshot: () => Promise<void>;
  /** Optional observability hook for the skipped/failed branches (name-only, no PII). */
  readonly onWarn?: (message: string, detail?: unknown) => void;
};

/**
 * ForObservingSpot — the driver surface the sidecar SSE consumer wires to observeSpot.
 * `observe` is intentionally async and total (never throws/rejects) so it is safe to call
 * from a synchronous per-tick dispatch loop.
 */
export type ForObservingSpot = {
  readonly observe: (spot: number, tsIso: string) => Promise<void>;
};

export function makeSpotObserver(deps: SpotObserverDeps): ForObservingSpot {
  // Rolling detection window — mutated across ticks, private to this closure.
  let moveWindow: ReadonlyArray<SpotSample> = [];

  const warn = (message: string, detail?: unknown): void => {
    if (deps.onWarn !== undefined) deps.onWarn(message, detail);
  };

  async function observe(spot: number, tsIso: string): Promise<void> {
    try {
      // 1. Reject an unparseable timestamp BEFORE the RTH gate (CR-01) — the gate's
      //    Intl.DateTimeFormat throws RangeError on an Invalid Date.
      const ms = Date.parse(tsIso);
      if (Number.isNaN(ms)) return;
      const now = new Date(ms);

      // 2. RTH + holiday gate (D-15) — same gate as the worker's scheduled job.
      if (!isWithinRth(now) || isNyseHoliday(now)) return;

      // 3. Rolling-window move detector.
      const { triggered, nextWindow } = detectLargeMove(
        moveWindow,
        { ts: ms, price: spot },
        MOVE_WINDOW_MS,
        MOVE_THRESHOLD_PCT,
      );
      moveWindow = nextWindow;
      if (!triggered) return;

      // 4. Cross-process cooldown ground truth (Pitfall 2).
      const result = await deps.readLatestSnapshotTime();
      if (!result.ok) {
        // Fail-safe: a DB read error skips firing rather than risk a duplicate snapshot.
        warn("event-move: cooldown read failed, skipping", result.error);
        return;
      }
      if (isWithinCooldown(now, result.value, SNAPSHOT_COOLDOWN_MS)) return;

      // 5. Fire the supplemental snapshot.
      await deps.enqueueEventMoveSnapshot();
    } catch (e: unknown) {
      // Total contract: never throw into the caller's tick loop (CR-01).
      warn("event-move: observe threw, skipping", e);
    }
  }

  return { observe };
}
