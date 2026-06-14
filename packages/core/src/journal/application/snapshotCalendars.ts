/**
 * snapshotCalendars use-case — batch snapshot of all open calendars (CAL-02, CAL-04, CAL-05).
 *
 * Algorithm:
 *   1. Get all open calendars (closed calendars are excluded by the port)
 *   2. For each calendar, resolve front leg (by frontExpiry) and back leg (by backExpiry)
 *   3. Build a SnapshotRow per D-05 formulas and D-06 NaN continuity rule
 *   4. Persist each row (idempotency is the repo's job via composite PK)
 *
 * D-05 formulas:
 *   net_mark = back_mark - front_mark
 *   net_greek = (back_greek - front_greek) * qty * 100
 *   pnl_open = (net_mark - open_net_debit) * qty * 100
 *   term_slope = back_iv - front_iv
 *
 * D-06 NaN continuity: when a leg is null or has bsmIv='NaN', STILL write the row.
 *   Affected columns (IV, greeks, termSlope) get NAN_STAMP; marks and pnlOpen still populate.
 *
 * Pure domain: no I/O, no Date.now(), imports only @morai/shared and ports/domain.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  Calendar,
  LegSnapshot,
  SnapshotRow,
  StorageError,
  ForGettingOpenCalendars,
  ForResolvingLegSnapshot,
  ForPersistingSnapshot,
} from "./ports.ts";
import { calendarDte } from "../domain/dte.ts";

// NaN sentinel — always use this string, never JS NaN (D-06, T-03-13)
export const NAN_STAMP = "NaN";

export type SnapshotCalendarsDeps = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly resolveLegs: ForResolvingLegSnapshot;
  readonly persistSnapshot: ForPersistingSnapshot;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2) */
  readonly now: () => Date;
};

/** Driver port returned by the factory */
export type ForRunningSnapshotCalendars = () => Promise<Result<void, StorageError>>;

/**
 * buildSnapshotRow — compute a full 18-column SnapshotRow per D-05 / D-06.
 *
 * Called once per open calendar. Either leg may be null (resolve error or ok(null)).
 * When either leg's bsmIv is NAN_STAMP, ALL IV/greek columns get NAN_STAMP.
 * Marks and pnlOpen always populate from whatever data exists.
 */
function buildSnapshotRow(
  now: Date,
  cal: Calendar,
  front: LegSnapshot | null,
  back: LegSnapshot | null,
): SnapshotRow {
  // Marks default to 0 when a leg is missing (NaN row will indicate the issue)
  const frontMark = front?.mark ?? 0;
  const backMark = back?.mark ?? 0;
  const netMark = backMark - frontMark;

  // BSM IVs — NAN_STAMP when missing or already NaN-stamped
  const frontIv = front?.bsmIv ?? NAN_STAMP;
  const backIv = back?.bsmIv ?? NAN_STAMP;
  const anyNaN = frontIv === NAN_STAMP || backIv === NAN_STAMP;

  // net greek helper — propagates NaN when either IV is NaN or a BSM greek is null
  const netGreek = (b: string | null, f: string | null): string => {
    if (anyNaN || b === null || f === null) return NAN_STAMP;
    return String((parseFloat(b) - parseFloat(f)) * cal.qty * 100);
  };

  // term slope — NaN when either IV is NaN
  const termSlope = anyNaN
    ? NAN_STAMP
    : String(parseFloat(backIv) - parseFloat(frontIv));

  // pnl_open uses marks (not greeks) — always computable regardless of NaN (D-06)
  const pnlOpen = String((netMark - cal.openNetDebit) * cal.qty * 100);

  // spot from underlyingPrice — prefer back leg, fall back to front, else "0"
  const spot = String(
    back?.underlyingPrice ?? front?.underlyingPrice ?? 0,
  );

  // Raw IV from vendor — RESEARCH Open Question 2: use NAN_STAMP when ivRaw is null
  const frontIvRaw =
    front?.ivRaw !== null && front?.ivRaw !== undefined
      ? String(front.ivRaw)
      : NAN_STAMP;
  const backIvRaw =
    back?.ivRaw !== null && back?.ivRaw !== undefined
      ? String(back.ivRaw)
      : NAN_STAMP;

  return {
    time: now,
    calendarId: cal.id,
    spot,
    netMark: String(netMark),
    frontMark: String(frontMark),
    backMark: String(backMark),
    frontIv,
    backIv,
    frontIvRaw,
    backIvRaw,
    netDelta: netGreek(back?.bsmDelta ?? null, front?.bsmDelta ?? null),
    netGamma: netGreek(back?.bsmGamma ?? null, front?.bsmGamma ?? null),
    netTheta: netGreek(back?.bsmTheta ?? null, front?.bsmTheta ?? null),
    netVega: netGreek(back?.bsmVega ?? null, front?.bsmVega ?? null),
    termSlope,
    dteFront: calendarDte(now, new Date(cal.frontExpiry)),
    dteBack: calendarDte(now, new Date(cal.backExpiry)),
    pnlOpen,
    source: "cboe",
  };
}

/**
 * makeSnapshotCalendarsUseCase — factory returning the batch snapshot use-case.
 *
 * Iterates all open calendars. Resolves both legs. Builds the row per D-05/D-06.
 * Persists unconditionally (idempotency is handled by the composite-PK repo).
 * Propagates StorageError from getOpenCalendars or persistSnapshot.
 * resolveLegs errors are treated as null legs per D-06 (never abort the loop).
 */
export function makeSnapshotCalendarsUseCase(
  deps: SnapshotCalendarsDeps,
): ForRunningSnapshotCalendars {
  return async (): Promise<Result<void, StorageError>> => {
    const now = deps.now();

    const calendarsResult = await deps.getOpenCalendars();
    if (!calendarsResult.ok) return err(calendarsResult.error);

    for (const calendar of calendarsResult.value) {
      // Resolve front leg — error treated as null (D-06: never skip the row)
      const frontResult = await deps.resolveLegs({
        underlying: calendar.underlying,
        strike: calendar.strike,
        optionType: calendar.optionType,
        expiry: calendar.frontExpiry,
      });
      const front = frontResult.ok ? frontResult.value : null;

      // Resolve back leg — same error policy
      const backResult = await deps.resolveLegs({
        underlying: calendar.underlying,
        strike: calendar.strike,
        optionType: calendar.optionType,
        expiry: calendar.backExpiry,
      });
      const back = backResult.ok ? backResult.value : null;

      const row = buildSnapshotRow(now, calendar, front, back);

      const persistResult = await deps.persistSnapshot(row);
      if (!persistResult.ok) return err(persistResult.error);
    }

    return ok(undefined);
  };
}
