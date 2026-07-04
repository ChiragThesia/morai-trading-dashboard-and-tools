import { describe } from "vitest";
import { runEconomicEventsContractTests } from "../__contract__/economic-events.contract.ts";
import { makeMemoryEconomicEventsRepo } from "./economic-events.ts";

/**
 * Contract test for the in-memory economic-events adapter.
 * No Docker required — always runs (no describe.skipIf).
 *
 * runEconomicEventsContractTests calls makeRepo() in its own beforeEach, so each test in this
 * suite receives a fresh in-memory store (empty by construction).
 *
 * Satisfies architecture-boundaries.md §8: "ship the in-memory twin in the same PR".
 */
describe("memory economic-events adapter", () => {
  runEconomicEventsContractTests(() => makeMemoryEconomicEventsRepo());
});
