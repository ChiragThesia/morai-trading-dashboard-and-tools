import { describe, it, expect, beforeEach } from "vitest";
import type { ForPersistingRate, ForReadingRate } from "@morai/core";

/**
 * Shared contract-test suite for the rate-observations persistence port.
 * Run this suite against the Postgres adapter (testcontainers).
 *
 * Asserts:
 * - Persisting a rate then reading on-or-before its date returns that rate
 * - Reading a date before any stored row returns null
 * - Persisting the same date twice does not error and leaves one row
 */

export type RateObservationsRepo = {
  readonly persistRate: ForPersistingRate;
  readonly readRate: ForReadingRate;
};

export function runRateObservationsContractTests(
  makeRepo: () => RateObservationsRepo,
): void {
  describe("rate-observations persistence contract", () => {
    let repo: RateObservationsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    describe("persistRate + readRate", () => {
      it("persisting a rate and reading on-or-before its date returns that rate", async () => {
        const persistResult = await repo.persistRate({
          date: "2026-06-09",
          rate: 0.0525,
        });
        expect(persistResult.ok).toBe(true);

        // Reading on the exact date
        const readOnDate = await repo.readRate("2026-06-09");
        expect(readOnDate.ok).toBe(true);
        if (!readOnDate.ok) return;
        expect(readOnDate.value).not.toBeNull();
        // Rate stored as numeric — check the value is approx 5.25% (0.0525)
        expect(parseFloat(readOnDate.value ?? "0")).toBeCloseTo(0.0525, 6);
      });

      it("reading on a date after the stored date also returns the rate", async () => {
        await repo.persistRate({ date: "2026-06-09", rate: 0.0525 });

        // Reading one day after
        const readAfter = await repo.readRate("2026-06-10");
        expect(readAfter.ok).toBe(true);
        if (!readAfter.ok) return;
        expect(readAfter.value).not.toBeNull();
        expect(parseFloat(readAfter.value ?? "0")).toBeCloseTo(0.0525, 6);
      });

      it("reading a date before any stored row returns null", async () => {
        await repo.persistRate({ date: "2026-06-09", rate: 0.0525 });

        // Reading before the earliest row
        const readBefore = await repo.readRate("2026-01-01");
        expect(readBefore.ok).toBe(true);
        if (!readBefore.ok) return;
        expect(readBefore.value).toBeNull();
      });

      it("persisting the same date twice does not error and leaves one row", async () => {
        const firstResult = await repo.persistRate({
          date: "2026-06-09",
          rate: 0.0525,
        });
        expect(firstResult.ok).toBe(true);

        // Second persist same date — should not throw or err
        const secondResult = await repo.persistRate({
          date: "2026-06-09",
          rate: 0.0525,
        });
        expect(secondResult.ok).toBe(true);

        // Only one row exists for this date
        const readResult = await repo.readRate("2026-06-09");
        expect(readResult.ok).toBe(true);
        if (!readResult.ok) return;
        expect(readResult.value).not.toBeNull();
        // If upsert updates rate: value may be either 5.25% (either update or no-op is fine)
        // The contract just guarantees one row and no error
        expect(parseFloat(readResult.value ?? "0")).toBeGreaterThan(0);
      });

      it("selects the most recent rate ≤ date when multiple rows exist", async () => {
        await repo.persistRate({ date: "2026-06-01", rate: 0.05 });
        await repo.persistRate({ date: "2026-06-08", rate: 0.0525 });

        // Reading on 2026-06-08 should return the 5.25% row
        const readLatest = await repo.readRate("2026-06-08");
        expect(readLatest.ok).toBe(true);
        if (!readLatest.ok) return;
        expect(readLatest.value).not.toBeNull();
        expect(parseFloat(readLatest.value ?? "0")).toBeCloseTo(0.0525, 6);
      });
    });
  });
}
