/**
 * computeBsmGreeks use-case — batch BSM compute for pending leg_observations (BSM-03).
 *
 * Algorithm:
 *   1. Read all pending rows (bsm_iv IS NULL AND mark IS NOT NULL via partial index)
 *   2. For each row: get rate r from ForReadingRate; fall back to fallbackRate if null
 *   3. Compute T = computeT(now(), expiry, root) — settlement-aware (D-04)
 *   4. Invert IV via invertIv; on IvError → stamp all five bsm_* as string 'NaN' (D-09)
 *   5. On ok IV → compute bsmGreeks; stamp five columns as String(value)
 *   6. Batch-write all writes in one call
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
    // Step 1: read pending rows
    const pendingResult = await deps.readPending();
    if (!pendingResult.ok) {
      return err(pendingResult.error);
    }

    const pending = pendingResult.value;
    if (pending.length === 0) {
      // No-op: re-run is idempotent (T-02-15)
      return ok(undefined);
    }

    const now = deps.now();

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

    for (const obs of pending) {
      // Step 2: get risk-free rate for this observation date
      const obsDateStr = obs.time.toISOString().slice(0, 10); // YYYY-MM-DD
      const rateResult = await deps.readRate(obsDateStr);

      let r: number;
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

      const q = deps.dividendYield;

      // Step 3: compute T — settlement-aware (D-04)
      const T = computeT(now, obs.expiry, obs.root);

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
