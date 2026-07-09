import { describe, it, expect, beforeEach } from "vitest";
import { formatOccSymbol } from "@morai/shared";
import type { OccSymbol } from "@morai/shared";
import type { ForReadingPendingObs, ForWritingBsmResults } from "@morai/core";
import { makeComputeBsmGreeksUseCase, COMMIT_BATCH_SIZE, BSM_TIME_BUDGET_MS } from "@morai/core";

/**
 * runBsmDrainContract — SC3 drain-to-zero + idempotent-upsert integration contract.
 *
 * Asserts:
 * - After compute-bsm-greeks drains, SELECT count(*) WHERE bsm_iv IS NULL AND mark IS NOT NULL == 0 (SC3)
 * - M already-computed rows are not recomputed (bsm_iv preserved verbatim)
 * - NaN-stamped rows (bsm_iv = 'NaN') remain excluded from pending scan (T-02-16)
 * - Re-run is idempotent: still 0 pending, no duplicate rows (D-15)
 * - Pending-scan returns exactly the N pending rows, no others (completeness)
 *
 * Note: leg_observations.mark has a NOT NULL constraint in the DB schema, so there are
 * no mark-NULL rows in practice. The partial-index predicate "mark IS NOT NULL" is
 * defensive; the effective filter for "skip" rows is bsm_iv IS NOT NULL (already computed)
 * or bsm_iv = 'NaN' (stamped unsolvable). These cases are explicitly tested here.
 *
 * T-05-15: upsert on composite PK + partial-index means re-run writes nothing new.
 * T-05-16: pending-scan completeness proven by N-count assertion.
 */
export type BsmDrainContractRepo = {
  /** The pending-obs scanner (ForReadingPendingObs port) */
  readonly readPendingObs: ForReadingPendingObs;
  /** The BSM results writer (ForWritingBsmResults port) */
  readonly writeBsmResults: ForWritingBsmResults;
  /**
   * Count of ALL leg_observations rows that satisfy
   * bsm_iv IS NULL AND mark IS NOT NULL (SC3 assertion — no time filter).
   */
  readonly countAllPendingBsm: () => Promise<number>;
  /**
   * Count of leg_observations rows where bsm_iv = 'NaN'::numeric
   * (NaN-stamped rows that are excluded from the pending scan).
   */
  readonly countNanStampedRows: () => Promise<number>;
  /**
   * Total count of leg_observations rows (for duplicate-row detection on re-run).
   */
  readonly countAllRows: () => Promise<number>;
  /**
   * Retrieve bsm_iv value for a specific (time, contract) row.
   * Returns null when the row does not exist.
   */
  readonly getBsmIv: (time: Date, contract: OccSymbol) => Promise<string | null>;
  /**
   * Seed a pending observation row (bsm_iv NULL, mark IS NOT NULL).
   * Also inserts the corresponding contracts row.
   */
  readonly seedPendingRow: (
    occ: OccSymbol,
    time: Date,
    mark: number,
    underlyingPrice: number,
    strike: number,
    expiration: string,
    root: "SPX" | "SPXW",
    contractType: "C" | "P",
  ) => Promise<void>;
  /**
   * Seed an already-computed row (bsm_iv IS NOT NULL — not in pending scan).
   * Also inserts the corresponding contracts row.
   */
  readonly seedComputedRow: (
    occ: OccSymbol,
    time: Date,
    mark: number,
    underlyingPrice: number,
    bsmIv: string,
  ) => Promise<void>;
  /**
   * Seed a NaN-stamped row (bsm_iv = 'NaN' — excluded from pending scan per T-02-16).
   * Also inserts the corresponding contracts row.
   */
  readonly seedNanStampedRow: (occ: OccSymbol, time: Date, mark: number, underlyingPrice: number) => Promise<void>;
};

/** Build a deterministic OCC symbol for use in drain tests */
function makeOcc(root: "SPX" | "SPXW", type: "C" | "P", strike: number): OccSymbol {
  return formatOccSymbol({
    root,
    expiry: new Date(Date.UTC(2026, 8, 19)), // 2026-09-19 — future date so T > 0
    type,
    strike,
  });
}

export function runBsmDrainContractTests(makeRepo: () => BsmDrainContractRepo): void {
  describe("SC3 / D-15: compute-bsm-greeks drain-to-zero + idempotent-upsert contract", () => {
    let repo: BsmDrainContractRepo;

    // Canonical OCC symbols used across tests
    // N=3 pending rows (bsm_iv IS NULL, mark IS NOT NULL)
    const pendingOcc1 = makeOcc("SPX", "C", 5500);
    const pendingOcc2 = makeOcc("SPX", "P", 5000);
    const pendingOcc3 = makeOcc("SPXW", "C", 5600);
    // M=2 already-computed rows (bsm_iv IS NOT NULL — different symbols to avoid PK collision)
    const computedOcc1 = makeOcc("SPX", "C", 6000);
    const computedOcc2 = makeOcc("SPX", "P", 6500);
    // K=2 NaN-stamped rows (bsm_iv = 'NaN' — excluded from pending scan per T-02-16)
    const nanOcc1 = makeOcc("SPXW", "P", 4500);
    const nanOcc2 = makeOcc("SPXW", "C", 4400);

    // A fixed observation time — all seeded rows use this time slot
    const obsTime = new Date(Date.UTC(2026, 5, 10, 16, 0, 0, 0)); // 2026-06-10T16:00:00Z

    // Values that produce a solvable BSM problem (non-zero T, reasonable mark)
    // Underlying=5500, strike near ATM, T>0 (far expiry 2026-09-19), r=4.5%, q=1.3%
    const UNDERLYING = 5500;
    const FALLBACK_RATE = 0.045;
    const DIVIDEND_YIELD = 0.013;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("pending-scan completeness: returns exactly the N pending rows, not computed or NaN-stamped rows", async () => {
      // Seed N=3 pending rows with realistic marks (solvable BSM inputs — T≈0.277y, r=4.5%, q=1.3%)
      // pendingOcc1: SPX C 5500 (ATM call, ~21% vol → mark≈200); pendingOcc2: SPX P 5000 (OTM put); pendingOcc3: SPXW C 5600 (OTM call)
      await repo.seedPendingRow(pendingOcc1, obsTime, 200.0, UNDERLYING, 5500, "2026-09-19", "SPX", "C");
      await repo.seedPendingRow(pendingOcc2, obsTime, 50.0, UNDERLYING, 5000, "2026-09-19", "SPX", "P");
      await repo.seedPendingRow(pendingOcc3, obsTime, 80.0, UNDERLYING, 5600, "2026-09-19", "SPXW", "C");
      // Seed M=2 computed rows (bsm_iv IS NOT NULL — must NOT appear in pending scan)
      await repo.seedComputedRow(computedOcc1, obsTime, 10.0, UNDERLYING, "0.22");
      await repo.seedComputedRow(computedOcc2, obsTime, 20.0, UNDERLYING, "0.18");
      // Seed K=2 NaN-stamped rows (bsm_iv = 'NaN' — must NOT appear in pending scan)
      await repo.seedNanStampedRow(nanOcc1, obsTime, 5.0, UNDERLYING);
      await repo.seedNanStampedRow(nanOcc2, obsTime, 3.0, UNDERLYING);

      // Bounded, newest-first read (gex-schwab-bsm-null-puts); this suite truncates + seeds a
      // handful of rows, so a large limit returns them all.
      const pendingResult = await repo.readPendingObs(100_000);
      expect(pendingResult.ok).toBe(true);
      if (!pendingResult.ok) return;

      // Pending scan must return exactly the 3 pending rows
      const pendingContracts = pendingResult.value.map((p) => p.contract);
      expect(pendingContracts).toContain(pendingOcc1);
      expect(pendingContracts).toContain(pendingOcc2);
      expect(pendingContracts).toContain(pendingOcc3);
      // Already-computed rows must NOT appear (bsm_iv IS NOT NULL excludes them)
      expect(pendingContracts).not.toContain(computedOcc1);
      expect(pendingContracts).not.toContain(computedOcc2);
      // NaN-stamped rows must NOT appear (bsm_iv IS NOT NULL excludes 'NaN' rows too)
      expect(pendingContracts).not.toContain(nanOcc1);
      expect(pendingContracts).not.toContain(nanOcc2);
    });

    it("SC3: after drain, SELECT count(*) WHERE bsm_iv IS NULL AND mark IS NOT NULL == 0", async () => {
      // Seed N=3 pending, M=2 computed, K=2 NaN-stamped (realistic marks for solvable BSM)
      await repo.seedPendingRow(pendingOcc1, obsTime, 200.0, UNDERLYING, 5500, "2026-09-19", "SPX", "C");
      await repo.seedPendingRow(pendingOcc2, obsTime, 50.0, UNDERLYING, 5000, "2026-09-19", "SPX", "P");
      await repo.seedPendingRow(pendingOcc3, obsTime, 80.0, UNDERLYING, 5600, "2026-09-19", "SPXW", "C");
      await repo.seedComputedRow(computedOcc1, obsTime, 10.0, UNDERLYING, "0.22");
      await repo.seedComputedRow(computedOcc2, obsTime, 20.0, UNDERLYING, "0.18");
      await repo.seedNanStampedRow(nanOcc1, obsTime, 5.0, UNDERLYING);
      await repo.seedNanStampedRow(nanOcc2, obsTime, 3.0, UNDERLYING);

      // Wire the real use-case
      const computeBsmGreeks = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: () => new Date(),
      });

      // Before drain: N=3 pending rows exist
      const pendingBefore = await repo.countAllPendingBsm();
      expect(pendingBefore).toBe(3);

      // Run the drain
      const drainResult = await computeBsmGreeks();
      expect(drainResult.ok).toBe(true);

      // SC3: after drain, zero pending rows (bsm_iv IS NULL AND mark IS NOT NULL == 0)
      const pendingAfter = await repo.countAllPendingBsm();
      expect(pendingAfter).toBe(0);
    });

    it("already-computed rows are not recomputed after drain (M rows bsm_iv preserved)", async () => {
      await repo.seedPendingRow(pendingOcc1, obsTime, 200.0, UNDERLYING, 5500, "2026-09-19", "SPX", "C");
      await repo.seedComputedRow(computedOcc1, obsTime, 10.0, UNDERLYING, "0.22");
      await repo.seedComputedRow(computedOcc2, obsTime, 20.0, UNDERLYING, "0.18");

      const computeBsmGreeks = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: () => new Date(),
      });

      // Capture computed rows' bsm_iv values BEFORE the drain
      const bsmIvBefore1 = await repo.getBsmIv(obsTime, computedOcc1);
      const bsmIvBefore2 = await repo.getBsmIv(obsTime, computedOcc2);
      expect(bsmIvBefore1).not.toBeNull();
      expect(bsmIvBefore2).not.toBeNull();

      await computeBsmGreeks();

      // Computed rows' bsm_iv must be byte-identical after drain (not overwritten)
      const bsmIvAfter1 = await repo.getBsmIv(obsTime, computedOcc1);
      const bsmIvAfter2 = await repo.getBsmIv(obsTime, computedOcc2);
      expect(bsmIvAfter1).toBe(bsmIvBefore1);
      expect(bsmIvAfter2).toBe(bsmIvBefore2);
    });

    it("T-02-16: NaN-stamped rows remain excluded from pending scan after drain (not re-processed)", async () => {
      // pendingOcc1 uses a realistic ATM call mark (200.0, ~15% vol) that produces a solvable IV.
      // After drain it becomes computed (bsm_iv IS NOT NULL, not 'NaN'), so the 2 seeded
      // NaN-stamped rows remain at count=2 — proving existing NaN-stamped rows are not re-processed.
      await repo.seedPendingRow(pendingOcc1, obsTime, 200.0, UNDERLYING, 5500, "2026-09-19", "SPX", "C");
      await repo.seedNanStampedRow(nanOcc1, obsTime, 5.0, UNDERLYING);
      await repo.seedNanStampedRow(nanOcc2, obsTime, 3.0, UNDERLYING);

      const computeBsmGreeks = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: () => new Date(),
      });

      // Before drain: 2 NaN-stamped rows exist
      const nanBefore = await repo.countNanStampedRows();
      expect(nanBefore).toBe(2);

      await computeBsmGreeks();

      // NaN-stamped rows must remain NaN-stamped after drain (not re-processed)
      const nanAfter = await repo.countNanStampedRows();
      expect(nanAfter).toBe(2);

      // Verify NaN-stamped rows' bsm_iv is still 'NaN' (string, not overwritten)
      const bsmIv1 = await repo.getBsmIv(obsTime, nanOcc1);
      const bsmIv2 = await repo.getBsmIv(obsTime, nanOcc2);
      // Postgres stores 'NaN'::numeric and returns it as 'NaN' string
      expect(bsmIv1).toBe("NaN");
      expect(bsmIv2).toBe("NaN");
    });

    it("D-15 idempotency: re-running the drain produces still-zero pending and no duplicate rows", async () => {
      await repo.seedPendingRow(pendingOcc1, obsTime, 200.0, UNDERLYING, 5500, "2026-09-19", "SPX", "C");
      await repo.seedPendingRow(pendingOcc2, obsTime, 50.0, UNDERLYING, 5000, "2026-09-19", "SPX", "P");
      await repo.seedNanStampedRow(nanOcc1, obsTime, 5.0, UNDERLYING);

      const computeBsmGreeks = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: () => new Date(),
      });

      // First run — drain all pending rows
      const result1 = await computeBsmGreeks();
      expect(result1.ok).toBe(true);
      const pendingAfterFirst = await repo.countAllPendingBsm();
      expect(pendingAfterFirst).toBe(0);
      const rowCountAfterFirst = await repo.countAllRows();

      // Second run — idempotent re-run (T-05-15: no new rows, no recompute)
      const result2 = await computeBsmGreeks();
      expect(result2.ok).toBe(true);
      const pendingAfterSecond = await repo.countAllPendingBsm();
      expect(pendingAfterSecond).toBe(0);
      const rowCountAfterSecond = await repo.countAllRows();

      // No duplicate rows injected
      expect(rowCountAfterSecond).toBe(rowCountAfterFirst);
    });
  });

  describe("OPS-02: batch-commit durability — budget-interrupted-then-resumed", () => {
    let repo: BsmDrainContractRepo;
    const UNDERLYING = 5500;
    const FALLBACK_RATE = 0.045;
    const DIVIDEND_YIELD = 0.013;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("a budget-expired run commits the first batch (durable checkpoint) and leaves the remainder pending; a second invocation with a fresh budget resumes to zero pending with no rework", async () => {
      // Seed more pending rows than one batch — COMMIT_BATCH_SIZE + a remainder — so the
      // first invocation's budget-exit leaves real work still pending.
      const remainder = 5;
      const totalRows = COMMIT_BATCH_SIZE + remainder;
      const obsTimeOps02 = new Date(Date.UTC(2026, 5, 10, 16, 0, 0, 0));
      for (let i = 0; i < totalRows; i++) {
        const occ = formatOccSymbol({
          root: "SPX",
          expiry: new Date(Date.UTC(2026, 8, 19)),
          type: "C",
          strike: 5000 + i,
        });
        await repo.seedPendingRow(
          occ,
          obsTimeOps02,
          100.0 + i,
          UNDERLYING,
          5000 + i,
          "2026-09-19",
          "SPX",
          "C",
        );
      }

      const pendingBeforeAnyRun = await repo.countAllPendingBsm();
      expect(pendingBeforeAnyRun).toBe(totalRows);

      // First invocation: inject a `now()` that reports the BSM_TIME_BUDGET_MS budget as
      // already exhausted right after the first batch — simulating a kill/interruption
      // between batch 1's durable writeBsm commit and what would have been batch 2's read.
      const startMs = Date.UTC(2026, 5, 10, 16, 0, 0);
      let nowCalls = 0;
      const budgetExpiredAfterFirstBatch = (): Date => {
        nowCalls++;
        // Call 1 sets the deadline; call 2 is the pre-batch-1 check (still under budget);
        // call 3+ (post-batch-1 check) reports the budget already blown.
        if (nowCalls <= 2) return new Date(startMs);
        return new Date(startMs + BSM_TIME_BUDGET_MS + 1);
      };

      const interruptedRun = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: budgetExpiredAfterFirstBatch,
      });

      const result1 = await interruptedRun();
      // Budget exit is a CLEAN ok — not an error — even though rows remain pending.
      expect(result1.ok).toBe(true);

      // Durability: exactly one batch's worth of rows got solved and committed; the
      // remainder is still pending in real Postgres (bsm_iv IS NULL AND mark IS NOT NULL).
      const pendingAfterKill = await repo.countAllPendingBsm();
      expect(pendingAfterKill).toBe(remainder);

      // Second invocation: a fresh budget (now() never approaches the deadline) resumes and
      // drains the rest — the first batch's rows are excluded by readPending's bsm_iv IS
      // NULL predicate, so they are never re-solved (idempotent resume).
      const resumedRun = makeComputeBsmGreeksUseCase({
        readPending: repo.readPendingObs,
        writeBsm: repo.writeBsmResults,
        readRate: async (_date) => ({ ok: true, value: String(FALLBACK_RATE) }),
        dividendYield: DIVIDEND_YIELD,
        fallbackRate: FALLBACK_RATE,
        now: () => new Date(startMs + 60_000),
      });

      const result2 = await resumedRun();
      expect(result2.ok).toBe(true);

      const pendingAfterResume = await repo.countAllPendingBsm();
      expect(pendingAfterResume).toBe(0);

      // No rework: total row count is unchanged (no duplicate writes from re-solving the
      // already-committed first batch).
      const totalRowsAfter = await repo.countAllRows();
      expect(totalRowsAfter).toBe(totalRows);
    });
  });
}
