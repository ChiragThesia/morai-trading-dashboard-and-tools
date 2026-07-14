/**
 * snapshotCalendars use-case — batch snapshot of all open calendars (CAL-02, CAL-04, CAL-05).
 *
 * Algorithm:
 *   1. Get all open calendars (closed calendars are excluded by the port)
 *   2. For each calendar, resolve front leg (by frontExpiry) and back leg (by backExpiry)
 *   3. OPS-01 freshness gate: skip the calendar (no row) when either leg is missing or older
 *      than SNAPSHOT_LEG_STALENESS_TOLERANCE_MS — never write a zero/NaN gap row or serve
 *      stale marks silently. Next cycle self-heals; historical gap rows are never backfilled.
 *   4. Build a SnapshotRow per D-05 formulas and D-06 NaN continuity rule
 *   5. Persist each row (idempotency is the repo's job via composite PK)
 *
 * D-05 formulas:
 *   net_mark = back_mark - front_mark
 *   net_greek = (back_greek - front_greek) * qty * 100
 *   pnl_open = (net_mark - open_net_debit) * qty * 100
 *   term_slope = back_iv - front_iv
 *
 * D-06 NaN continuity (only reached once both legs pass the freshness gate): when a leg's
 *   bsmIv='NaN' (fresh but unsolved), STILL write the row. Affected columns (IV, greeks,
 *   termSlope) get NAN_STAMP; marks and pnlOpen still populate.
 *
 * Pure domain apart from a single console.warn skip diagnostic; no other I/O, no
 * Date.now(), imports only @morai/shared and ports/domain.
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
import { roundDownToRthSlot } from "../domain/rth-slot.ts";

// NaN sentinel — always use this string, never JS NaN (D-06, T-03-13)
export const NAN_STAMP = "NaN";

/**
 * SNAPSHOT_LEG_STALENESS_TOLERANCE_MS — OPS-01 freshness gate tolerance: 45 minutes
 * (1.5x the 30-min RTH chain-fetch cadence). MEDIUM-confidence tunable per RESEARCH A1.
 */
export const SNAPSHOT_LEG_STALENESS_TOLERANCE_MS = 45 * 60 * 1000;

/**
 * isLegFresh — OPS-01 freshness predicate. A missing leg (null) is never fresh. A present
 * leg is fresh when its observation instant is within the tolerance of `now`. Boundary is
 * inclusive: exactly at the tolerance edge counts as fresh.
 */
export function isLegFresh(leg: LegSnapshot | null, now: Date): boolean {
  if (leg === null) return false;
  return now.getTime() - leg.time.getTime() <= SNAPSHOT_LEG_STALENESS_TOLERANCE_MS;
}

/**
 * LegFreshnessReason — OPS-01 skip-warn diagnostic (WR-01). Distinguishes a genuine
 * no-observation miss ("missing") from a present-but-expired observation ("stale") from a
 * resolveLegs storage error ("resolve-error") — previously all collapsed into "missing",
 * hiding a transient DB hiccup behind the same label as "leg never observed".
 */
type LegFreshnessReason = "fresh" | "missing" | "stale" | "resolve-error";

type LegFreshness = {
  readonly fresh: boolean;
  readonly reason: LegFreshnessReason;
  readonly ageMinutes: number | null;
  readonly observedAt: string | null;
};

/**
 * assessLegFreshness — classifies a resolveLegs Result against the OPS-01 gate. Computed
 * once per leg per calendar and reused for both the gate check and the warn message (IN-02:
 * no redundant isLegFresh re-evaluation).
 */
function assessLegFreshness(
  legResult: Result<LegSnapshot | null, StorageError>,
  now: Date,
): LegFreshness {
  if (!legResult.ok) {
    return { fresh: false, reason: "resolve-error", ageMinutes: null, observedAt: null };
  }
  const leg = legResult.value;
  if (leg === null) {
    return { fresh: false, reason: "missing", ageMinutes: null, observedAt: null };
  }
  const fresh = isLegFresh(leg, now);
  return {
    fresh,
    reason: fresh ? "fresh" : "stale",
    ageMinutes: Math.round((now.getTime() - leg.time.getTime()) / 60000),
    observedAt: leg.time.toISOString(),
  };
}

/** describeLegFreshness — renders a leg's classification for the skip-warn message. */
function describeLegFreshness(freshness: LegFreshness, now: Date): string {
  if (freshness.reason === "fresh") return "fresh";
  if (freshness.reason !== "stale") return freshness.reason;
  const observedAt = freshness.observedAt ?? "unknown";
  return `stale (${String(freshness.ageMinutes)}m, observed ${observedAt}, now ${now.toISOString()})`;
}

/**
 * computeSnapshotPnl — D-05 pnl_open formula, exported so the JRNL-01 data-correction path
 * (recomputeSnapshotPnl.ts) re-derives historical pnl_open with the EXACT same formula the
 * live snapshot writer uses below — no formula drift between the two call sites.
 */
export function computeSnapshotPnl(
  netMark: number,
  openNetDebit: number,
  qty: number,
): number {
  return (netMark - openNetDebit) * qty * 100;
}

export type SnapshotCalendarsDeps = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly resolveLegs: ForResolvingLegSnapshot;
  readonly persistSnapshot: ForPersistingSnapshot;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2) */
  readonly now: () => Date;
};

/** Driver port returned by the factory */
export type ForRunningSnapshotCalendars = (args?: {
  /** SNAP-01, D-12: provenance to stamp on every row this run. Defaults to 'scheduled'. */
  readonly trigger?: "scheduled" | "event-move";
}) => Promise<Result<void, StorageError>>;

/**
 * computeLegPairMetrics — pure leg-pair metrics formula (PICK-04, 27-02, RESEARCH Pattern 5).
 * Extracted out of `buildSnapshotRow` so a hypothetical (never-traded) candidate's metrics
 * can be computed from a bare front/back `LegSnapshot` pair without a `Calendar` row.
 *
 * Everything `buildSnapshotRow` computes EXCEPT `calendarId`/`pnlOpen`/`trigger` — those
 * depend on a `Calendar` object (id, openNetDebit) a hypothetical candidate doesn't have.
 * Either leg may be null (resolve error or ok(null)). When either leg's bsmIv is NAN_STAMP,
 * ALL IV/greek columns get NAN_STAMP. Marks always populate from whatever data exists.
 */
export function computeLegPairMetrics(
  now: Date,
  front: LegSnapshot | null,
  back: LegSnapshot | null,
  qty: number,
  frontExpiry: string,
  backExpiry: string,
): Omit<SnapshotRow, "calendarId" | "pnlOpen" | "trigger"> {
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
    return String((parseFloat(b) - parseFloat(f)) * qty * 100);
  };

  // term slope — NaN when either IV is NaN
  const termSlope = anyNaN
    ? NAN_STAMP
    : String(parseFloat(backIv) - parseFloat(frontIv));

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

  // Source: prefer front leg, fall back to back, default to 'cboe' when both legs are null.
  // 'computed_only' observations have no vendor source; map to 'cboe' (the historical default).
  const rawSource = front?.source ?? back?.source ?? "cboe";
  const source: "cboe" | "schwab_chain" = rawSource === "schwab_chain" ? "schwab_chain" : "cboe";

  return {
    time: now,
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
    dteFront: calendarDte(now, new Date(frontExpiry)),
    dteBack: calendarDte(now, new Date(backExpiry)),
    source,
  };
}

/**
 * buildSnapshotRow — compute a full 18-column SnapshotRow per D-05 / D-06.
 *
 * Called once per open calendar. Delegates the pure leg-pair metrics to
 * `computeLegPairMetrics` (PICK-04, 27-02) and attaches the Calendar-derived fields
 * (calendarId, pnlOpen, trigger) — behavior byte-identical to before the extraction.
 */
function buildSnapshotRow(
  now: Date,
  cal: Calendar,
  front: LegSnapshot | null,
  back: LegSnapshot | null,
  trigger: "scheduled" | "event-move",
): SnapshotRow {
  const metrics = computeLegPairMetrics(now, front, back, cal.qty, cal.frontExpiry, cal.backExpiry);
  // pnl_open uses marks (not greeks) — always computable regardless of NaN (D-06)
  const pnlOpen = String(computeSnapshotPnl(parseFloat(metrics.netMark), cal.openNetDebit, cal.qty));
  return { ...metrics, calendarId: cal.id, pnlOpen, trigger };
}

/**
 * makeSnapshotCalendarsUseCase — factory returning the batch snapshot use-case.
 *
 * Iterates all open calendars. Resolves both legs, applies the OPS-01 freshness gate, and
 * builds the row per D-05/D-06 only when both legs pass. Idempotency is handled by the
 * composite-PK repo. Propagates StorageError from getOpenCalendars or persistSnapshot.
 * resolveLegs errors are treated as null legs (never abort the whole run) — a null leg now
 * fails the freshness gate and skips that one calendar's cycle instead of persisting.
 */
export function makeSnapshotCalendarsUseCase(
  deps: SnapshotCalendarsDeps,
): ForRunningSnapshotCalendars {
  return async (
    args?: { readonly trigger?: "scheduled" | "event-move" },
  ): Promise<Result<void, StorageError>> => {
    const trigger = args?.trigger ?? "scheduled";
    const now = deps.now();
    // HIST-05: scheduled rows floor to their 30-min slot boundary so two near-simultaneous
    // scheduled writes collide on the composite PK and onConflictDoNothing absorbs the
    // duplicate. event-move rows keep the real instant (D-07). Freshness below stays on the
    // REAL `now` — only the persisted row time is rounded.
    const rowTime = trigger === "scheduled" ? roundDownToRthSlot(now) : now;

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

      // OPS-01: skip this calendar's cycle when either leg is missing or stale — never write
      // a spot=0/net_mark=0/front_iv=NaN gap row (Jul-06 mechanism) or silently serve stale
      // marks. Next cycle self-heals; historical rows are never backfilled.
      const frontFreshness = assessLegFreshness(frontResult, now);
      const backFreshness = assessLegFreshness(backResult, now);
      if (!frontFreshness.fresh || !backFreshness.fresh) {
        console.warn(
          `snapshot-calendars: skipping calendar ${calendar.id} — front leg ${describeLegFreshness(frontFreshness, now)}, back leg ${describeLegFreshness(backFreshness, now)}`,
        );
        continue;
      }

      const row = buildSnapshotRow(rowTime, calendar, front, back, trigger);

      const persistResult = await deps.persistSnapshot(row);
      if (!persistResult.ok) return err(persistResult.error);
    }

    return ok(undefined);
  };
}
