import { describe, it, expect, beforeEach } from "vitest";
import type { ForFetchingCotReport, CotReport } from "@morai/core";

/**
 * Shared contract-test suite for the ForFetchingCotReport port.
 * Run against BOTH the CFTC HTTP adapter (msw-backed) and the in-memory twin.
 *
 * Adapter type includes an optional `seed` for in-memory adapters.
 * The msw-backed subject is pre-seeded via its msw handler returning the fixture.
 */
export type CotAdapter = {
  readonly fetchReport: ForFetchingCotReport;
  readonly seed?: (report: CotReport) => void;
};

// Known fixture values — mirror cot-tff-emini.json
const KNOWN_CONTRACT_CODE = "13874A";
const KNOWN_AS_OF = "2026-06-23";
const KNOWN_OPEN_INTEREST = 2987456;
const KNOWN_LEV_MONEY_LONG = 387650;
const KNOWN_LEV_MONEY_SHORT = 523410;

export const knownCotReport: CotReport = {
  contractCode: KNOWN_CONTRACT_CODE,
  asOf: KNOWN_AS_OF,
  openInterest: KNOWN_OPEN_INTEREST,
  dealerLong: 140230,
  dealerShort: 89560,
  assetMgrLong: 1102340,
  assetMgrShort: 654320,
  levMoneyLong: KNOWN_LEV_MONEY_LONG,
  levMoneyShort: KNOWN_LEV_MONEY_SHORT,
  otherReptLong: 210870,
  otherReptShort: 198340,
  nonreptLong: 145000,
  nonreptShort: 132780,
};

export function runCotReportContractTests(
  makeAdapter: () => CotAdapter,
): void {
  describe("ForFetchingCotReport port contract", () => {
    let adapter: CotAdapter;

    beforeEach(() => {
      adapter = makeAdapter();
    });

    it("returns ok(CotReport) with the seeded/known contractCode", async () => {
      if (adapter.seed) {
        adapter.seed(knownCotReport);
      }
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.contractCode).toBe(KNOWN_CONTRACT_CODE);
    });

    it("returns ok(CotReport) with the seeded/known asOf date", async () => {
      if (adapter.seed) {
        adapter.seed(knownCotReport);
      }
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // asOf must be a YYYY-MM-DD string from the report's own date field (landmine 3)
      expect(result.value.asOf).toBe(KNOWN_AS_OF);
      expect(result.value.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns ok(CotReport) with the seeded/known openInterest", async () => {
      if (adapter.seed) {
        adapter.seed(knownCotReport);
      }
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.value.openInterest).toBe("number");
      expect(result.value.openInterest).toBe(KNOWN_OPEN_INTEREST);
    });

    it("returns ok(CotReport) with correct leveraged-funds legs (headline D-05 signal)", async () => {
      if (adapter.seed) {
        adapter.seed(knownCotReport);
      }
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.levMoneyLong).toBe(KNOWN_LEV_MONEY_LONG);
      expect(result.value.levMoneyShort).toBe(KNOWN_LEV_MONEY_SHORT);
    });

    it("returned CotReport has all 10 numeric legs as finite numbers", async () => {
      if (adapter.seed) {
        adapter.seed(knownCotReport);
      }
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const r = result.value;
      const numericLegs: ReadonlyArray<number> = [
        r.dealerLong, r.dealerShort,
        r.assetMgrLong, r.assetMgrShort,
        r.levMoneyLong, r.levMoneyShort,
        r.otherReptLong, r.otherReptShort,
        r.nonreptLong, r.nonreptShort,
      ];
      for (const leg of numericLegs) {
        expect(typeof leg).toBe("number");
        expect(Number.isFinite(leg)).toBe(true);
      }
    });

    it("in-memory adapter: seed overrides previous value", async () => {
      if (!adapter.seed) {
        // HTTP adapter — just validate ok
        const r = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
        expect(r.ok).toBe(true);
        return;
      }
      const firstReport: CotReport = { ...knownCotReport, openInterest: 1000000 };
      const secondReport: CotReport = { ...knownCotReport, openInterest: 2000000 };
      adapter.seed(firstReport);
      adapter.seed(secondReport);
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.openInterest).toBe(2000000);
    });

    it("in-memory adapter unseeded: returns err (no fabricated fallback — landmine 4)", async () => {
      if (!adapter.seed) {
        // HTTP adapter — not applicable; skip
        return;
      }
      // Do NOT call seed — verify unseeded returns err, never a fake row
      const result = await adapter.fetchReport(KNOWN_CONTRACT_CODE);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });
  });
}
