/**
 * chunkDateRange.ts — pure date-window chunker for the historical trade-history backfill (BRK-04).
 *
 * Splits an inclusive [from, to] date range into contiguous windows, each no longer than
 * `maxDays` days. The backfill CLI runs the sync-transactions use-case once per window so a
 * range spanning many days is pulled in cap-sized chunks (Schwab caps transactions lookback).
 *
 * Guarantees (proven by chunkDateRange.property.test.ts):
 *   - No gaps: the union of all windows is exactly the inclusive [from, to] day set.
 *   - No overlap: windows are pairwise disjoint — each window's `from` is the previous
 *     window's `to` + 1 day. The last window may be shorter than maxDays.
 *   - Cap per window: every window spans ≤ maxDays days inclusive.
 *
 * Architecture (architecture-boundaries.md §2): PURE core — imports ONLY @morai/shared. No
 * node:* (the no-restricted-imports rule blocks node:* in core). Day math uses Date arithmetic
 * on UTC midnight, mirroring the `new Date(d + "T00:00:00Z")` / `.toISOString().slice(0,10)`
 * idiom in syncTransactions.ts. Never throws: invalid input returns a typed Result.err
 * (typescript.md — Result over exceptions). No any/as/!.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";

/** One inclusive date window [from, to], both YYYY-MM-DD. */
export type DateWindow = {
  readonly from: string;
  readonly to: string;
};

/**
 * RangeError — typed domain error for invalid chunk input (from > to, or maxDays ≤ 0).
 * Returned via err(); NOT a thrown JS Error.
 */
export type RangeError = {
  readonly kind: "range-error";
  readonly message: string;
};

const DAY_MS = 86_400_000;

// Parse a YYYY-MM-DD string to its UTC-midnight epoch ms.
function toEpochMs(ymd: string): number {
  return new Date(ymd + "T00:00:00Z").getTime();
}

// Format a UTC-midnight epoch ms back to YYYY-MM-DD.
function toYmd(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * chunkDateRange — split [from, to] into contiguous ≤ maxDays windows.
 *
 * @param from   inclusive start date, YYYY-MM-DD
 * @param to     inclusive end date, YYYY-MM-DD (must be ≥ from)
 * @param maxDays maximum inclusive days per window (must be > 0)
 * @returns ok(windows) covering [from, to] with no gaps/overlap, or err(RangeError) on
 *          invalid input.
 */
export function chunkDateRange(
  from: string,
  to: string,
  maxDays: number,
): Result<ReadonlyArray<DateWindow>, RangeError> {
  if (maxDays <= 0) {
    return err<RangeError>({
      kind: "range-error",
      message: `maxDays must be positive, got ${maxDays}`,
    });
  }

  const fromMs = toEpochMs(from);
  const toMs = toEpochMs(to);

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return err<RangeError>({
      kind: "range-error",
      message: `invalid date(s): from=${from} to=${to}`,
    });
  }

  if (fromMs > toMs) {
    return err<RangeError>({
      kind: "range-error",
      message: `from (${from}) must not be after to (${to})`,
    });
  }

  const windows: DateWindow[] = [];
  let windowStartMs = fromMs;
  while (windowStartMs <= toMs) {
    // Inclusive window: start + (maxDays - 1) days, clamped to the overall `to`.
    const windowEndMs = Math.min(windowStartMs + (maxDays - 1) * DAY_MS, toMs);
    windows.push({ from: toYmd(windowStartMs), to: toYmd(windowEndMs) });
    windowStartMs = windowEndMs + DAY_MS;
  }

  return ok(windows);
}
