/**
 * computeExitAdvice.ts — the per-cycle exit-advisor use-case (Phase 26, Plan 04).
 *
 * Read order (26-CONTEXT.md / 26-RESEARCH.md "Hysteresis Recommendation"): open calendars →
 * latest snapshot per calendar → latest verdict per calendar (hysteresis self-read) →
 * economic events → [per calendar] chain-for-roll → evaluateExit → persist. One verdict row
 * per open calendar per cycle (EXIT-01).
 *
 * MarketContext.pnl fields come from a SINGLE snapshot read (netMark/pnlOpen) + the
 * calendar's own openNetDebit — never a parallel P&L computation (EXIT-02, T-26-11).
 *
 * A persist error on one calendar is surfaced as `err` immediately — pg-boss retries the
 * whole cycle, and `onConflictDoNothing` (26-03) makes the retry a safe resume: calendars
 * that already got a row this cohort are no-ops, calendars that didn't get filled in
 * (T-26-12). A chain-for-roll read failure is treated as non-fatal (ROLL degrades to "no
 * replacement front found" for that calendar) — losing a ROLL suggestion should never block
 * STOP/TAKE/EVT/TERM verdicts for the rest of the cohort.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + this context's own
 * domain/application modules. No I/O, no adapters, no @morai/contracts (that Zod validation
 * lives at the repo boundary, 26-03, and will live at the route boundary, 26-05).
 */

import { ok, isWithinRth, isNyseHoliday } from "@morai/shared";
import type { Result } from "@morai/shared";
import { evaluateExit } from "../domain/evaluate-exit.ts";
import type { MarketContext, PreviousVerdict, RollCandidateQuote } from "../domain/types.ts";
import type {
  ChainQuoteForRoll,
  ExitVerdictRow,
  ForPersistingExitVerdict,
  ForReadingChainForRoll,
  ForReadingEconomicEvents,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingLatestVerdictsPerCalendar,
  ForRunningComputeExitAdvice,
  StorageError,
} from "./ports.ts";

export type ComputeExitAdviceDeps = {
  readonly readHeldPositions: ForReadingHeldPositions;
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendar;
  readonly readLatestVerdictsPerCalendar: ForReadingLatestVerdictsPerCalendar;
  readonly readEconomicEvents: ForReadingEconomicEvents;
  readonly readChainForRoll: ForReadingChainForRoll;
  readonly persistExitVerdict: ForPersistingExitVerdict;
  /** Clock injection — cohort observedAt + the evaluator's staleness gate. Never wall-clock inline. */
  readonly now: () => Date;
};

/** Filters chain-for-roll quotes down to the calendar's own strike and maps to the evaluator's shape. */
function toRollCandidates(
  quotes: ReadonlyArray<ChainQuoteForRoll>,
  strike: number,
): ReadonlyArray<RollCandidateQuote> {
  return quotes
    .filter((q) => q.strike === strike)
    .map((q) => ({ expiration: q.expiration, bid: q.bid, ask: q.ask }));
}

/** A verdict "changed" when its (verdict, rung, ruleId) differs from the previous cycle's —
 * including cold start (no previous row means the very first verdict is itself notable). */
function hasChanged(current: { readonly verdict: string; readonly rung: string | null; readonly ruleId: string }, previous: PreviousVerdict): boolean {
  return (
    previous === null ||
    current.verdict !== previous.verdict ||
    current.rung !== previous.rung ||
    current.ruleId !== previous.ruleId
  );
}

export function makeComputeExitAdviceUseCase(deps: ComputeExitAdviceDeps): ForRunningComputeExitAdvice {
  return async (): Promise<Result<void, StorageError>> => {
    const positionsResult = await deps.readHeldPositions();
    if (!positionsResult.ok) return positionsResult;

    const snapshotsResult = await deps.readLatestSnapshotPerOpenCalendar();
    if (!snapshotsResult.ok) return snapshotsResult;

    const verdictsResult = await deps.readLatestVerdictsPerCalendar();
    if (!verdictsResult.ok) return verdictsResult;

    const eventsResult = await deps.readEconomicEvents();
    if (!eventsResult.ok) return eventsResult;

    const snapshotByCalendar = new Map(snapshotsResult.value.map((s) => [s.calendarId, s]));
    const previousRowByCalendar = new Map<string, ExitVerdictRow>(
      verdictsResult.value.map((v) => [v.calendarId, v]),
    );
    const cohortNow = deps.now();

    for (const position of positionsResult.value) {
      const snapshot = snapshotByCalendar.get(position.calendarId);
      // No snapshot yet for this calendar this cohort — nothing to evaluate against; the next
      // cycle picks it up once snapshot-calendars has written one (T-26-12-style safe skip,
      // not an error — matches D-18 "no fabricated precision" for an absent read).
      if (snapshot === undefined) continue;

      const chainResult = await deps.readChainForRoll(position.strike);
      const rollCandidates = chainResult.ok ? toRollCandidates(chainResult.value, position.strike) : [];

      const marketSession: "rth" | "after-hours" =
        isWithinRth(snapshot.time) && !isNyseHoliday(snapshot.time) ? "rth" : "after-hours";

      const context: MarketContext = {
        netMark: snapshot.netMark,
        pnlOpen: snapshot.pnlOpen,
        spot: snapshot.spot,
        frontIv: snapshot.frontIv,
        backIv: snapshot.backIv,
        dteFront: snapshot.dteFront,
        dteBack: snapshot.dteBack,
        snapshotTime: snapshot.time,
        cohortNow,
        marketSession,
        tier1Events: eventsResult.value,
        rollChain: { candidates: rollCandidates },
      };

      const previousRow = previousRowByCalendar.get(position.calendarId) ?? null;
      const previousVerdict: PreviousVerdict =
        previousRow === null
          ? null
          : {
              verdict: previousRow.verdict.verdict,
              rung: previousRow.verdict.rung,
              ruleId: previousRow.verdict.ruleId,
              armedAt: previousRow.observedAt,
            };

      const verdict = evaluateExit(position, context, previousVerdict);

      // EXIT-09: only verdict CHANGES surface as alerts; STOP/EXIT_PRE_EVENT escalate distinctly.
      // No external notification system this phase (26-CONTEXT.md) — console.warn is the
      // sanctioned ops-visibility channel (typescript.md "gate console").
      if (hasChanged(verdict, previousVerdict) && verdict.escalate) {
        console.warn(
          `compute-exit-advice: verdict change for calendar ${position.calendarId}: ` +
            `${verdict.verdict}${verdict.rung !== null ? ` ${verdict.rung}` : ""} (${verdict.ruleId})`,
        );
      }

      // observedAt is the calendar's own latest snapshot time (data-derived, deterministic
      // across a pg-boss retry) — NOT the wall-clock cohortNow used for the staleness gate.
      // Mirrors calendar_snapshots' own (time, calendar_id) PK grain: a retry that re-reads
      // the SAME latest snapshot reproduces the SAME key, so onConflictDoNothing (26-03)
      // actually dedups instead of minting a fresh row on every retry (T-26-12).
      const persistResult = await deps.persistExitVerdict({
        observedAt: snapshot.time,
        calendarId: position.calendarId,
        verdict,
      });
      if (!persistResult.ok) return persistResult;
    }

    return ok(undefined);
  };
}
