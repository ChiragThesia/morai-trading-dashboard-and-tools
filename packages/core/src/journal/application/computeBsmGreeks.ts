/**
 * computeBsmGreeks use-case — batch-commit BSM compute loop for pending leg_observations
 * (BSM-03, restructured OPS-02).
 *
 * Algorithm (batch-commit loop):
 *   Compute a wall-clock deadline = now() + BSM_TIME_BUDGET_MS. While the deadline hasn't
 *   passed:
 *     1. Read up to COMMIT_BATCH_SIZE NEWEST pending rows (bsm_iv IS NULL AND mark IS NOT
 *        NULL via partial index, ORDER BY time DESC LIMIT).
 *     2. Empty batch → fully drained, return ok(undefined).
 *     3. Solve the batch (rate lookup memoized across the WHOLE run, not per batch; IV
 *        invert; NaN-stamp on IvError; bsmGreeks on ok).
 *     4. writeBsm the batch — one Postgres transaction, one durable checkpoint. A kill after
 *        this point keeps every already-written batch.
 *   Budget exhausted with rows still pending → return ok(undefined) (NOT err) so pg-boss
 *   never fails/retries the run. The next chain-trigger/cron resumes for free: readPending's
 *   bsm_iv IS NULL predicate naturally excludes every already-committed batch (no cursor).
 *
 * OPS-02 (this restructure, 2026-07-09): a single read-solve-write-once run made a 900s
 * pg-boss timeout lose the ENTIRE run's progress — every retry redid the whole (growing)
 * backlog. Batching converts "lose the whole run on any kill" into "lose at most one batch
 * (~800 rows, ~1 min)." COMMIT_BATCH_SIZE/BSM_TIME_BUDGET_MS sizing: RESEARCH A2, derived
 * from the observed 14.3-20 rows/sec solve rate (worst case: 800 rows ≈ 56s/batch, budget
 * leaves ~3 min margin under the 900s expire cap). MEDIUM-confidence tunables — retune if
 * production durations still brush the cap.
 *
 * RC#1 (2026-07-01 debug session, preserved): the original timeout root cause was readRate
 * awaited per row with no cache. Fixed by memoizing readRate per observation date — this
 * memoization now spans the WHOLE run (cache created once, outside the loop), not just one
 * batch, so a backlog dominated by one date still collapses to one readRate call total.
 *
 * gex-schwab-bsm-null-puts / chain-window-narrow-regression (preserved): the read stays
 * NEWEST-first (ORDER BY time DESC) so the freshest cohort is always attempted first within
 * a run — batching does not reintroduce oldest-first starvation, it only shrinks the
 * per-request bound and adds checkpoints between requests.
 *
 * D-12 double-scaling guard: bsmGreeks() already returns scaled values
 *   (vega per 1 vol point, theta per calendar day). Write directly — no further scaling.
 *
 * T-02-15: NaN stamp removes failed rows from the partial index; re-run is a no-op.
 * T-02-16: Write the string 'NaN' — never JS NaN (Pitfall 4).
 * T-02-17: Only bsm_* columns touched; vendor columns never written.
 *
 * Pure domain: no I/O. Imports only from @morai/shared and ./ports.ts and domain functions.
 * Never throws; absorbs per-row errors. Wall-clock only via injected now() (deadline check).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingPendingObs,
  ForWritingBsmResults,
  ForReadingRate,
  PendingObs,
  StorageError,
} from "./ports.ts";
import { invertIv } from "../domain/iv-inversion.ts";
import { bsmGreeks } from "../domain/bsm.ts";
import { computeT } from "../domain/dte.ts";

// NaN sentinel string — always use this, never JS NaN (T-02-16, Pitfall 4)
const NAN_STAMP = "NaN";

// OPS-02: per-batch read bound AND per-batch writeBsm commit boundary. Small enough that one
// batch's solve+write comfortably finishes well under the 900s pg-boss expire cap even at the
// slowest observed solve rate (RESEARCH A2: ~56s/batch worst case at 14.3 rows/sec) — a kill
// mid-run loses at most this many rows' worth of work, not the whole backlog.
//
// ponytail: fixed tunable sized to the observed worst-case solve rate; if that rate degrades
// further (heavier concurrent DB load), retune down — the loop shape (many small batches)
// self-corrects regardless of the exact number, it only changes how many batches a run fits.
export const COMMIT_BATCH_SIZE = 800;

// OPS-02: wall-clock budget for one use-case invocation. The loop voluntarily stops issuing
// new batches once this elapses, returning ok(undefined) so pg-boss sees a clean success (not
// a failure to retry) — the remaining pending rows stay pending (bsm_iv still NULL) and drain
// on the next chain-trigger/hourly-fallback run for free, no cursor or progress table needed.
// 700_000ms (~11.7 min) leaves ~3 min margin under the 900s pg-boss expire default at the
// worst-case per-batch duration (RESEARCH A2).
export const BSM_TIME_BUDGET_MS = 700_000;

/**
 * solveBatch — per-row BSM solve for one batch (unchanged math, extracted from the loop body
 * for readability). Not a pure function (readRate is I/O), but performs no writes and has no
 * side effects beyond populating the shared rateCache passed in by the caller.
 */
async function solveBatch(
  batch: ReadonlyArray<PendingObs>,
  deps: {
    readonly readRate: ForReadingRate;
    readonly dividendYield: number;
    readonly fallbackRate: number;
  },
  rateCache: Map<string, number>,
): Promise<
  ReadonlyArray<{
    readonly time: Date;
    readonly contract: PendingObs["contract"];
    readonly bsmIv: string;
    readonly bsmDelta: string;
    readonly bsmGamma: string;
    readonly bsmTheta: string;
    readonly bsmVega: string;
  }>
> {
  type WriteRow = {
    readonly time: Date;
    readonly contract: PendingObs["contract"];
    readonly bsmIv: string;
    readonly bsmDelta: string;
    readonly bsmGamma: string;
    readonly bsmTheta: string;
    readonly bsmVega: string;
  };

  const writes: WriteRow[] = [];

  for (const obs of batch) {
    // Get risk-free rate for this observation date (memoized per date, RC#1)
    const obsDateStr = obs.time.toISOString().slice(0, 10); // YYYY-MM-DD
    const cachedRate = rateCache.get(obsDateStr);

    let r: number;
    if (cachedRate !== undefined) {
      r = cachedRate;
    } else {
      const rateResult = await deps.readRate(obsDateStr);

      if (rateResult.ok) {
        const rateStr = rateResult.value;
        if (rateStr === null) {
          r = deps.fallbackRate;
        } else {
          const parsed = parseFloat(rateStr);
          r = isFinite(parsed) ? parsed : deps.fallbackRate;
        }
      } else {
        // Storage error on rate read → use fallback (D-02)
        r = deps.fallbackRate;
      }

      rateCache.set(obsDateStr, r);
    }

    const q = deps.dividendYield;

    // Compute T — settlement-aware (D-04). Uses obs.time (the observation instant), not the
    // job wall-clock: a 0DTE row observed before the cutoff must still solve (T > 0) even if
    // the job happens to run after it (CR-02).
    const T = computeT(obs.time, obs.expiry, obs.root);

    // Invert IV
    const ivResult = invertIv(obs.mark, obs.underlyingPrice, obs.strike, T, r, q, obs.type);

    if (!ivResult.ok) {
      // D-09: stamp all five columns as 'NaN' string (T-02-16: not JS NaN)
      writes.push({
        time: obs.time,
        contract: obs.contract,
        bsmIv: NAN_STAMP,
        bsmDelta: NAN_STAMP,
        bsmGamma: NAN_STAMP,
        bsmTheta: NAN_STAMP,
        bsmVega: NAN_STAMP,
      });
      continue;
    }

    const iv = ivResult.value;

    // Compute greeks — values are already D-12-scaled by bsmGreeks(). Do NOT apply any
    // further /100, ×100, or /365.25 here (double-scaling guard).
    const greeks = bsmGreeks(obs.underlyingPrice, obs.strike, T, iv, r, q, obs.type);

    writes.push({
      time: obs.time,
      contract: obs.contract,
      bsmIv: String(iv),
      bsmDelta: String(greeks.delta),
      bsmGamma: String(greeks.gamma),
      bsmTheta: String(greeks.theta),
      bsmVega: String(greeks.vega),
    });
  }

  return writes;
}

/**
 * makeComputeBsmGreeksUseCase — factory returning the batch-commit BSM compute use-case.
 *
 * Deps:
 *   readPending  — ForReadingPendingObs (Postgres partial index scan, called once per batch)
 *   writeBsm     — ForWritingBsmResults (Postgres bsm_* update, one transaction per batch)
 *   readRate     — ForReadingRate (latest rate ≤ observation date)
 *   dividendYield — continuous dividend yield q (D-01, e.g. 0.013 for SPX)
 *   fallbackRate  — used when no rate row exists ≤ the observation date (D-02, 4.5%)
 *   now          — clock injection; drives the OPS-02 wall-clock budget deadline
 */
export function makeComputeBsmGreeksUseCase(deps: {
  readonly readPending: ForReadingPendingObs;
  readonly writeBsm: ForWritingBsmResults;
  readonly readRate: ForReadingRate;
  readonly dividendYield: number;
  readonly fallbackRate: number;
  readonly now: () => Date;
}): () => Promise<Result<void, StorageError>> {
  return async (): Promise<Result<void, StorageError>> => {
    // RC#1: memoize readRate by observation date across the WHOLE run (not per batch) — a
    // backlog drain is typically dominated by a handful of distinct dates.
    const rateCache = new Map<string, number>();

    const deadline = deps.now().getTime() + BSM_TIME_BUDGET_MS;

    while (deps.now().getTime() < deadline) {
      // Bounded, newest-first read (gex-schwab-bsm-null-puts fix, unchanged): ORDER BY time
      // DESC LIMIT COMMIT_BATCH_SIZE so the freshest cohort is always attempted first.
      const pendingResult = await deps.readPending(COMMIT_BATCH_SIZE);
      if (!pendingResult.ok) {
        return err(pendingResult.error);
      }

      const batch = pendingResult.value;
      if (batch.length === 0) {
        // Fully drained — re-run is idempotent (T-02-15)
        return ok(undefined);
      }

      const writes = await solveBatch(batch, deps, rateCache);

      // Durable checkpoint: one writeBsm transaction per batch. A kill after this line keeps
      // this batch's results — the next run's readPending excludes them (bsm_iv IS NOT NULL).
      if (writes.length > 0) {
        const writeResult = await deps.writeBsm(writes);
        if (!writeResult.ok) {
          return err(writeResult.error);
        }
      }
    }

    // Budget exhausted with rows possibly still pending — clean ok return, NOT an error, so
    // pg-boss does not fail/retry the run. The next chain-trigger/cron resumes for free.
    return ok(undefined);
  };
}
