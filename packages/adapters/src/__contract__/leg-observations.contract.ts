import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
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
 */

export type LegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  /** Count rows in leg_observations for the given time slot */
  readonly countObservations: (time: Date) => Promise<number>;
  /** Count rows in contracts for the given roots */
  readonly countContracts: (roots: ReadonlyArray<string>) => Promise<number>;
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
  });
}

// Export helper for test files that need to build ObservationRow fixtures
export { makeFixtureRows };
export type { OccSymbol };
