import { describe } from "vitest";
import { runRuleOverridesContractTests } from "../__contract__/rule-overrides.contract.ts";
import { makeMemoryRuleOverridesRepo } from "./rule-overrides.ts";

/**
 * Contract test for the in-memory rule-overrides adapter (Phase 29, 29-08).
 * No Docker required — runs always. Verifies twin parity with the Postgres adapter per
 * architecture-boundaries §8.
 */
describe("in-memory rule-overrides adapter", () => {
  runRuleOverridesContractTests(() => {
    const repo = makeMemoryRuleOverridesRepo();
    return {
      readRuleOverrides: repo.readRuleOverrides,
      writeRuleOverrides: repo.writeRuleOverrides,
      seedRawOverrides: async (rawBlob: unknown): Promise<void> => {
        repo.seedRawOverrides(rawBlob);
      },
    };
  });
});
