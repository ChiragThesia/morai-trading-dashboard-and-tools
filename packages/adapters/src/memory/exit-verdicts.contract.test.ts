import { describe } from "vitest";
import { runExitVerdictsContractTests } from "../__contract__/exit-verdicts.contract.ts";
import { makeMemoryExitVerdictsRepo } from "./exit-verdicts.ts";

/**
 * Contract test for the in-memory exit-verdicts adapter (Phase 26, Plan 03).
 * No Docker required — runs always. Verifies twin parity with the Postgres adapter
 * per architecture-boundaries §8.
 */
describe("in-memory exit-verdicts adapter", () => {
  runExitVerdictsContractTests(() => {
    const repo = makeMemoryExitVerdictsRepo();
    return {
      insertExitVerdict: repo.insertExitVerdict,
      readLatestVerdictsPerCalendar: repo.readLatestVerdictsPerCalendar,
      seedRawVerdict: repo.seedRawVerdict,
    };
  });
});
