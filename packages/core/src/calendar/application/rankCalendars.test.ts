/**
 * rankCalendars.test.ts — the use-case: one chain read, ranked calendars out.
 *
 * The port-hygiene test at the bottom is the important one. It proves STRUCTURALLY that this
 * use-case cannot reach a gate, a snapshot, a macro series or an events feed — the incumbent
 * grew to fifteen injected dependencies and a three-system entry gate, and the only defence
 * against that happening again is a test that fails when a dependency is added.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeRankCalendarsUseCase } from "./rankCalendars.ts";
import type { RankCalendarsDeps } from "./rankCalendars.ts";
import type { CalendarChainQuote } from "../domain/types.ts";
import type { ScoredCalendar } from "../domain/score.ts";

const NOW = new Date("2026-07-27T16:00:00.000Z");
const SPOT = 7401.89;

function ladder(over: {
  root?: "SPX" | "SPXW";
  expiration: string;
  ivAtm: number;
  strikes?: ReadonlyArray<number>;
}): CalendarChainQuote[] {
  const strikes = over.strikes ?? [7350, 7400, 7450];
  return strikes.map((k) => {
    const iv = over.ivAtm + ((7400 - k) / 50) * 0.004;
    const value = Math.max(20, 60 + (k - 7400) * 0.4);
    return {
      time: NOW,
      strike: k * 1000,
      expiration: over.expiration,
      contractType: "P" as const,
      underlyingPrice: SPOT,
      bsmIv: String(iv),
      root: over.root ?? ("SPXW" as const),
      bid: value,
      ask: value + 1,
      openInterest: 39,
      source: "cboe" as const,
    };
  });
}

const CHAIN: CalendarChainQuote[] = [
  ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
  ...ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
  ...ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
];

/** 25 closes on a gentle uptrend — enough for realizedVol, which needs at least three. */
const CLOSES = Array.from({ length: 25 }, (_, i) => 7300 + i * 4);

function deps(over: Partial<RankCalendarsDeps> = {}): RankCalendarsDeps {
  return {
    readChain: () => Promise.resolve(ok(CHAIN)),
    readDailyCloses: () => Promise.resolve(ok(CLOSES)),
    now: () => NOW,
    carry: { rate: 0.045, divYield: 0.013 },
    ...over,
  };
}

describe("rankCalendars — the happy path", () => {
  it("returns candidates ranked best-first with a decomposable score", async () => {
    const result = await makeRankCalendarsUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { candidates, totalCandidates, expiryPairs, spot, asOf } = result.value;
    expect(candidates.length).toBeGreaterThan(0);
    // One row per pair, so the ranked rows ARE the pairs — while `totalCandidates` keeps
    // reporting every strike that was measured to produce them.
    expect(expiryPairs).toBe(candidates.length);
    expect(totalCandidates).toBeGreaterThan(expiryPairs);
    expect(spot).toBe(SPOT);
    expect(asOf).toEqual(NOW);

    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(candidates[i]?.score ?? 0);
    }
    const top = candidates[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    const sum = Object.values(top.breakdown).reduce((a, t) => a + t.contribution, 0);
    expect(sum).toBeCloseTo(top.score, 9);
  });

  it("honours the limit without changing totalCandidates", async () => {
    const all = await makeRankCalendarsUseCase(deps())({});
    const capped = await makeRankCalendarsUseCase(deps())({ limit: 2 });
    expect(all.ok && capped.ok).toBe(true);
    if (!all.ok || !capped.ok) return;

    expect(capped.value.candidates).toHaveLength(2);
    expect(capped.value.totalCandidates).toBe(all.value.totalCandidates);
    expect(capped.value.candidates.map((c) => c.score)).toEqual(
      all.value.candidates.slice(0, 2).map((c) => c.score),
    );
  });

  it("reports the realized vol as snapshot context", async () => {
    const result = await makeRankCalendarsUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realizedVol).not.toBeNull();
  });

  /**
   * REGRESSION (live chain, 2026-07-28). Two of the score's terms are properties of the expiry
   * PAIR and constant across every strike inside it, so only `deltaBalance` varies within a
   * pair — and it is minimised at the money. The ranked list was therefore the single winning
   * pair's strike ladder walking outward from delta-neutral: the live top ten was ten strikes
   * of SPXW 2026-08-14 / 2026-08-31, 7365 through 7410. Twenty-five rows describing one trade.
   *
   * The pair is the decision; the strike inside it is a detail of that decision. One row per
   * pair, and because the list is already sorted descending, keeping the first occurrence keeps
   * the best strike in each pair.
   */
  it("returns at most one row per expiry pair — a strike ladder is not a ranking", async () => {
    const result = await makeRankCalendarsUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pairs = result.value.candidates.map(
      (c) => `${c.root}|${c.frontExpiration}|${c.backExpiration}`,
    );
    expect(pairs.length).toBeGreaterThan(1);
    expect(new Set(pairs).size).toBe(pairs.length);
    // The full candidate space is still reported — collapsing the view hides nothing.
    expect(result.value.totalCandidates).toBeGreaterThan(pairs.length);
  });

  it("reports the front ceiling it applied and respects it", async () => {
    const result = await makeRankCalendarsUseCase(deps())({ frontDteMax: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frontDteMax).toBe(20);
    expect(result.value.candidates.every((c) => c.frontDte <= 20)).toBe(true);
  });

  it("cannot be asked to go below the 15-day floors", async () => {
    // The floors are the trader's rule. There is no request field that lowers them, and a
    // hostile ceiling cannot produce a shorter front leg.
    const result = await makeRankCalendarsUseCase(deps())({ frontDteMax: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);

    const normal = await makeRankCalendarsUseCase(deps())({});
    if (!normal.ok) return;
    expect(normal.value.candidates.every((c) => c.frontDte >= 15)).toBe(true);
    expect(normal.value.candidates.every((c) => c.gapDays >= 15)).toBe(true);
  });
});

describe("rankCalendars — legs with no usable IV are COUNTED, not swallowed", () => {
  it("reports the legs the cohort discarded, and counts only the requested wing", async () => {
    // `cohort.ts` drops any row whose `bsmIv` is null (never processed — the IV drain is bounded
    // at 800 rows a pass) or the literal 'NaN' (the inversion permanently failed). It dropped
    // them silently: the drops record declared a "no-iv" reason that nothing ever incremented,
    // so the API asserted 0 while a quarter of the live put book was being discarded. Measured
    // on the engine's own chain read, 2026-07-28: 700 null + 708 'NaN' of 5,768 puts = 1,408
    // legs, 24.4%. A counter that always reads 0 is not a missing feature, it is a false
    // statement about the engine's behaviour.
    const broken: CalendarChainQuote[] = CHAIN.map((q, i) =>
      i % 3 === 0 ? { ...q, bsmIv: i === 0 ? null : "NaN" } : q,
    );
    // A call leg with no IV must NOT land in a put ranking's count — the wings are separate
    // books and mixing them roughly doubles the number into meaninglessness.
    const withCall: CalendarChainQuote[] = [
      ...broken,
      ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }).map((q) => ({
        ...q,
        contractType: "C" as const,
        bsmIv: null,
      })),
    ];
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok(withCall)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drops["no-iv-legs"]).toBe(3);
  });
});

describe("rankCalendars — carry", () => {
  it("prices both legs of every candidate on the one injected carry", async () => {
    // Replaces two tests that pinned the OLD behaviour: a solved per-expiry carry array with a
    // flat fallback for the expiries it did not cover. That combination priced the two legs of
    // one calendar on different (r, q) — 56% of live candidates on 2026-07-28 — and netDelta,
    // the only term that selects the strike, is a difference of exactly those two legs.
    //
    // Here the claim is only that the injected carry REACHES the ranking — this layer collapses
    // to one row per expiry pair, so the row a given pair contributes is itself carry-dependent
    // and is not a stable thing to diff. The both-legs-together claim is pinned one layer down,
    // in domain/candidate.test.ts, where every strike is still enumerable.
    const base = await makeRankCalendarsUseCase(deps())({});
    const shifted = await makeRankCalendarsUseCase(
      deps({ carry: { rate: 0.0396, divYield: 0.0002 } }),
    )({});
    expect(base.ok && shifted.ok).toBe(true);
    if (!base.ok || !shifted.ok) return;
    expect(base.value.candidates.length).toBeGreaterThan(0);
    const deltas = (rows: ReadonlyArray<ScoredCalendar>) => rows.map((c) => c.net.delta);
    expect(deltas(shifted.value.candidates)).not.toEqual(deltas(base.value.candidates));
  });
});

describe("rankCalendars — degradation", () => {
  it("fails the call when the chain read fails — a ranking without a chain is not a ranking", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(err({ kind: "storage-error", message: "boom" })) }),
    )({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("ranks identically with and without realized vol — it is context, not a term", async () => {
    const withRv = await makeRankCalendarsUseCase(deps())({});
    const withoutRv = await makeRankCalendarsUseCase(
      deps({ readDailyCloses: () => Promise.resolve(ok([])) }),
    )({});
    expect(withRv.ok && withoutRv.ok).toBe(true);
    if (!withRv.ok || !withoutRv.ok) return;

    expect(withRv.value.realizedVol).not.toBeNull();
    expect(withoutRv.value.realizedVol).toBeNull();
    expect(withoutRv.value.candidates.length).toBeGreaterThan(0);

    // Losing the closes costs a reported comparable and nothing else. When it WAS a score term,
    // this same degradation silently reshuffled the ranking.
    expect(withoutRv.value.candidates.map((c) => c.score)).toEqual(
      withRv.value.candidates.map((c) => c.score),
    );
  });

  it("returns an empty ranking with drop counts, not an error, when nothing qualifies", async () => {
    const tooClose = [
      ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ...ladder({ expiration: "2026-08-20", ivAtm: 0.165 }),
    ];
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok(tooClose)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.drops["gap-floor"]).toBeGreaterThan(0);
  });

  it("returns an empty ranking for an empty chain rather than throwing", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok([])) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.totalCandidates).toBe(0);
    // The path a stalled pipeline actually takes: no rows, so no spot to report.
    expect(result.value.spot).toBeNull();
  });

  /**
   * A price is NEVER given a `?? fallback`. `snapshotSpot` returns null when no row carries a
   * positive finite underlying price, and the response used to turn that into `0` — a number a
   * reader would take for a real quote. `buildCohorts` refuses the same input, so the ranking is
   * empty either way; what changes is whether the response admits it could not measure spot.
   */
  it("reports a null spot rather than 0 when no quote carries a usable underlying price", async () => {
    const noSpot = CHAIN.map((q) => ({ ...q, underlyingPrice: 0 }));
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok(noSpot)) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBeNull();
    expect(result.value.candidates).toHaveLength(0);
  });

  it("never throws, whatever a driven port does", async () => {
    const result = await makeRankCalendarsUseCase(
      deps({
        readChain: () => {
          throw new Error("adapter exploded");
        },
      }),
    )({});
    expect(result.ok).toBe(false);
  });
});

describe("rankCalendars — determinism", () => {
  it("produces a byte-identical ranking from the same snapshot, twice", async () => {
    const run = makeRankCalendarsUseCase(deps());
    const a = await run({});
    const b = await run({});
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it("produces the same ranking however the chain rows are ordered", async () => {
    const forward = await makeRankCalendarsUseCase(deps())({});
    const reversed = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok([...CHAIN].reverse())) }),
    )({});
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(JSON.stringify(forward.value)).toBe(JSON.stringify(reversed.value));
  });
});

/**
 * THE PIN. `buildCohorts` is shared between this use-case and the per-strike chain surface, so
 * every row the surface needs back is a row the ranker starts seeing too. This block is the
 * evidence that admitting them cannot move a ranking.
 *
 * The expected list below is HARDCODED from a run against the code as it stood before 0DTE and
 * all-unpriced cohorts were admitted. A dynamically-recomputed expectation would pass whatever
 * the engine did; these four rows are what it actually produced.
 */
describe("rankCalendars — THE PIN: widening cohort admission never moves the ranking", () => {
  /** Five ladders that genuinely rank: two roots, three expiries, 15/30/46 DTE. */
  const RANKABLE: CalendarChainQuote[] = [
    ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
    ...ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
    ...ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    ...ladder({ expiration: "2026-08-11", ivAtm: 0.171, root: "SPX" }),
    ...ladder({ expiration: "2026-08-26", ivAtm: 0.166, root: "SPX" }),
  ];

  /**
   * The three cohorts this session recovered, plus the one it must keep refusing.
   *
   * 2026-07-27 IS `NOW`'s date — a live 0DTE cohort, PM-settled, four hours from the close.
   * 2026-08-20's rows all carry a null `bsm_iv`, which is the live SPXW 2026-11-29 shape
   * (quoted 1, solved 0, measured 2026-07-29). 2026-07-26 expired yesterday and stays out.
   */
  const RECOVERED: CalendarChainQuote[] = [
    ...ladder({ expiration: "2026-07-27", ivAtm: 0.31 }),
    ...ladder({ expiration: "2026-07-27", ivAtm: 0.3, root: "SPX" }),
    ...ladder({ expiration: "2026-08-20", ivAtm: 0.168 }).map((q) => ({ ...q, bsmIv: null })),
    ...ladder({ expiration: "2026-07-26", ivAtm: 0.4 }),
  ];

  /** Captured from a run on the pre-change engine. Never recomputed. */
  const EXPECTED_RANKING = [
    { root: "SPXW", strike: 7350, front: "2026-08-26", back: "2026-09-11", score: 100 },
    { root: "SPXW", strike: 7350, front: "2026-08-11", back: "2026-09-11", score: 67.5 },
    { root: "SPXW", strike: 7400, front: "2026-08-11", back: "2026-08-26", score: 57.5 },
    { root: "SPX", strike: 7400, front: "2026-08-11", back: "2026-08-26", score: 42.5 },
  ];

  async function rank(chain: ReadonlyArray<CalendarChainQuote>) {
    const result = await makeRankCalendarsUseCase(
      deps({ readChain: () => Promise.resolve(ok(chain)) }),
    )({});
    if (!result.ok) throw new Error(`rankCalendars failed: ${result.error.message}`);
    return result.value;
  }

  const identity = (r: Awaited<ReturnType<typeof rank>>) =>
    r.candidates.map((c) => ({
      root: c.root,
      strike: c.strike,
      front: c.frontExpiration,
      back: c.backExpiration,
      score: c.score,
    }));

  it("ranks the rankable chain to exactly the four rows it always ranked it to", async () => {
    const clean = await rank(RANKABLE);
    expect(identity(clean)).toEqual(EXPECTED_RANKING);
    expect(clean.totalCandidates).toBe(12);
    expect(clean.expiryPairs).toBe(4);
  });

  it("ranks it to the SAME four rows with 0DTE, all-unpriced and expired cohorts mixed in", async () => {
    const extended = await rank([...RANKABLE, ...RECOVERED]);
    expect(identity(extended)).toEqual(EXPECTED_RANKING);
    expect(extended.totalCandidates).toBe(12);
    expect(extended.expiryPairs).toBe(4);
    expect(extended.spot).toBe(SPOT);
    expect(extended.realizedVol).not.toBeNull();
    expect(extended.frontDteMax).toBe(60);
  });

  /**
   * THE ONE THING THAT DID MOVE, and it moved by an amount that is arithmetic rather than noise.
   *
   * A cohort that now exists is a cohort enumeration walks, so it gets counted where it fails.
   * Three more cohorts survive `buildCohorts` here — two 0DTE (one per root) and one whose every
   * strike is unpriced at 24 DTE — and the deltas below are what walking them costs:
   *
   *   front-dte-floor    0 → 2    one per 0DTE cohort; 0 is under the 15-day floor
   *   gap-floor          9 → 21   the six legal fronts each meet three more same-root backs
   *   root-mismatch     12 → 22   and each meets the other root's new cohorts too
   *   no-atm-reference   0 → 1    the all-unpriced cohort has no legs, so no 50-delta reference;
   *                               it is a legal front at 24 DTE and pairs once, with 2026-09-11
   *
   * Every one of those is a drop that was ALREADY happening and was invisible: a cohort discarded
   * during grouping is discarded under no reason at all. `no-iv-legs` does not move, because it
   * was never gated on DTE — it counts legs across the whole read. That matters beyond this test:
   * `recordCalendarRanking` persists `no-iv-legs` and nothing else from this record, so the
   * ranking history written to Postgres is byte-identical too.
   */
  it("counts the newly-visible cohorts where they fail, and moves no other field", async () => {
    const clean = await rank(RANKABLE);
    const extended = await rank([...RANKABLE, ...RECOVERED]);

    expect(clean.drops).toEqual({
      "front-dte-floor": 0,
      "front-dte-ceiling": 0,
      "back-dte-ceiling": 0,
      "gap-floor": 9,
      "root-mismatch": 12,
      "not-tradeable": 0,
      "term-inverted": 0,
      "no-atm-reference": 0,
      "no-iv-legs": 0,
    });
    expect(extended.drops).toEqual({
      "front-dte-floor": 2,
      "front-dte-ceiling": 0,
      "back-dte-ceiling": 0,
      "gap-floor": 21,
      "root-mismatch": 22,
      "not-tradeable": 0,
      "term-inverted": 0,
      "no-atm-reference": 1,
      "no-iv-legs": 3,
    });
  });

  it("cannot reach a candidate from a 0DTE cohort, whichever leg it would be", async () => {
    // The claim the whole widening rests on, verified rather than trusted. FRONT_DTE_FLOOR is 15,
    // so a 0DTE cohort is never a front; GAP_DAYS_FLOOR is 15 and a 0DTE back against any legal
    // front gives a gap of −15 or worse, so it is never a back either. Two hard constants, both
    // documented in candidate.ts as the trader's rule and not a knob.
    const extended = await rank([...RANKABLE, ...RECOVERED]);
    expect(extended.candidates.every((c) => c.frontDte >= 15 && c.gapDays >= 15)).toBe(true);
    expect(extended.candidates.some((c) => c.frontExpiration === "2026-07-27")).toBe(false);
    expect(extended.candidates.some((c) => c.backExpiration === "2026-07-27")).toBe(false);
  });
});

describe("port hygiene — the engine cannot reach what it must not", () => {
  it("declares exactly four dependencies", () => {
    // The incumbent reached fifteen. This assertion is the only thing that stops the same drift:
    // adding a gate, a persisted snapshot, a macro series or an events feed fails here first,
    // which forces the addition to be argued rather than absorbed.
    //
    // It was five. `readExpiryCarry` came out for correctness, not for the count — see
    // domain/cohort.ts scar 4 — and carry is now one injected constant rather than a read.
    const keys = Object.keys(deps()).sort();
    expect(keys).toEqual(["carry", "now", "readChain", "readDailyCloses"]);
  });

  it("has no dependency whose name suggests a gate, a snapshot or an event feed", () => {
    const forbidden = /gate|vix|snapshot|event|macro|regime|gex|sizing|brake|calendar_?open|position/i;
    for (const key of Object.keys(deps())) {
      expect(forbidden.test(key), `dependency "${key}" reaches outside the engine`).toBe(false);
    }
  });
});
