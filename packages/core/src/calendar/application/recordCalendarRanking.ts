/**
 * recordCalendarRanking.ts — rank one cohort, then append it to the ranking history.
 *
 * Hexagon law (architecture-boundaries §5): a factory returning the driver port. Two
 * dependencies, and one of them is the ranking use-case itself.
 *
 * IT COMPOSES `rankCalendars`, IT DOES NOT CHANGE IT. That file's header says it "never throws
 * and never persists", and its port-hygiene test pins four dependencies precisely so a persisted
 * snapshot cannot be absorbed back into it. Both statements stay true: the ranking is still pure
 * and still computed on read; this use-case is a second, separate caller that happens to keep
 * what it gets.
 *
 * WHY IT EXISTS AT ALL. `SCORE_WEIGHTS` is fwdEdge 70 / deltaBalance 30 and `score.ts` requires
 * those to be "re-derived against a backtest, never adjusted by feel". The only corpus that
 * exists today is `picker_snapshot`, which belongs to the engine being retired. Until this runs,
 * every day is a day added before the weights can be checked.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ScoredCalendar } from "../domain/score.ts";
import type {
  CalendarRankingRow,
  ForPersistingCalendarRanking,
  ForRankingCalendars,
  ForRecordingCalendarRanking,
  RecordedRanking,
  StorageError,
} from "./ports.ts";

/**
 * The wing recorded. Puts, matching the engine's own default and the book actually traded.
 *
 * It rides on every row and in the conflict key, so ranking the call wing later is a second
 * call at the same instant — never a migration. See `CalendarRankingRow.contractType`.
 */
const RECORDED_CONTRACT_TYPE = "P";

/**
 * Rows asked for, which is a CEILING and not a selection.
 *
 * Measured live 2026-07-28: 2,981 candidates collapsing to 96 expiry pairs in one cycle, 48
 * cycles a day. Storing all 96 is ~4,600 rows a day against `leg_observations`' measured
 * 824,198 — 0.56% of what already lands daily. Storing the top 25 instead would save 0.4% of a
 * day's rows and truncate the cross-section at the 74th percentile, and a score whose every term
 * is a percentile is a claim about the ORDERING OF THE WHOLE SNAPSHOT: the calendars that ranked
 * badly and then did badly are where the weights get falsified. So the whole ranking is kept.
 *
 * 200 is roughly double the measured pair count. It exists to bound one write, not to select —
 * `RecordedRanking.expiryPairs` is reported next to `rowsWritten` so a cap that ever starts
 * biting is visible to the caller rather than silently reintroducing the top-N this rejects. At
 * 200 rows × 20 columns the insert binds 4,000 parameters, 6% of Postgres's 65,534 limit, so it
 * is one statement with no chunking.
 */
const PERSIST_LIMIT = 200;

export type RecordCalendarRankingDeps = {
  /** The ranking use-case, unmodified. */
  readonly rankCalendars: ForRankingCalendars;
  readonly persistRanking: ForPersistingCalendarRanking;
};

export function makeRecordCalendarRankingUseCase(
  deps: RecordCalendarRankingDeps,
): ForRecordingCalendarRanking {
  return async (): Promise<Result<RecordedRanking, StorageError>> => {
    const result = await deps.rankCalendars({
      limit: PERSIST_LIMIT,
      contractType: RECORDED_CONTRACT_TYPE,
    });
    if (!result.ok) return err(result.error);
    const ranking = result.value;

    // NOTHING TO STORE IS NOT AN EMPTY WRITE. `rankCalendars` seeds its `asOf` reduce with
    // `new Date(0)`, so an empty cohort would stamp every row 1970-01-01 — and there is no row
    // to stamp anyway, because `buildCohorts` returns [] whenever spot is unmeasurable. Bailing
    // here also keeps the adapter off Drizzle's `.values([])`, which throws.
    if (ranking.candidates.length === 0) {
      return ok({ rowsWritten: 0, expiryPairs: ranking.expiryPairs });
    }

    const rows = ranking.candidates.map((candidate, index) =>
      toRow(candidate, {
        asOf: ranking.asOf,
        spot: ranking.spot,
        noIvLegs: ranking.drops["no-iv-legs"],
        rank: index + 1,
      }),
    );

    const written = await deps.persistRanking(rows);
    if (!written.ok) return err(written.error);
    return ok({ rowsWritten: rows.length, expiryPairs: ranking.expiryPairs });
  };
}

/** Per-cycle context, identical on every row of one write. */
type CycleContext = {
  readonly asOf: Date;
  readonly spot: number | null;
  readonly noIvLegs: number;
  readonly rank: number;
};

function toRow(candidate: ScoredCalendar, cycle: CycleContext): CalendarRankingRow {
  return {
    asOf: cycle.asOf,
    root: candidate.root,
    contractType: RECORDED_CONTRACT_TYPE,
    frontExpiration: candidate.frontExpiration,
    backExpiration: candidate.backExpiration,
    strike: candidate.strike,
    rank: cycle.rank,
    score: candidate.score,
    // `raw` is the REPORTED value, which for deltaBalance is the signed net delta rather than
    // the negated quantity the ranking sorts on — that is the number a reader recognises.
    fwdEdgeRaw: candidate.breakdown.fwdEdge.raw,
    fwdEdgePercentile: candidate.breakdown.fwdEdge.percentile,
    deltaBalanceRaw: candidate.breakdown.deltaBalance.raw,
    deltaBalancePercentile: candidate.breakdown.deltaBalance.percentile,
    fwdIv: candidate.fwdIv,
    frontRefIv: candidate.frontRefIv,
    backRefIv: candidate.backRefIv,
    debit: candidate.debit,
    netTheta: candidate.net.theta,
    netVega: candidate.net.vega,
    spot: cycle.spot,
    noIvLegs: cycle.noIvLegs,
  };
}
