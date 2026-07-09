/**
 * runBacktest — the phase's orchestrator (Phase 27, Plan 06). Reduces the three 05 replay
 * paths (leakage oracle BT-02, 13-trade walk-forward BT-03, hypothetical full-universe
 * simulation BT-04 input) into one honest BacktestReport and persists it EXACTLY ONCE via
 * ForPersistingBacktestRun. Never calls a weight/rule write path (BT-05 — proved by
 * ports.test.ts's structural guard).
 *
 * Sequence per cohort in [from, to]: replayPickerCohort (mismatches) + a baseline
 * replayHypotheticalEntry pass (the BT-04 outcome sample, reused for attribution, ablation's
 * baseline ranking, and coverage's gap signal). Per closed calendar (optionally narrowed to
 * one --calendar): replayExitsForCalendar (the 13-trade oracle). Then the 04 kernel fns
 * reduce everything: per-rule directional attribution (median-split on each candidate's own
 * breakdown[] entry for that rule vs its simulated outcome — "high-scoring beat low-scoring",
 * 27-CONTEXT.md's locked framing), per-rule leave-one-out ablation (a second
 * replayHypotheticalEntry pass per rule per cohort with that rule's weight zeroed — the
 * ablation seam, 27-02), a seeded bootstrap CI on three headline P&L samples, and
 * gap-excluded coverage. Both standing caveats (late-solved-BSM optimism, economic-events
 * leakage) are always attached, never silently absorbed.
 *
 * Hexagon law (architecture-boundaries §2/§7): imports only @morai/shared + the reused
 * journal ports threaded to @morai/core (self-import, mirrors 05's precedent) + this
 * context's own sibling replay use-cases/kernel/ports/types (plain relative imports — same
 * bounded context, not a foreign-context domain/ import).
 */

import { ok, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { Calendar, ForListingCalendars, ForReadingCalendarEvents, ForReadingEconomicEvents, BreakdownCriterion } from "@morai/core";
import { replayPickerCohort } from "./replayPickerCohort.ts";
import { replayExitsForCalendar } from "./replayExitsForCalendar.ts";
import { replayHypotheticalEntry } from "./replayHypotheticalEntry.ts";
import type { HypotheticalCandidateOutcome } from "./replayHypotheticalEntry.ts";
import { directionalAttribution } from "../domain/directional-attribution.ts";
import type { AttributionSample } from "../domain/directional-attribution.ts";
import { ablationDelta } from "../domain/ablation-delta.ts";
import { bootstrapCi } from "../domain/bootstrap-ci.ts";
import { coveragePercent } from "../domain/coverage.ts";
import type { CoverageCohort } from "../domain/coverage.ts";
import type {
  AblationRow,
  BacktestReport,
  BootstrapCiRow,
  CohortMismatch,
  CoverageDay,
  DirectionalAttributionRow,
  TradeReproduction,
} from "../domain/types.ts";
import type {
  ForPersistingBacktestRun,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  ForReadingFullSnapshotHistoryForCalendar,
  ForReadingPickerSnapshotsInRange,
  StorageError,
  StoredPickerSnapshotRow,
} from "./ports.ts";

export type RunBacktestParams = {
  readonly from: Date;
  readonly to: Date;
  /** Optional --calendar narrowing (BT-03 replay only). Omitted = every closed calendar. */
  readonly calendarId?: string;
};

export type RunBacktestDeps = {
  readonly readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange;
  readonly readChainAsOf: ForReadingChainAsOf;
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  readonly readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readEconomicEvents: ForReadingEconomicEvents;
  readonly listCalendars: ForListingCalendars;
  readonly persistBacktestRun: ForPersistingBacktestRun;
  /** Risk-free rate (decimal), supplied by the CLI composition root. */
  readonly rate: number;
  /** Continuous dividend yield (decimal), supplied by the CLI composition root. */
  readonly dividendYield: number;
  /** Clock injection for generatedAt ONLY (architecture-boundaries §2 precedent) — never used as observedAt. */
  readonly now: () => Date;
};

// The 9 scored (weight > 0) rules — BreakdownCriterion's own closed enum, hand-listed the
// same way scoring.ts's own breakdown[] construction and its Zod mirror
// (packages/contracts/src/picker.ts's breakdownEntry) already do; there's no runtime array
// to derive this from without an unsafe cast off RULE_SET_METADATA's plain `string` id.
const ALL_CRITERIA: ReadonlyArray<BreakdownCriterion> = [
  "slope",
  "fwdEdge",
  "gexFit",
  "eventAdjustment",
  "beVsEm",
  "deltaNeutral",
  "thetaVega",
  "vrp",
  "debitFit",
];

// Fixed, not clock/random-derived: re-running over UNCHANGED replay data must reproduce an
// IDENTICAL report (bootstrap-ci.ts's own determinism contract) — a false "the numbers
// changed" alarm between two runs would undercut the report's own honesty framing.
const BOOTSTRAP_SEED = 1337;
const BOOTSTRAP_ITERATIONS = 2000;
const BOOTSTRAP_CONFIDENCE = 0.9;

const CAVEATS: ReadonlyArray<string> = [
  "late-solved-BSM optimism: leg_observations has no bsm_solved_at column, so an as-of-T chain read can show a value actually solved after that instant. The leakage-oracle replay reuses the stored picker_snapshot's frozen fields and is largely shielded; the hypothetical-entry replay (attribution/ablation input) is not.",
  "economic-events leakage: economic_events has no discoveredAt column, so the hypothetical-entry replay's event view reflects the CURRENT calendar, not necessarily what was known at each historical decision date. Low risk in practice — FOMC/CPI/NFP dates are published months ahead and are rarely rescheduled.",
  "13-trade magnitude band (BT-03): the shared haircut-fill model approximates the trader's real fills, so BT-03 reproduces DIRECTION as a hard check and MAGNITUDE only within a 3x tolerance band. A 'direction-only' trade agrees in sign but its modeled |P&L| fell outside 3x of the oracle |P&L| — the direction signal holds, the magnitude does not.",
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mean(values: ReadonlyArray<number>): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** score-desc, id-asc tiebreak — mirrors computePickerSnapshot.ts's rankAndCapCandidates tie-break, uncapped. */
function sortedByScore(outcomes: ReadonlyArray<HypotheticalCandidateOutcome>): ReadonlyArray<HypotheticalCandidateOutcome> {
  return [...outcomes].sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
}

function ciRow(metric: string, samples: ReadonlyArray<number>): BootstrapCiRow {
  const result = bootstrapCi(samples, BOOTSTRAP_SEED, BOOTSTRAP_ITERATIONS, BOOTSTRAP_CONFIDENCE);
  return { metric, low: result.low, high: result.high, n: result.n };
}

export function makeRunBacktestUseCase(deps: RunBacktestDeps) {
  return async (params: RunBacktestParams): Promise<Result<BacktestReport, StorageError>> => {
    const cohortsResult = await deps.readPickerSnapshotsInRange(params.from, params.to);
    if (!cohortsResult.ok) return cohortsResult;
    const cohorts = cohortsResult.value;

    // ─── BT-02 leakage oracle + BT-04 baseline hypothetical-entry (one pass per cohort) ──
    const mismatches: CohortMismatch[] = [];
    const baselineByCohort = new Map<StoredPickerSnapshotRow, ReadonlyArray<HypotheticalCandidateOutcome>>();
    const allBaselineOutcomes: HypotheticalCandidateOutcome[] = [];
    const coverageCohorts: CoverageCohort[] = [];

    for (const cohort of cohorts) {
      const mismatchResult = await replayPickerCohort(cohort, {
        readChainAsOf: deps.readChainAsOf,
        readDailySpotClosesAsOf: deps.readDailySpotClosesAsOf,
        rate: deps.rate,
        dividendYield: deps.dividendYield,
      });
      if (!mismatchResult.ok) return mismatchResult;
      mismatches.push(...mismatchResult.value);

      const baselineResult = await replayHypotheticalEntry(cohort, {
        readChainAsOf: deps.readChainAsOf,
        readEconomicEvents: deps.readEconomicEvents,
        readDailySpotClosesAsOf: deps.readDailySpotClosesAsOf,
        rate: deps.rate,
        dividendYield: deps.dividendYield,
      });
      if (!baselineResult.ok) return baselineResult;
      baselineByCohort.set(cohort, baselineResult.value);
      allBaselineOutcomes.push(...baselineResult.value);
      coverageCohorts.push({ date: isoDate(cohort.observedAt), isGap: baselineResult.value.length === 0 });
    }

    // ─── BT-03 13-trade oracle (every closed calendar, optionally narrowed to one) ─────────
    const closedResult = await deps.listCalendars("closed");
    if (!closedResult.ok) return closedResult;
    const closedCalendars: ReadonlyArray<Calendar> =
      params.calendarId === undefined ? closedResult.value : closedResult.value.filter((c) => c.id === params.calendarId);

    const tradeReproductions: TradeReproduction[] = [];
    for (const calendar of closedCalendars) {
      const tradeResult = await replayExitsForCalendar(calendar, {
        readFullSnapshotHistoryForCalendar: deps.readFullSnapshotHistoryForCalendar,
        readCalendarEvents: deps.readCalendarEvents,
        readChainAsOf: deps.readChainAsOf,
      });
      if (!tradeResult.ok) return tradeResult;
      tradeReproductions.push(tradeResult.value);
    }

    // ─── BT-04 per-rule directional attribution (median-split on the baseline breakdown) ──
    const attribution: DirectionalAttributionRow[] = ALL_CRITERIA.map((ruleId) => {
      const samples: AttributionSample[] = [];
      for (const outcome of allBaselineOutcomes) {
        const entry = outcome.breakdown.find((b) => b.criterion === ruleId);
        if (entry !== undefined) samples.push({ metric: entry.rawValue, outcome: outcome.simulatedPnl });
      }
      const result = directionalAttribution(samples);
      const sign: DirectionalAttributionRow["sign"] =
        result.verdict === "yes" ? "positive" : result.verdict === "no" ? "negative" : "insufficient";
      return { ruleId, sign, n: result.n };
    });

    // ponytail: one extra replayHypotheticalEntry pass per (cohort, rule) — O(cohorts × 9)
    // replay passes, each re-reading chain/events/closes. Correct and simple; batch/cache the
    // as-of-T reads across rules if a wide --from/--to range makes this the bottleneck.
    const ablation: AblationRow[] = [];
    for (const ruleId of ALL_CRITERIA) {
      const rankDeltas: number[] = [];
      const outcomeDeltas: number[] = [];
      for (const cohort of cohorts) {
        const baseline = baselineByCohort.get(cohort);
        assertDefined(baseline, "runBacktest: baseline outcomes missing for an already-replayed cohort");
        if (baseline.length === 0) continue; // gap cohort — nothing to ablate

        const ablatedResult = await replayHypotheticalEntry(
          cohort,
          {
            readChainAsOf: deps.readChainAsOf,
            readEconomicEvents: deps.readEconomicEvents,
            readDailySpotClosesAsOf: deps.readDailySpotClosesAsOf,
            rate: deps.rate,
            dividendYield: deps.dividendYield,
          },
          { [ruleId]: 0 },
        );
        if (!ablatedResult.ok) return ablatedResult;
        const ablated = ablatedResult.value;

        const baselineRankedIds = sortedByScore(baseline).map((o) => o.candidateId);
        const ablatedRankedIds = sortedByScore(ablated).map((o) => o.candidateId);
        for (const candidateId of baselineRankedIds) {
          const delta = ablationDelta(baselineRankedIds, ablatedRankedIds, candidateId);
          if (delta !== null) rankDeltas.push(delta);
        }

        const baselineTop = sortedByScore(baseline)[0];
        const ablatedTop = sortedByScore(ablated)[0];
        if (baselineTop !== undefined && ablatedTop !== undefined) {
          outcomeDeltas.push(ablatedTop.simulatedPnl - baselineTop.simulatedPnl);
        }
      }
      ablation.push({ ruleId, rankDelta: mean(rankDeltas), outcomeDelta: mean(outcomeDeltas), n: rankDeltas.length });
    }

    // ─── Bootstrap CI on three headline P&L samples (BT-04) ────────────────────────────────
    const ci: BootstrapCiRow[] = [
      ciRow("trade-reproduction-modeled-pnl", tradeReproductions.map((t) => t.modeledPnl)),
      ciRow("trade-reproduction-oracle-pnl", tradeReproductions.map((t) => t.oraclePnl)),
      ciRow("hypothetical-simulated-pnl", allBaselineOutcomes.map((o) => o.simulatedPnl)),
    ];

    // ─── Gap-excluded coverage ──────────────────────────────────────────────────────────────
    const coverageResult = coveragePercent(coverageCohorts);
    const coverage: CoverageDay[] = [...coverageResult.perDay, coverageResult.overall].map((d) => ({
      date: d.date,
      expectedCohorts: d.total,
      observedCohorts: d.replayed,
      coveragePct: d.coveragePct,
    }));

    const report: BacktestReport = {
      generatedAt: deps.now().toISOString(),
      fromDate: isoDate(params.from),
      toDate: isoDate(params.to),
      n: cohorts.length,
      mismatches,
      tradeReproductions,
      attribution,
      ablation,
      coverage,
      caveats: CAVEATS,
      ci,
    };

    const persistResult = await deps.persistBacktestRun({
      params: { from: report.fromDate, to: report.toDate, calendarId: params.calendarId ?? null },
      report,
    });
    if (!persistResult.ok) return persistResult;

    return ok(report);
  };
}
