/**
 * computeBsmGreeks use-case — batch BSM compute for pending leg_observations (BSM-03).
 *
 * Algorithm:
 *   1. Read up to MAX_BATCH_SIZE NEWEST pending rows (bsm_iv IS NULL AND mark IS NOT NULL
 *      via partial index, ORDER BY time DESC LIMIT — see MAX_BATCH_SIZE / RC#1 below)
 *   2. For each row: get rate r from ForReadingRate, memoized per observation date
 *      (RC#1); fall back to fallbackRate if null
 *   3. Compute T = computeT(now(), expiry, root) — settlement-aware (D-04)
 *   4. Invert IV via invertIv; on IvError → stamp all five bsm_* as string 'NaN' (D-09)
 *   5. On ok IV → compute bsmGreeks; stamp five columns as String(value)
 *   6. Batch-write all writes in one call
 *
 * RC#1 (2026-07-01 debug session): a 56k-row single-day backlog timed out every run
 * (>900s pg-boss handler limit) because readRate was awaited per row with no cache,
 * and the all-or-nothing write at the end meant a mid-run timeout made zero forward
 * progress — every retry redid the whole (growing) backlog. Fixed by memoizing
 * readRate per date and bounding each run to MAX_BATCH_SIZE rows.
 *
 * D-12 double-scaling guard: bsmGreeks() already returns scaled values
 *   (vega per 1 vol point, theta per calendar day). Write directly — no further scaling.
 *
 * T-02-15: NaN stamp removes failed rows from the partial index; re-run is a no-op.
 * T-02-16: Write the string 'NaN' — never JS NaN (Pitfall 4).
 * T-02-17: Only bsm_* columns touched; vendor columns never written.
 *
 * Pure domain: no I/O. Imports only from @morai/shared and ./ports.ts and domain functions.
 * Never throws; absorbs per-row errors. No Date.now() — now is injected.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingPendingObs,
  ForWritingBsmResults,
  ForReadingRate,
  StorageError,
} from "./ports.ts";
import { invertIv } from "../domain/iv-inversion.ts";
import { bsmGreeks } from "../domain/bsm.ts";
import { computeT } from "../domain/dte.ts";

// NaN sentinel string — always use this, never JS NaN (T-02-16, Pitfall 4)
const NAN_STAMP = "NaN";

// RC#1 + gex-schwab-bsm-null-puts fix: the pending read is bounded AND newest-first.
//
// RC#1 (timeout): writeBsm persists one row at a time inside a transaction, so an unbounded
// backlog makes a run's DB round-trips grow without limit — a timeout mid-run makes zero
// forward progress. Bounding keeps each run within the pg-boss 900s handler limit.
//
// gex-schwab-bsm-null-puts (coverage): the read is now NEWEST-first (ForReadingPendingObs does
// ORDER BY time DESC LIMIT). The OLD bound was 2000 — smaller than one chain cycle (~11,246
// CBOE / ~3,622 Schwab legs at a single timestamp) — so oldest-first the newest (live) cohort
// was starved and, within a partially-reached cycle, puts (contract 'P' > 'C') were cut. Those
// rows stayed bsm_* NULL and GEX dropped them (no put wall / flip). The bound now exceeds one
// full cycle so the freshest cycle is always processed whole in a single run.
//
// ponytail: fixed ceiling sized to the observed max cycle; if the SPX chain grows past this a
// cycle splits again — raise it (per-row cost is one indexed UPDATE, far under the 900s limit).
export const MAX_BATCH_SIZE = 12000;

/**
 * makeComputeBsmGreeksUseCase — factory returning the batch BSM compute use-case.
 *
 * Deps:
 *   readPending  — ForReadingPendingObs (Postgres partial index scan)
 *   writeBsm     — ForWritingBsmResults (Postgres bsm_* update)
 *   readRate     — ForReadingRate (latest rate ≤ observation date)
 *   dividendYield — continuous dividend yield q (D-01, e.g. 0.013 for SPX)
 *   fallbackRate  — used when no rate row exists ≤ the observation date (D-02, 4.5%)
 *   now          — clock injection; never call Date.now() in core
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
    // Step 1: read the newest pending rows, bounded (ForReadingPendingObs: ORDER BY time DESC
    // LIMIT). MAX_BATCH_SIZE exceeds one full chain cycle so the freshest cycle is never split.
    const pendingResult = await deps.readPending(MAX_BATCH_SIZE);
    if (!pendingResult.ok) {
      return err(pendingResult.error);
    }

    const pending = pendingResult.value;
    if (pending.length === 0) {
      // No-op: re-run is idempotent (T-02-15)
      return ok(undefined);
    }

    // RC#1: bound this run's work — remainder (if any) stays pending for the next run.
    const batch = pending.length > MAX_BATCH_SIZE ? pending.slice(0, MAX_BATCH_SIZE) : pending;

    // CR-02 fix: deps.now is retained in the factory signature (preserves worker composition
    // root wiring in apps/worker/src/main.ts — owned by sibling plan 02-09). The local
    // binding is removed because T is now computed per-row from obs.time (see Step 3 below).
    // void deps.now; // intentionally not called — kept in deps type for backward compat

    // Build writes array — one entry per pending row
    type WriteRow = {
      readonly time: Date;
      readonly contract: typeof pending[number]["contract"];
      readonly bsmIv: string;
      readonly bsmDelta: string;
      readonly bsmGamma: string;
      readonly bsmTheta: string;
      readonly bsmVega: string;
    };

    const writes: WriteRow[] = [];

    // RC#1: memoize readRate by observation date — a backlog drain is typically
    // dominated by a handful of distinct dates (often just one), so this collapses what
    // was N identical sequential DB round-trips down to one per distinct date.
    const rateCache = new Map<string, number>();

    for (const obs of batch) {
      // Step 2: get risk-free rate for this observation date (memoized per date)
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

      // Step 3: compute T — settlement-aware (D-04)
      // CR-02 fix: use obs.time (the observation instant), not the job wall-clock.
      // Rationale: a 0DTE row observed at 15:30 ET must compute T from its own timestamp
      // (T > 0), not from when the compute job happens to run. Using the job wall-clock
      // permanently NaN-stamps all 0DTE rows observed before the cutoff but computed after.
      const T = computeT(obs.time, obs.expiry, obs.root);

      // Step 4: invert IV
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

      // Step 5: compute greeks — values are already D-12-scaled by bsmGreeks()
      // Do NOT apply any further /100, ×100, or /365.25 here (double-scaling guard)
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

    // Step 6: batch write
    if (writes.length > 0) {
      const writeResult = await deps.writeBsm(writes);
      if (!writeResult.ok) {
        return err(writeResult.error);
      }
    }

    return ok(undefined);
  };
}
