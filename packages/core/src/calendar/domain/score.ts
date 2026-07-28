/**
 * score.ts — the four-term cross-sectional score.
 *
 * Hexagon law (architecture-boundaries §2): pure. No clock, no I/O.
 *
 * WHY EVERY TERM IS A PERCENTILE AND NOT A THRESHOLD. The doctrine publishes absolute gates —
 * a Forward Factor of 16–20% to take a calendar, a cushion of 17 vol points, a fair-value edge
 * of 3 vol points. Every one of them is calibrated on single names and sector ETFs at 60–105%
 * implied vol. SPX runs at 16%, and dispersion scales with the level. Measured across all 2,465
 * candidates in a live snapshot: the maximum Forward Factor was 14.4%, the median 0.36%, and the
 * 16% gate fired ZERO times. The cushion's median was +0.02 vol points against his 17.
 *
 * An engine built on his constants returns an empty list every day and looks like it is
 * working. So the engine ranks candidates against each other within the snapshot — which is
 * the same relative-value frame he uses everywhere else, needs no history at all, and is
 * exactly reproducible from one chain read.
 *
 * The cost of that choice, stated plainly: a rank says which calendar is the best one available
 * today. It does NOT say whether that calendar is good. The raw value rides along in every
 * breakdown term so the reader can make that second judgement themselves, and the doctrine's
 * own absolute bars are the right yardstick for it once there is enough history to band them.
 *
 * WHAT IS NOT HERE, and why:
 *   - Net vega. Root-time flat: short-dated IV moves as 1/√T while vega grows as √T, so
 *     vega × Δσ is roughly constant across the curve. Ranking it ranks nothing. This is the one
 *     prohibition the corpus states outright.
 *   - Net theta, raw OR normalised by extrinsic. Raw theta is bought with short gamma in exact
 *     proportion, so ranking it ranks the most dangerous front expiry. Normalising by extrinsic
 *     does not fix that — it is U-shaped in strike with its minimum at the money, so ranking it
 *     picks the most extreme strike available. Both are reported, neither is scored.
 *   - Cushion, slope, per-strike forward factor. All monotone re-expressions of the same two
 *     IVs as `fwdEdge`. Scoring them would triple-count one signal.
 *   - Spread cost and open interest. Measured inert or harmful on SPX: spread is p90 1.0% of
 *     mid, and an OI ≥ 100 gate removes 82% of candidates including 69% of the near-the-money
 *     SPXW ladder. A near-constant term is noise with a weight attached.
 *   - The front leg's variance risk premium. It shipped as a term and was removed; see
 *     SCORE_WEIGHTS. A quantity that is the same for every candidate cannot order them.
 *   - Anything ranked against history. There are 30 days of it.
 */

import { percentileRank } from "@morai/shared";
import type { Candidate } from "./candidate.ts";

/**
 * The two weights, summing to 100.
 *
 * One picks the expiry PAIR and is strike-invariant by construction; one picks the STRIKE
 * within that pair. That split is the engine's whole shape.
 *
 * `fwdEdge` (70) carries the pair because a calendar IS a forward-volatility trade and nothing
 * else. `deltaBalance` (30) selects the strike.
 *
 * TWO TERMS HAVE BEEN REMOVED, both after the live chain contradicted the reason they were
 * added. Neither is a tuning change; each was a term that could not measure what it claimed to.
 *
 * `thetaCarry` (was 20) ranked a live candidate 721 points out of the money. Theta as a share of
 * extrinsic is U-shaped in strike with its minimum at the money (measured across one pair's
 * ladder: 0.0302 at 736 OTM, 0.0074 at 16 OTM, 0.0285 at 244 ITM), so ranking it rewards the
 * most extreme strike available. The doctrine uses that ratio to compare TENORS, never strikes.
 *
 * `frontVrp` (was 25) was `IV_front(50Δ) − RV20`, and RV20 is ONE SCALAR for the whole snapshot.
 * `percentileRank` counts `h <= value`, so subtracting the same constant from every candidate
 * changes no comparison: measured on the live chain, doubling realized vol from 0.12 to 0.30
 * left the ranking byte-identical. Its stated justification — the only term looking outside the
 * chain, therefore the only one not collinear with `fwdEdge` — failed on both counts. What it
 * actually ranked was `frontRefIv`, a per-cohort constant taking 21 distinct values across 7,951
 * candidates; and since a richer front leg lowers forward vol, it drove `fwdEdge` up with it.
 * Measured correlation between the two terms' percentiles: 0.954.
 *
 * A variance risk premium on a single underlying is snapshot context, not a cross-sectional
 * signal. It is reported as `CalendarRanking.realizedVol` alongside every candidate's
 * `frontRefIv`, which is where a reader can judge it.
 *
 * Both removed weights went to `fwdEdge`, leaving the strike discriminator untouched at 30.
 * These are the doctrine's emphasis plus two measured corrections. They should be re-derived
 * against a backtest, never adjusted by feel.
 */
export const SCORE_WEIGHTS = {
  fwdEdge: 70,
  deltaBalance: 30,
} as const;

export type ScoreTermKey = keyof typeof SCORE_WEIGHTS;

export type ScoreTerm = {
  /** The metric in its own units, so the reader can judge it absolutely. Null when unmeasurable. */
  readonly raw: number | null;
  /** This candidate's rank on this term within the snapshot, 0–100. Null when `raw` is null. */
  readonly percentile: number | null;
  /** Weight actually applied. Zero when the term was inactive for the whole snapshot. */
  readonly weight: number;
  /** `weight × percentile / 100`. The contributions sum to `score`. */
  readonly contribution: number;
};

export type ScoredCalendar = Candidate & {
  readonly score: number;
  readonly breakdown: Readonly<Record<ScoreTermKey, ScoreTerm>>;
};

const TERM_KEYS: ReadonlyArray<ScoreTermKey> = ["fwdEdge", "deltaBalance"];

/** Each term's raw metric. Higher is always better, so ranking needs no per-term direction. */
function rawValue(key: ScoreTermKey, c: Candidate): number | null {
  switch (key) {
    case "fwdEdge":
      return Number.isFinite(c.ffAtm) ? c.ffAtm : null;
    case "deltaBalance":
      // Negated so that larger is better, matching every other term. The breakdown reports the
      // signed net delta itself, because that is the number the trader recognises.
      return Number.isFinite(c.net.delta) ? -Math.abs(c.net.delta) : null;
  }
}

/** What the reader sees. Differs from the ranked value only where ranking needed a sign flip. */
function reportedValue(key: ScoreTermKey, c: Candidate): number | null {
  if (key === "deltaBalance") return Number.isFinite(c.net.delta) ? c.net.delta : null;
  return rawValue(key, c);
}

export function scoreCandidates(
  candidates: ReadonlyArray<Candidate>,
): ReadonlyArray<ScoredCalendar> {
  if (candidates.length === 0) return [];

  // One pass to collect each term's distribution across the snapshot. A term with no measurable
  // value anywhere is INACTIVE — absent rather than merely bad — so its weight is removed and
  // the survivors renormalise to 100. Otherwise a snapshot where one term is unmeasurable would
  // produce scores that are not comparable with one where it is.
  const ranked = new Map<ScoreTermKey, number[]>();
  for (const key of TERM_KEYS) {
    const values: number[] = [];
    for (const c of candidates) {
      const v = rawValue(key, c);
      if (v !== null && Number.isFinite(v)) values.push(v);
    }
    ranked.set(key, values);
  }

  const activeTotal = TERM_KEYS.reduce(
    (sum, key) => ((ranked.get(key)?.length ?? 0) > 0 ? sum + SCORE_WEIGHTS[key] : sum),
    0,
  );

  const scored = candidates.map((c) => {
    const terms: Record<ScoreTermKey, ScoreTerm> = {
      fwdEdge: emptyTerm(),
      deltaBalance: emptyTerm(),
    };
    let score = 0;

    for (const key of TERM_KEYS) {
      const distribution = ranked.get(key) ?? [];
      const inactive = distribution.length === 0 || activeTotal === 0;
      // Renormalised so the best available candidate can still reach 100 when a term is absent.
      const weight = inactive ? 0 : (SCORE_WEIGHTS[key] / activeTotal) * 100;

      const value = rawValue(key, c);
      if (inactive || value === null) {
        // A candidate that cannot show a value on an ACTIVE term scores zero on it. Skipping it
        // instead would reward missing data — the absence of a measurement is not a good number.
        terms[key] = { raw: reportedValue(key, c), percentile: null, weight, contribution: 0 };
        continue;
      }

      const pct = percentileRank(value, distribution);
      const percentile = pct === null ? 0 : pct;
      const contribution = (weight * percentile) / 100;
      score += contribution;
      terms[key] = { raw: reportedValue(key, c), percentile, weight, contribution };
    }

    return { ...c, score: clamp01Hundred(score), breakdown: terms };
  });

  // Descending by score, then a fully specified tie-break so the order is never a function of
  // input position: higher forward-vol edge, tighter delta, cheaper debit, then identity.
  return [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      b.ffAtm - a.ffAtm ||
      Math.abs(a.net.delta) - Math.abs(b.net.delta) ||
      a.debit - b.debit ||
      a.root.localeCompare(b.root) ||
      a.frontExpiration.localeCompare(b.frontExpiration) ||
      a.backExpiration.localeCompare(b.backExpiration) ||
      a.strike - b.strike,
  );
}

function emptyTerm(): ScoreTerm {
  return { raw: null, percentile: null, weight: 0, contribution: 0 };
}

function clamp01Hundred(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}
