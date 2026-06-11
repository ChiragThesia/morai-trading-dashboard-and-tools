import { describe, it, expect, beforeEach } from "vitest";
import type { ForFetchingRate, RateObservation } from "@morai/core";

/**
 * Shared contract-test suite for the ForFetchingRate port.
 * Run against BOTH the FRED HTTP adapter (msw-backed) and the in-memory adapter.
 *
 * Adapter type includes an optional `seed` for in-memory adapters.
 */
export type RateAdapter = {
  readonly fetchRate: ForFetchingRate;
  readonly seed?: (obs: RateObservation) => void;
};

export function runRateContractTests(makeAdapter: () => RateAdapter): void {
  describe("rate port contract", () => {
    let adapter: RateAdapter;

    beforeEach(() => {
      adapter = makeAdapter();
    });

    it("returns ok(RateObservation) with a numeric rate", async () => {
      if (adapter.seed) {
        adapter.seed({ date: "2026-06-10", rate: 0.0525 });
      }
      const result = await adapter.fetchRate();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.rate).toBe("number");
      expect(Number.isFinite(result.value.rate)).toBe(true);
      expect(result.value.rate).toBeGreaterThan(0);
    });

    it("returned date is a non-empty YYYY-MM-DD string", async () => {
      if (adapter.seed) {
        adapter.seed({ date: "2026-06-10", rate: 0.0525 });
      }
      const result = await adapter.fetchRate();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("in-memory adapter: seed overrides previous value", async () => {
      if (!adapter.seed) {
        // HTTP adapter — just validate ok
        const r = await adapter.fetchRate();
        expect(r.ok).toBe(true);
        return;
      }
      adapter.seed({ date: "2026-06-10", rate: 0.05 });
      adapter.seed({ date: "2026-06-11", rate: 0.052 });
      const result = await adapter.fetchRate();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBeCloseTo(0.052, 8);
      expect(result.value.date).toBe("2026-06-11");
    });
  });
}
