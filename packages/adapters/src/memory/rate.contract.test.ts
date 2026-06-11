import { describe } from "vitest";
import { runRateContractTests } from "../__contract__/rate.contract.ts";
import { makeMemoryRateAdapter } from "./rate.ts";

/**
 * Contract test for the in-memory rate adapter.
 * No Docker required — runs always.
 */
describe("in-memory rate adapter", () => {
  runRateContractTests(() => {
    const adapter = makeMemoryRateAdapter();
    return {
      fetchRate: adapter.fetchRate,
      seed: (obs) => adapter.seed(obs),
    };
  });
});
