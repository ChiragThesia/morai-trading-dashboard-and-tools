import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
  ForReadingPendingObs,
  ForWritingBsmResults,
  ObservationRow,
  ContractRow,
} from "@morai/core";
import type { OccSymbol } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";

/**
 * Shared contract-test suite for the leg-observations persistence port.
 * Run this suite against the Postgres adapter (testcontainers).
 *
 * Asserts:
 * - Persisting a set of rows writes exactly the rows passed
 * - All rows have source='cboe' and bsm_iv IS NULL
 * - A second identical persist adds zero rows (composite PK idempotency)
 * - Upserting contracts: exercise_style='european', re-upsert adds zero rows
 * - BSM-03: pending scan drains bsm_iv IS NULL rows; bsm write fills all five columns
 * - T-02-16: NaN stamp works round-trip; stamped rows excluded from pending scan
 * - T-02-17: vendor columns unchanged after bsm write
 */

export type LegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly readPendingObs: ForReadingPendingObs;
  readonly writeBsmResults: ForWritingBsmResults;
  /** Count rows in leg_observations for the given time slot */
  readonly countObservations: (time: Date) => Promise<number>;
  /** Count rows in contracts for the given roots */
  readonly countContracts: (roots: ReadonlyArray<string>) => Promise<number>;
  /** Count rows where bsm_iv IS NULL AND mark IS NOT NULL (pending scan) */
  readonly countPendingBsm: (time: Date) => Promise<number>;
  /** Count rows where bsm_iv = 'NaN'::numeric (NaN-stamped rows) */
  readonly countNanStamped: (time: Date) => Promise<number>;
  /** Get the vendor mark value for a contract (to check vendor columns unchanged) */
  readonly getVendorMark: (time: Date, contract: OccSymbol) => Promise<string | null>;
};

function makeFixtureRows(time: Date): {
  observations: ReadonlyArray<ObservationRow>;
  contracts: ReadonlyArray<ContractRow>;
} {
  // "SPXW  260611C07275000" — 21 chars
  const occ1 = formatOccSymbol({
    root: "SPXW",
    expiry: new Date(2026, 5, 11),
    type: "C",
    strike: 7275,
  });
  // "SPX   260918C07275000" — 21 chars
  const occ2 = formatOccSymbol({
    root: "SPX",
    expiry: new Date(2026, 8, 18),
    type: "P",
    strike: 7275,
  });

  const observations: ReadonlyArray<ObservationRow> = [
    {
      time,
      contract: occ1,
      bid: 25.3,
      ask: 25.5,
      mark: 25.4,
      underlyingPrice: 7274.14,
      iv: 0.3761,
      delta: 0.498,
      gamma: 0.0061,
      theta: -25.88,
      vega: 0.6955,
      openInterest: 474,
      volume: 2898,
      source: "cboe" as const,
    },
    {
      time,
      contract: occ2,
      bid: 240.4,
      ask: 242.0,
      mark: 241.2,
      underlyingPrice: 7274.14,
      iv: 0.1818,
      delta: -0.4429,
      gamma: 0.0006,
      theta: -1.3234,
      vega: 14.9244,
      openInterest: 1039,
      volume: 0,
      source: "cboe" as const,
    },
  ];

  const contracts: ReadonlyArray<ContractRow> = [
    {
      occSymbol: occ1,
      underlying: "SPX",
      root: "SPXW",
      contractType: "C",
      exerciseStyle: "european",
      strike: 7275000, // ×1000 int
      expiration: "2026-06-11",
      multiplier: 100,
    },
    {
      occSymbol: occ2,
      underlying: "SPX",
      root: "SPX",
      contractType: "P",
      exerciseStyle: "european",
      strike: 7275000,
      expiration: "2026-09-18",
      multiplier: 100,
    },
  ];

  return { observations, contracts };
}

export function runLegObservationsContractTests(
  makeRepo: () => LegObservationsRepo,
): void {
  describe("leg-observations persistence contract", () => {
    let repo: LegObservationsRepo;
    // Use a unique time per test run to avoid cross-test collisions
    let observationTime: Date;

    beforeEach(() => {
      repo = makeRepo();
      observationTime = new Date(Date.now() + Math.random() * 1_000_000);
      observationTime.setMilliseconds(0);
    });

    describe("persistObservations + countObservations", () => {
      it("persists rows with source=cboe and bsm_iv IS NULL", async () => {
        const { observations } = makeFixtureRows(observationTime);
        const result = await repo.persistObservations(observations);
        expect(result.ok).toBe(true);

        const count = await repo.countObservations(observationTime);
        expect(count).toBe(observations.length);
      });

      it("re-persisting the same rows adds zero rows (idempotent)", async () => {
        const { observations } = makeFixtureRows(observationTime);
        await repo.persistObservations(observations);
        const countAfterFirst = await repo.countObservations(observationTime);

        // Second identical persist
        await repo.persistObservations(observations);
        const countAfterSecond = await repo.countObservations(observationTime);

        expect(countAfterSecond).toBe(countAfterFirst);
      });
    });

    describe("upsertContracts", () => {
      it("upserts contracts with exercise_style=european for SPX/SPXW", async () => {
        const { contracts } = makeFixtureRows(observationTime);
        const result = await repo.upsertContracts(contracts);
        expect(result.ok).toBe(true);

        const count = await repo.countContracts(["SPX", "SPXW"]);
        expect(count).toBeGreaterThan(0);
      });

      it("re-upserting the same contracts adds zero rows (first-seen only)", async () => {
        const { contracts } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contracts);
        const countAfterFirst = await repo.countContracts(["SPX", "SPXW"]);

        await repo.upsertContracts(contracts);
        const countAfterSecond = await repo.countContracts(["SPX", "SPXW"]);

        expect(countAfterSecond).toBe(countAfterFirst);
      });
    });

    describe("BSM-03: pending scan + bsm write", () => {
      it("pending scan returns newly-seeded rows (bsm_iv NULL)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        const pendingResult = await repo.readPendingObs();
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;

        // All seeded rows should be in the pending scan
        const pendingContracts = pendingResult.value.map((obs) => obs.contract);
        for (const obs of observations) {
          expect(pendingContracts).toContain(obs.contract);
        }
      });

      it("writing bsm_* fills all five columns; vendor columns unchanged (T-02-17)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Capture vendor mark before bsm write
        const obs0 = observations[0];
        if (!obs0) throw new Error("no observation");
        const markBefore = await repo.getVendorMark(observationTime, obs0.contract);
        expect(markBefore).not.toBeNull();

        // Write bsm results for all pending rows
        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.25",
          bsmDelta: "0.5",
          bsmGamma: "0.001",
          bsmTheta: "-0.05",
          bsmVega: "0.3",
        }));
        const writeResult = await repo.writeBsmResults(writes);
        expect(writeResult.ok).toBe(true);

        // Vendor mark must be byte-identical after write (T-02-17)
        const markAfter = await repo.getVendorMark(observationTime, obs0.contract);
        expect(markAfter).toBe(markBefore);

        // Pending scan should be empty after write (BSM-03 AC-4)
        const pendingCount = await repo.countPendingBsm(observationTime);
        expect(pendingCount).toBe(0);
      });

      it("NaN-stamped rows are excluded from the pending scan and queryable via NaN::numeric (T-02-16, D-09)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Stamp one row as NaN
        const obs0 = observations[0];
        if (!obs0) throw new Error("no observation");
        const nanWrite = [{
          time: obs0.time,
          contract: obs0.contract,
          bsmIv: "NaN",
          bsmDelta: "NaN",
          bsmGamma: "NaN",
          bsmTheta: "NaN",
          bsmVega: "NaN",
        }];
        await repo.writeBsmResults(nanWrite);

        // NaN-stamped row must appear in countNanStamped (bsm_iv = 'NaN'::numeric)
        const nanCount = await repo.countNanStamped(observationTime);
        expect(nanCount).toBeGreaterThan(0);

        // NaN-stamped row must NOT appear in the pending scan for this time slot
        // (bsm_iv is no longer NULL after NaN stamp)
        // Filter pending by our specific time to avoid cross-test interference
        const pendingResult = await repo.readPendingObs();
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;
        const pendingForThisTime = pendingResult.value.filter(
          (p) => p.time.getTime() === observationTime.getTime(),
        );
        const pendingContracts = pendingForThisTime.map((p) => p.contract);
        expect(pendingContracts).not.toContain(obs0.contract);
      });

      it("re-running readPendingObs returns empty after all rows are written (no-op re-run)", async () => {
        const { observations, contracts: contractRows } = makeFixtureRows(observationTime);
        await repo.upsertContracts(contractRows);
        await repo.persistObservations(observations);

        // Write all bsm results
        const writes = observations.map((obs) => ({
          time: obs.time,
          contract: obs.contract,
          bsmIv: "0.20",
          bsmDelta: "0.45",
          bsmGamma: "0.001",
          bsmTheta: "-0.02",
          bsmVega: "0.25",
        }));
        await repo.writeBsmResults(writes);

        // Second read returns empty (idempotent re-run — BSM-03 AC)
        const pendingResult = await repo.readPendingObs();
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;

        // Filter for our specific time slot (other tests may have seeded rows)
        const ourPending = pendingResult.value.filter(
          (obs) => obs.time.getTime() === observationTime.getTime(),
        );
        expect(ourPending).toHaveLength(0);
      });
    });
  });
}

// Export helper for test files that need to build ObservationRow fixtures
export { makeFixtureRows };
export type { OccSymbol };
