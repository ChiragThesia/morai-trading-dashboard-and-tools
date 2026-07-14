/**
 * registerOpenCalendars.ts — auto-register calendar spreads from the current open
 * position book (JRNL-02).
 *
 * Root gap this closes: calendars opened after the one-off backfill are never registered,
 * so they never appear in the Journal and their fills sit orphan-parked with no calendar
 * to match against. This use-case:
 *   1. Fetches current open positions (ForFetchingOpenPositionLegs — adapted from the
 *      brokerage bounded context at the composition root; journal stays decoupled from it).
 *   2. Pairs them into calendar candidates via the ported pure domain fn (position-pairing.ts).
 *   3. Dedups against already-OPEN calendars only (ForListingCalendars, filtered to
 *      status "open") by (underlying, strike, optionType, frontExpiry, backExpiry) —
 *      idempotent re-runs. A CLOSED calendar sharing the same key is history, not a live
 *      match: a genuinely re-opened trade at the same strike/expiries (still unexpired)
 *      must still register as new, so closed rows never block it.
 *   4. openNetDebit (points) = back.averagePrice − front.averagePrice — Σ avgPrice ×
 *      (longQty − shortQty) over both legs (back is long +avgPrice, front is short
 *      −avgPrice for a standard long calendar).
 *   5. openedAt = the earliest OPENING fill's filledAt among the two legs
 *      (ForReadingFillsByOccSymbols, which reads regardless of processed/orphan status —
 *      these fills may already be orphan-parked from before the calendar existed). Only
 *      positionEffect === "OPENING" fills count: a CLOSING fill on the same OCC symbol
 *      belongs to a different, possibly older calendar that happened to share a leg (a
 *      documented real pattern — see fill-pairing.ts's shared-leg disambiguation) and must
 *      never leak an earlier timestamp in. Falls back to now() when no OPENING fill is
 *      found — never fabricated, and callers can tell the two cases apart via openedAtSource.
 *   6. Registers via the existing registerCalendar use-case (ForRunningRegisterCalendar).
 *
 * KNOWN LIMITATION (not introduced by this use-case — a pre-existing schema constraint):
 * the calendars table's `underlying` column is a single root string shared by BOTH legs
 * (see packages/adapters/src/postgres/repos/fills.ts calendarLegSymbols and
 * calendars.ts getOpenCalendarLegs, both of which derive front+back occSymbol from ONE
 * stored root). A calendar whose front and back legs have DIFFERENT OCC roots (e.g. front
 * SPX-standard, back SPXW-weekly) cannot be fully represented — this use-case stores the
 * front leg's root (the best available single value), so the back leg's occSymbol will be
 * mis-derived by the existing fill-matching/snapshot-resolution paths until a future schema
 * change stores per-leg root. See the handback notes for the concrete affected calendars.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { pairPositionsIntoCalendarCandidates } from "../domain/position-pairing.ts";
import type { PositionLeg } from "../domain/position-pairing.ts";
import type { ForListingCalendars, ForReadingFillsByOccSymbols, StorageError } from "./ports.ts";
import type { ForRunningRegisterCalendar, ValidationError } from "./registerCalendar.ts";
import type { ForRunningRebuildCalendarHistory } from "./rebuildCalendarHistory.ts";

export type { PositionLeg } from "../domain/position-pairing.ts";

// Distinct from journal's FetchError (ports.ts) so this module never imports the brokerage
// bounded context — the composition root maps brokerage's AuthExpiredError/FetchError into
// this shape (architecture-boundaries §7: cross bounded contexts through application ports).
export type FetchError = { readonly kind: "fetch-error"; readonly message: string };

export type ForFetchingOpenPositionLegs = () => Promise<
  Result<ReadonlyArray<PositionLeg>, FetchError>
>;

export type RegisteredCalendarSummary = {
  readonly calendarId: string;
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
  readonly openNetDebit: number;
  readonly openedAt: Date;
  readonly openedAtSource: "fill" | "fallback-now";
  /**
   * Rows backfilled via the plan-05 rebuild engine over [openedAt, now] (HIST-04) — the entry-
   * day-onward history a late registration would otherwise lose. Null when the backfill itself
   * failed; the registration still succeeds (non-fatal) and the history is re-runnable via the
   * self-heal job or the operator repair CLI.
   */
  readonly backfilledSlots: number | null;
};

export type SkippedCalendarSummary = {
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
};

export type RegisterOpenCalendarsResult = {
  readonly registered: ReadonlyArray<RegisteredCalendarSummary>;
  readonly skippedExisting: ReadonlyArray<SkippedCalendarSummary>;
};

export type RegisterOpenCalendarsDeps = {
  readonly fetchOpenPositions: ForFetchingOpenPositionLegs;
  readonly listCalendars: ForListingCalendars;
  readonly readFillsByOccSymbols: ForReadingFillsByOccSymbols;
  readonly registerCalendar: ForRunningRegisterCalendar;
  readonly rebuildCalendarHistory: ForRunningRebuildCalendarHistory;
  readonly now: () => Date;
};

export type ForRunningRegisterOpenCalendars = () => Promise<
  Result<RegisterOpenCalendarsResult, StorageError | FetchError | ValidationError>
>;

type DedupeRow = {
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
};

function dedupeKey(row: DedupeRow): string {
  return `${row.underlying}|${row.strike}|${row.optionType}|${row.frontExpiry}|${row.backExpiry}`;
}

export function makeRegisterOpenCalendarsUseCase(
  deps: RegisterOpenCalendarsDeps,
): ForRunningRegisterOpenCalendars {
  return async () => {
    const positionsResult = await deps.fetchOpenPositions();
    if (!positionsResult.ok) return positionsResult;

    const candidates = pairPositionsIntoCalendarCandidates(positionsResult.value);

    const existingResult = await deps.listCalendars();
    if (!existingResult.ok) return existingResult;

    // Dedup scope is OPEN calendars only. A CLOSED calendar sharing the exact same key is
    // history (a past trade), not a live registration to protect — a genuinely re-opened
    // trade at the same strike/expiries (still unexpired) must still be registered as new.
    const existingKeys = new Set(
      existingResult.value
        .filter((c) => c.status === "open")
        .map((c) =>
          dedupeKey({
            underlying: c.underlying,
            strike: c.strike,
            optionType: c.optionType,
            frontExpiry: c.frontExpiry,
            backExpiry: c.backExpiry,
          }),
        ),
    );

    const registered: RegisteredCalendarSummary[] = [];
    const skippedExisting: SkippedCalendarSummary[] = [];

    for (const candidate of candidates) {
      // Never fabricate an openNetDebit — a position with no reported average price on
      // either leg cannot be registered (D-xx: never a wrong number).
      if (candidate.front.averagePrice === null || candidate.back.averagePrice === null) {
        continue;
      }

      const strikeX1000 = Math.round(candidate.strike * 1000);
      const row: DedupeRow = {
        underlying: candidate.frontRoot,
        strike: strikeX1000,
        optionType: candidate.optionType,
        frontExpiry: candidate.frontExpiry,
        backExpiry: candidate.backExpiry,
      };
      const key = dedupeKey(row);

      if (existingKeys.has(key)) {
        skippedExisting.push(row);
        continue;
      }

      const openNetDebit = candidate.back.averagePrice - candidate.front.averagePrice;
      const qty = Math.abs(candidate.front.longQty - candidate.front.shortQty);

      const fillsResult = await deps.readFillsByOccSymbols([
        candidate.front.occSymbol,
        candidate.back.occSymbol,
      ]);
      if (!fillsResult.ok) return fillsResult;

      // Only OPENING fills count toward openedAt — a CLOSING fill on the same OCC symbol
      // belongs to a DIFFERENT (possibly older, unrelated) calendar that happened to share a
      // leg (a documented real pattern, see fill-pairing.ts's shared-leg disambiguation) and
      // must never leak an earlier timestamp into this newly-registered calendar.
      let earliestFilledAt: Date | null = null;
      for (const fill of fillsResult.value) {
        if (fill.positionEffect !== "OPENING") continue;
        if (earliestFilledAt === null || fill.filledAt.getTime() < earliestFilledAt.getTime()) {
          earliestFilledAt = fill.filledAt;
        }
      }
      const openedAt = earliestFilledAt ?? deps.now();
      const openedAtSource: "fill" | "fallback-now" =
        earliestFilledAt !== null ? "fill" : "fallback-now";

      const registerResult = await deps.registerCalendar({
        underlying: row.underlying,
        strike: strikeX1000,
        optionType: candidate.optionType,
        frontExpiry: candidate.frontExpiry,
        backExpiry: candidate.backExpiry,
        qty,
        openNetDebit,
        openedAt,
      });
      if (!registerResult.ok) return registerResult;

      // HIST-04: backfill the entry-day-onward history so late registration never loses it.
      // Non-fatal — the calendar is already persisted; a rebuild failure is recorded on the
      // summary (backfilledSlots: null) rather than failing the registration, and is
      // re-runnable via the self-heal job or the operator repair CLI.
      const backfillResult = await deps.rebuildCalendarHistory(registerResult.value, {
        from: openedAt,
        to: deps.now(),
      });
      const backfilledSlots = backfillResult.ok ? backfillResult.value.rowsHealed : null;

      registered.push({
        calendarId: registerResult.value.id,
        underlying: row.underlying,
        strike: strikeX1000,
        optionType: candidate.optionType,
        frontExpiry: candidate.frontExpiry,
        backExpiry: candidate.backExpiry,
        openNetDebit,
        openedAt,
        openedAtSource,
        backfilledSlots,
      });
      // Prevents re-registering the same candidate twice within one run (defensive — the
      // grouping key already guarantees at most one candidate per (underlying,strike,type)).
      existingKeys.add(key);
    }

    return ok({ registered, skippedExisting });
  };
}
