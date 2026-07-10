/**
 * brakes.ts — the two anti-criteria brake evaluators (28-02, PLAY-02).
 *
 * Pure booleans that feed Plan 01's resolveEntryGate (entry-gate.ts) via its
 * `maxOpenBrake` / `cooldownBrake` inputs — same call, same cycle, no separate gate path.
 * A third brake (sustained-trend) was USER-DECISION-2-dropped: no honest calibration basis
 * at n=13 (28-CONTEXT.md), revivable when a larger-n backtest supplies evidence.
 *
 * Hexagon law (architecture-boundaries §2 + rule 7): imports only @morai/shared and this
 * context's own entry-gate.ts (same bounded context, not a cross-context import).
 * `RecentClosedCalendarRow` is a structural, core-local mirror of journal's
 * RecentClosedCalendar port type (28-02-PLAN.md) — same convention entry-gate.ts's
 * MacroSeriesRow already uses for journal's MacroObservationRow.
 */

import { businessDaysSince } from "./entry-gate.ts";

// ─────────────────────────────────────────────────────────────
// USER-LOCKED thresholds (28-CONTEXT.md USER DECISION 2)
// ─────────────────────────────────────────────────────────────

/** Max simultaneously-open calendars before new entries pause. */
export const MAX_OPEN_CALENDARS = 6;

/** Realized-loss rung (as a fraction of openNetDebit) that arms the cooldown. */
export const LOSS_COOLDOWN_PCT = -0.25;

/** Cooldown window length once armed, in NYSE business days. */
export const COOLDOWN_BIZDAYS = 2;

// ─────────────────────────────────────────────────────────────
// maxOpenTripped
// ─────────────────────────────────────────────────────────────

/**
 * maxOpenTripped — true once open calendar count reaches the max (>=, not >). `max` defaults
 * to `MAX_OPEN_CALENDARS` (29-03 runtime rule settings override seam) when omitted.
 */
export function maxOpenTripped(openCount: number, max?: number): boolean {
  return openCount >= (max ?? MAX_OPEN_CALENDARS);
}

// ─────────────────────────────────────────────────────────────
// cooldownActive
// ─────────────────────────────────────────────────────────────

/** Core-local structural mirror of journal's RecentClosedCalendar (rule 7 — no cross-context import). */
export type RecentClosedCalendarRow = {
  readonly calendarId: string;
  readonly closedAt: Date;
  readonly openNetDebit: number;
  readonly realizedPnl: number | null;
};

/**
 * cooldownActive — true when ANY recently-closed calendar's realizedPnl/openNetDebit is at or
 * beyond LOSS_COOLDOWN_PCT (a -25.0% close trips it; -24.9% does not). A non-positive
 * openNetDebit (zero, or negative for a credit-opened calendar) or a null realizedPnl skips
 * that row entirely — never a divide-by-zero, NaN, or sign-inverted ratio (T-28-05, IN-01).
 */
export function cooldownActive(recentClosed: ReadonlyArray<RecentClosedCalendarRow>): boolean {
  return recentClosed.some((row) => {
    if (row.openNetDebit <= 0 || row.realizedPnl === null) return false;
    return row.realizedPnl / row.openNetDebit <= LOSS_COOLDOWN_PCT;
  });
}

// ─────────────────────────────────────────────────────────────
// cooldownCutoff
// ─────────────────────────────────────────────────────────────

/**
 * cooldownCutoff — the ISO date (YYYY-MM-DD) COOLDOWN_BIZDAYS business days before `nowIso`,
 * the value the use-case passes to ForReadingRecentClosedCalendars(sinceDate).
 *
 * ponytail: walks back one calendar day at a time (bounded by COOLDOWN_BIZDAYS=2, so at most
 * ~4 iterations across a weekend), using businessDaysSince as the oracle for each candidate —
 * reuses Plan 01's real weekday+NYSE-holiday logic instead of reimplementing a calendar-day
 * proxy for "business day".
 */
export function cooldownCutoff(nowIso: string): string {
  const cursor = new Date(`${nowIso}T00:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidateIso = cursor.toISOString().slice(0, 10);
    if (businessDaysSince(candidateIso, nowIso) === COOLDOWN_BIZDAYS) return candidateIso;
  }
}
