/**
 * rebuildCalendarHistory use-case (HIST-02) — derives calendar_snapshots rows for a calendar
 * from historical leg_observations, reusing the EXACT pure functions the live snapshot writer
 * uses (computeLegPairMetrics + computeSnapshotPnl, D-02 — no formula drift) and the fill-only
 * heal-write + as-of-slot read ports from plan 04.
 *
 * D-04 honest-gap law: a slot where either leg has no usable observation produces NOTHING —
 * never an interpolated/fabricated row. D-08 write-window guarantee: enumeration clamps to
 * [max(openedAt, from), min(closedAt ?? now, to)], so a rebuild can never write outside a
 * calendar's real life window regardless of the requested window.
 *
 * This is the single derivation engine the self-heal job (plan 06) and the operator repair
 * (plan 07) both call, parametrized by `window` (bounded 7-day for self-heal, unbounded for
 * the CLI) — one row-derivation path shared with the live writer (RESEARCH Open Question 2).
 *
 * Pure clock injection (now passed via deps); no Date.now(). Result-threaded, no try/catch.
 */

import { ok, err, isWithinRth } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  Calendar,
  StorageError,
  ForResolvingLegObservationForSlot,
  ForHealingSnapshot,
} from "./ports.ts";
import { roundDownToRthSlot } from "../domain/rth-slot.ts";

const SLOT_MS = 30 * 60 * 1000;

/** Requested repair window — inclusive, clamped internally to the calendar's real life window. */
export type RebuildWindow = {
  readonly from: Date;
  readonly to: Date;
};

/** Per-calendar before/after coverage report for the operator (HIST-02). */
export type RebuildCoverage = {
  readonly slotsConsidered: number;
  readonly rowsHealed: number;
  readonly honestGapSlots: number;
};

export type RebuildCalendarHistoryDeps = {
  readonly resolveLegObservationForSlot: ForResolvingLegObservationForSlot;
  readonly healSnapshot: ForHealingSnapshot;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2) */
  readonly now: () => Date;
};

export type ForRunningRebuildCalendarHistory = (
  calendar: Calendar,
  window: RebuildWindow,
) => Promise<Result<RebuildCoverage, StorageError>>;

/**
 * enumerateRebuildSlots — pure D-08 write-window enumerator. Exported for its own unit test
 * only (not part of the package's public @morai/core surface).
 *
 * Enumerates the 30-min RTH slot anchors in [max(calendar.openedAt, window.from) ..
 * min(calendar.closedAt ?? now, window.to)], ascending, no duplicates. Structurally guarantees
 * no anchor ever escapes the calendar's real life window, for any requested window.
 */
export function enumerateRebuildSlots(
  calendar: Calendar,
  window: RebuildWindow,
  now: Date,
): readonly Date[] {
  const start = new Date(Math.max(calendar.openedAt.getTime(), window.from.getTime()));
  const end = new Date(Math.min((calendar.closedAt ?? now).getTime(), window.to.getTime()));
  if (start.getTime() > end.getTime()) return [];

  const anchors: Date[] = [];
  let cursor = roundDownToRthSlot(start);
  if (cursor.getTime() < start.getTime()) {
    cursor = new Date(cursor.getTime() + SLOT_MS);
  }
  while (cursor.getTime() <= end.getTime()) {
    if (isWithinRth(cursor)) {
      anchors.push(cursor);
    }
    cursor = new Date(cursor.getTime() + SLOT_MS);
  }
  return anchors;
}
