/**
 * getExitAdvice.ts — the exit-advisor read use-case (Phase 26, Plan 04).
 *
 * Unlike getPicker.ts (a pure forwarder over one stored-snapshot row), a persisted
 * `ExitVerdictRow` carries only what evaluateExit itself produces (verdict/rung/ruleId/
 * metric/indicative/escalate/roll, 26-01/26-03) — it does NOT carry the calendar's name or
 * the pnlPct/basis the UI needs for every verdict (GAMMA/TERM/EVT/ROLL verdicts don't drive
 * off pnlPct at all, so it can't be read back out of `metric` in general). getExitAdvice
 * therefore re-joins the latest verdict per calendar against the SAME held-position +
 * snapshot reads computeExitAdvice.ts uses, and re-derives pnlPct/basis identically
 * (never a parallel P&L formula, EXIT-02) — never fabricating a value for a verdict whose
 * calendar or snapshot has since gone missing (that position is simply omitted).
 *
 * `changed` is conservatively `false`: no "N most recent verdicts" read exists yet to
 * reconstruct a cross-cycle diff at read time (see HeldPositionVerdict's port doc comment).
 *
 * Cold start (D-18 precedent): zero verdict rows anywhere → ok(null).
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + this context's own
 * application/domain modules.
 */

import { ok, isWithinRth, isNyseHoliday } from "@morai/shared";
import type { Result } from "@morai/shared";
import { EXIT_RULE_METADATA } from "../domain/exit-rules.ts";
import type {
  ExitAdviceSnapshot,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingLatestVerdictsPerCalendar,
  ForRunningGetExitAdvice,
  HeldPositionVerdict,
  StorageError,
} from "./ports.ts";

export type GetExitAdviceDeps = {
  readonly readHeldPositions: ForReadingHeldPositions;
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendar;
  readonly readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar;
  /** Clock injection — marketSession is evaluated at READ time (this API call), not tied to
   * whichever compute cycle last wrote a verdict. */
  readonly now: () => Date;
};

export function makeGetExitAdviceUseCase(deps: GetExitAdviceDeps): ForRunningGetExitAdvice {
  return async (): Promise<Result<ExitAdviceSnapshot | null, StorageError>> => {
    const verdictsResult = await deps.readLatestVerdictsPerCalendar();
    if (!verdictsResult.ok) return verdictsResult;
    if (verdictsResult.value.length === 0) return ok(null); // nothing computed yet (D-18 cold start)

    const positionsResult = await deps.readHeldPositions();
    if (!positionsResult.ok) return positionsResult;

    const snapshotsResult = await deps.readLatestSnapshotPerOpenCalendar();
    if (!snapshotsResult.ok) return snapshotsResult;

    const positionByCalendar = new Map(positionsResult.value.map((p) => [p.calendarId, p]));
    const snapshotByCalendar = new Map(snapshotsResult.value.map((s) => [s.calendarId, s]));

    const positions: HeldPositionVerdict[] = [];
    let latestObservedAt: Date | null = null;

    for (const row of verdictsResult.value) {
      const position = positionByCalendar.get(row.calendarId);
      const snapshot = snapshotByCalendar.get(row.calendarId);
      // A verdict whose calendar has since closed, or whose calendar has no snapshot yet,
      // is omitted rather than rendered with a fabricated name/pnlPct (EXIT-04).
      if (position === undefined || snapshot === undefined) continue;

      const pnlPct = (snapshot.netMark - position.openNetDebit) / position.openNetDebit;

      positions.push({
        calendarId: row.calendarId,
        name: position.name,
        verdict: row.verdict,
        changed: false,
        pnlPct,
        basis: { openNetDebit: position.openNetDebit, netMark: snapshot.netMark },
      });

      if (latestObservedAt === null || row.observedAt > latestObservedAt) latestObservedAt = row.observedAt;
    }

    const observedAt = latestObservedAt ?? deps.now();
    const now = deps.now();
    const marketSession: "rth" | "after-hours" = isWithinRth(now) && !isNyseHoliday(now) ? "rth" : "after-hours";

    return ok({
      asOf: observedAt.toISOString().slice(0, 10),
      observedAt,
      marketSession,
      positions,
      ruleSet: EXIT_RULE_METADATA.map((rule) => ({ id: rule.id, kind: rule.kind, rationale: rule.rationale })),
    });
  };
}
