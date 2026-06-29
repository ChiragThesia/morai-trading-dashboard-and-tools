import { describe, it, expect } from "vitest";
import { runCotReportContractTests } from "../__contract__/cot.contract.ts";
import { makeMemoryCotReportAdapter } from "./cot.ts";
import { knownCotReport } from "../__contract__/cot.contract.ts";

/**
 * Contract test for the in-memory ForFetchingCotReport adapter.
 * No Docker, no network — runs always.
 */
describe("in-memory CotReport adapter", () => {
  runCotReportContractTests(() => {
    const adapter = makeMemoryCotReportAdapter();
    return {
      fetchReport: adapter.fetchReport,
      seed: (report) => adapter.seed(report),
    };
  });

  /**
   * WR-04 regression: memory twin must NOT return the seeded report for a
   * contractCode that differs from the seeded one.  The real CFTC adapter
   * queries Socrata by code — the twin must honour the same contract.
   *
   * These tests are memory-adapter-specific and do NOT live in the shared
   * __contract__/cot.contract.ts because the HTTP adapter (msw-backed) does
   * not have a per-code seed mechanism.
   */
  describe("WR-04: fetchReport honours contractCode (not a wildcard lookup)", () => {
    it("returns err when called with a code different from the seeded code", async () => {
      // RED test: seed "13874A", call with "WRONG" → must err.
      // Before WR-04 fix the twin ignores _contractCode and returns ok(stored) for any code.
      const adapter = makeMemoryCotReportAdapter();
      adapter.seed(knownCotReport); // contractCode = "13874A"
      const result = await adapter.fetchReport("WRONG");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns ok when called with the exact seeded code", async () => {
      const adapter = makeMemoryCotReportAdapter();
      adapter.seed(knownCotReport); // contractCode = "13874A"
      const result = await adapter.fetchReport("13874A");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.contractCode).toBe("13874A");
    });

    it("can seed multiple codes and resolves each independently", async () => {
      const adapter = makeMemoryCotReportAdapter();
      const reportA = { ...knownCotReport, contractCode: "13874A", openInterest: 1_000_000 };
      const reportB = { ...knownCotReport, contractCode: "OIL001", openInterest: 2_000_000 };
      adapter.seed(reportA);
      adapter.seed(reportB);

      const resultA = await adapter.fetchReport("13874A");
      expect(resultA.ok).toBe(true);
      if (resultA.ok) expect(resultA.value.openInterest).toBe(1_000_000);

      const resultB = await adapter.fetchReport("OIL001");
      expect(resultB.ok).toBe(true);
      if (resultB.ok) expect(resultB.value.openInterest).toBe(2_000_000);

      // Unseeded code still returns err
      const resultC = await adapter.fetchReport("UNKNOWN");
      expect(resultC.ok).toBe(false);
    });
  });
});
