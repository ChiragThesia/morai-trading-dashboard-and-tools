import { describe } from "vitest";
import { runCotReportContractTests } from "../__contract__/cot.contract.ts";
import { makeMemoryCotReportAdapter } from "./cot.ts";

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
});
