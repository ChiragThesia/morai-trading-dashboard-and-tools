/**
 * time.ts — the ONE time-to-expiry function for the calendar engine.
 *
 * Hexagon law (architecture-boundaries §2): pure. `now` is injected; this module never
 * reads a clock.
 *
 * The repo carries nine definitions of time-to-expiry, three inside the GEX path alone.
 * Two of them take a `Date` and disagree about whether its components are UTC or local:
 * `computeT` (journal/domain/dte.ts) reads UTC accessors, `settlementTimestamp`
 * (packages/shared) reads local ones. Passing the wrong flavour to either is a silent
 * one-day error, and mixing whole-day against settlement-aware T is what made theta read
 * visibly low against ThinkOrSwim once already (candidate-selection.ts:406-408).
 *
 * So this takes the expiration as a `YYYY-MM-DD` STRING. There is no Date for a caller to
 * get the flavour of wrong. Measured against the naive whole-day convention, the gap is
 * not academic: from 16:00Z the trader's 15-DTE floor reads as 14.33 days if you measure
 * to UTC midnight instead of to the settlement instant.
 *
 * Settlement classification is delegated to `settlementTimestamp`, which is DST-safe via
 * Intl and is already the shared source of truth: AM 09:30 ET for SPX on the exact third
 * Friday of its month, PM 16:00 ET for everything else.
 */

import { settlementTimestamp } from "@morai/shared";

/** BSM year basis, matching bsmGreeks' theta (D-04) and every other T in the repo. */
export const DAYS_PER_YEAR = 365.25;

const MS_PER_YEAR = DAYS_PER_YEAR * 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`, digits only — a shape check, not a calendar check. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse `YYYY-MM-DD` into its calendar parts, rejecting a well-shaped string that names no
 * real date. "2026-02-30" and "2026-13-01" both pass the regex and both silently roll
 * forward through a Date constructor, so the round-trip check is the actual validation.
 */
function parseIsoDate(
  expiration: string,
): { readonly year: number; readonly month: number; readonly day: number } | null {
  const match = ISO_DATE.exec(expiration);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * calendarDaysTo — whole calendar days from `now`'s UTC date to the expiration date.
 *
 * This is the trader's DTE, and it is what the gates count: "front leg minimum 15 DTE"
 * means fifteen days on a calendar, not fifteen 365.25ths of a year. It is deliberately
 * NOT derived from `yearsToSettlement`, because rounding T gets it wrong in both
 * directions — measured from 04:00Z a 15-calendar-day expiry is T = 15.67 days, and an
 * AM-settled expiry 25 calendar days out is T = 24.9.
 *
 * Time of day within `now` never changes the answer; only its UTC date does. Zero on the
 * expiry date, negative after it — the caller decides what to do with a settled contract,
 * because "already expired" and "expires today" need different treatment.
 *
 * Null, never a number, when the expiration is unparseable.
 */
export function calendarDaysTo(now: Date, expiration: string): number | null {
  const parts = parseIsoDate(expiration);
  if (parts === null) return null;

  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / MS_PER_DAY);
}

/**
 * yearsToSettlement — years from `now` to the instant this contract's payoff is fixed.
 *
 * Returns 0, never NaN and never negative, when the expiration is unparseable or already
 * settled. Zero is the honest answer for a settled contract; for an unparseable one it is
 * a degrade that every downstream guard already rejects (a leg at T = 0 cannot be priced,
 * because gamma and vega divide by √T).
 *
 * @param now        - injected observation instant
 * @param expiration - `YYYY-MM-DD`
 * @param root       - OCC root; decides AM vs PM settlement on a third Friday
 */
export function yearsToSettlement(
  now: Date,
  expiration: string,
  root: "SPX" | "SPXW",
): number {
  const parts = parseIsoDate(expiration);
  if (parts === null) return 0;

  // settlementTimestamp reads LOCAL date components, so hand it a LOCAL-midnight Date.
  // This is the one place in the engine where the flavour of a Date matters, and it is
  // constructed here rather than accepted from a caller precisely so it cannot be wrong.
  const local = new Date(parts.year, parts.month - 1, parts.day);
  const settles = settlementTimestamp(root, local).getTime();
  if (!Number.isFinite(settles)) return 0;

  const ms = settles - now.getTime();
  return ms <= 0 ? 0 : ms / MS_PER_YEAR;
}
