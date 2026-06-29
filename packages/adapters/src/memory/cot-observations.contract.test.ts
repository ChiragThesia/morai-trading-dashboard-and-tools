import { describe } from "vitest";
import { runCotObservationsContractTests } from "../__contract__/cot-observations.contract.ts";
import { makeMemoryCotObservationsRepo } from "./cot-observations.ts";

/**
 * Contract test for the in-memory cot-observations adapter.
 * No Docker required — always runs (no describe.skipIf).
 *
 * runCotObservationsContractTests calls makeRepo() in its own beforeEach, so each
 * test in this suite receives a fresh in-memory store (empty by construction).
 * This satisfies the "empty array" and limit tests without any truncation step.
 *
 * Satisfies architecture-boundaries.md §8: "ship the in-memory twin in the same PR".
 */
describe("memory cot-observations adapter", () => {
  runCotObservationsContractTests(() => makeMemoryCotObservationsRepo());
});
