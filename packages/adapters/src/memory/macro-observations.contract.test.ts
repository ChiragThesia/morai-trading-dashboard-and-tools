import { describe } from "vitest";
import { runMacroObservationsContractTests } from "../__contract__/macro-observations.contract.ts";
import { makeMemoryMacroObservationsRepo } from "./macro-observations.ts";

/**
 * Contract test for the in-memory macro-observations adapter.
 * No Docker required — always runs (no describe.skipIf).
 *
 * runMacroObservationsContractTests calls makeRepo() in its own beforeEach, so
 * each test in this suite receives a fresh in-memory store (empty by construction).
 *
 * Satisfies architecture-boundaries.md §8: "ship the in-memory twin in the same PR".
 */
describe("memory macro-observations adapter", () => {
  runMacroObservationsContractTests(() => makeMemoryMacroObservationsRepo());
});
