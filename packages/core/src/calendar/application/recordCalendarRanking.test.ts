/**
 * recordCalendarRanking.test.ts — the use-case that gives the engine a history.
 *
 * The tests that matter are the two the repo has been burned on: the row is stamped with the
 * cohort's own `asOf` and never the clock, and an empty ranking writes nothing at all (an empty
 * cohort stamps `new Date(0)` — the reduce's seed — and Drizzle throws on `.values([])`).
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeRecordCalendarRankingUseCase } from "./recordCalendarRanking.ts";
import type { RecordCalendarRankingDeps } from "./recordCalendarRanking.ts";
import type { CalendarRanking, CalendarRankingRow } from "./ports.ts";
import type { ScoredCalendar } from "../domain/score.ts";
import type { CohortLeg, DropCounts } from "../domain/types.ts";

const AS_OF = new Date("2026-07-28T18:00:22.000Z");
/** Deliberately far from `asOf`: any row carrying this instant is stamped by the clock. */
const CLOCK = new Date("2026-07-28T18:14:01.000Z");

const NO_DROPS: DropCounts = {
  "front-dte-floor": 0,
  "front-dte-ceiling": 0,
  "back-dte-ceiling": 0,
  "gap-floor": 0,
  "root-mismatch": 0,
  "not-tradeable": 0,
  "no-iv-legs": 853,
  "term-inverted": 0,
  "no-atm-reference": 0,
};

function leg(strike: number): CohortLeg {
  return {
    strike,
    iv: 0.1547,
    bid: 78.8,
    ask: 79.2,
    mid: 79,
    openInterest: 200,
    extrinsic: 79,
    delta: -0.4324,
    gamma: 0.00158,
    theta: -2.5693,
    vega: 6.3162,
    tradeable: true,
  };
}

function scored(over: {
  strike: number;
  frontExpiration: string;
  backExpiration: string;
  score: number;
}): ScoredCalendar {
  return {
    root: "SPXW",
    strike: over.strike,
    frontExpiration: over.frontExpiration,
    backExpiration: over.backExpiration,
    frontDte: 17,
    backDte: 34,
    gapDays: 17,
    fwdIv: 0.1377,
    cushion: 0.00466,
    ffAtm: 0.06648,
    slope: -0.09658,
    frontRefIv: 0.14693,
    backRefIv: 0.14243,
    ffStrike: 0.05929,
    hSkew: 0.004257,
    vSkewFront: 0.004661,
    vSkewBack: 0.003587,
    frontIv: 0.15473,
    backIv: 0.15047,
    net: { delta: -0.00087, gamma: -0.00043, theta: 0.8959, vega: 2.6046 },
    thetaCarry: 0.017495,
    debit: 32.494,
    spreadCost: 0.9,
    frontLeg: leg(over.strike),
    backLeg: leg(over.strike),
    score: over.score,
    breakdown: {
      fwdEdge: { raw: 0.06648, percentile: 100, weight: 70, contribution: 70 },
      deltaBalance: { raw: -0.00087, percentile: 98.65, weight: 30, contribution: 29.59 },
    },
  };
}

const CANDIDATES: ReadonlyArray<ScoredCalendar> = [
  scored({ strike: 7405, frontExpiration: "2026-08-14", backExpiration: "2026-08-31", score: 99.5 }),
  scored({ strike: 7410, frontExpiration: "2026-08-13", backExpiration: "2026-08-31", score: 98.4 }),
];

function ranking(over: Partial<CalendarRanking> = {}): CalendarRanking {
  return {
    asOf: AS_OF,
    spot: 7431.81,
    candidates: CANDIDATES,
    totalCandidates: 2981,
    expiryPairs: CANDIDATES.length,
    drops: NO_DROPS,
    realizedVol: 0.0851,
    frontDteMax: 60,
    ...over,
  };
}

/** Captures what the use-case handed the driven port. */
function harness(over: { ranking?: CalendarRanking } = {}): {
  readonly deps: RecordCalendarRankingDeps;
  readonly written: CalendarRankingRow[][];
  readonly requests: unknown[];
} {
  const written: CalendarRankingRow[][] = [];
  const requests: unknown[] = [];
  const deps: RecordCalendarRankingDeps = {
    rankCalendars: (request) => {
      requests.push(request);
      return Promise.resolve(ok(over.ranking ?? ranking()));
    },
    persistRanking: (rows) => {
      written.push([...rows]);
      return Promise.resolve(ok(undefined));
    },
  };
  return { deps, written, requests };
}

describe("recordCalendarRanking — what one cycle stores", () => {
  it("writes one row per ranked pair, ranked 1-based in the engine's own order", async () => {
    const { deps, written } = harness();
    const result = await makeRecordCalendarRankingUseCase(deps)();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ rowsWritten: 2, expiryPairs: 2 });

    const rows = written[0];
    expect(rows).toBeDefined();
    if (rows === undefined) return;
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows.map((r) => r.frontExpiration)).toEqual(["2026-08-14", "2026-08-13"]);
  });

  it("stamps the cohort's asOf, never the clock", async () => {
    const { deps, written } = harness();
    await makeRecordCalendarRankingUseCase(deps)();

    const rows = written[0] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.asOf).toEqual(AS_OF);
      expect(row.asOf.getTime()).not.toBe(CLOCK.getTime());
    }
  });

  it("carries the score, both terms and the entry price the reader would have paid", async () => {
    const { deps, written } = harness();
    await makeRecordCalendarRankingUseCase(deps)();

    const row = (written[0] ?? [])[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.score).toBe(99.5);
    expect(row.fwdEdgeRaw).toBe(0.06648);
    expect(row.fwdEdgePercentile).toBe(100);
    // SIGNED net delta — the reported value, not the negated one the ranking sorts on.
    expect(row.deltaBalanceRaw).toBe(-0.00087);
    expect(row.deltaBalancePercentile).toBe(98.65);
    expect(row.debit).toBe(32.494);
    expect(row.fwdIv).toBe(0.1377);
    expect(row.frontRefIv).toBe(0.14693);
    expect(row.backRefIv).toBe(0.14243);
    expect(row.netTheta).toBe(0.8959);
    expect(row.netVega).toBe(2.6046);
    expect(row.spot).toBe(7431.81);
    expect(row.root).toBe("SPXW");
    expect(row.strike).toBe(7405);
  });

  it("carries the cohort's unsolved-leg count, which no later replay can recover", async () => {
    const { deps, written } = harness();
    await makeRecordCalendarRankingUseCase(deps)();

    const row = (written[0] ?? [])[0];
    expect(row?.noIvLegs).toBe(853);
  });

  it("ranks the put wing and stamps that wing on every row", async () => {
    const { deps, written, requests } = harness();
    await makeRecordCalendarRankingUseCase(deps)();

    expect(requests[0]).toMatchObject({ contractType: "P" });
    for (const row of written[0] ?? []) expect(row.contractType).toBe("P");
  });
});

describe("recordCalendarRanking — what it refuses to store", () => {
  it("writes NOTHING when the ranking is empty", async () => {
    // An empty cohort makes `asOf` the reduce's own seed, 1970-01-01, and Drizzle throws on
    // `.values([])`. Both are avoided by not calling the port at all.
    const { deps, written } = harness({
      ranking: ranking({ candidates: [], expiryPairs: 0, asOf: new Date(0), spot: null }),
    });
    const result = await makeRecordCalendarRankingUseCase(deps)();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ rowsWritten: 0, expiryPairs: 0 });
    expect(written.length).toBe(0);
  });

  it("propagates a ranking failure without writing", async () => {
    const written: CalendarRankingRow[][] = [];
    const result = await makeRecordCalendarRankingUseCase({
      rankCalendars: () => Promise.resolve(err({ kind: "storage-error", message: "chain down" })),
      persistRanking: (rows) => {
        written.push([...rows]);
        return Promise.resolve(ok(undefined));
      },
    })();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("chain down");
    expect(written.length).toBe(0);
  });

  it("propagates a persistence failure", async () => {
    const result = await makeRecordCalendarRankingUseCase({
      rankCalendars: () => Promise.resolve(ok(ranking())),
      persistRanking: () => Promise.resolve(err({ kind: "storage-error", message: "write down" })),
    })();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("write down");
  });
});

describe("recordCalendarRanking — the whole cross-section, or the caller is told", () => {
  it("reports expiryPairs alongside rowsWritten so a truncated write is visible", async () => {
    // 96 pairs measured live on 2026-07-28; the cap is 200. A cap that starts truncating turns
    // the stored history into a top-N sample, which is the one thing a percentile-scored engine
    // cannot be validated against — so the caller is handed both numbers, every cycle.
    const { deps } = harness({ ranking: ranking({ expiryPairs: 250 }) });
    const result = await makeRecordCalendarRankingUseCase(deps)();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiryPairs).toBe(250);
    expect(result.value.rowsWritten).toBe(2);
  });

  it("asks for enough rows to cover every pair the engine finds", async () => {
    const { deps, requests } = harness();
    await makeRecordCalendarRankingUseCase(deps)();

    const request = requests[0];
    expect(request).toBeDefined();
    // 200 against a measured 96 — the whole ranking, with headroom, and no silent top-N.
    expect(request).toMatchObject({ limit: 200 });
  });
});
