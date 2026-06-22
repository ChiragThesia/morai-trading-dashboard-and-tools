/**
 * Contract test for the in-memory risk-reversal-observations twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared contract
 * suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import {
  runRiskReversalContractTests,
  type RiskReversalSeedContext,
} from "../__contract__/risk-reversal-observations.contract.ts";
import { makeMemoryRiskReversalObservationsRepo } from "./risk-reversal-observations.ts";

runRiskReversalContractTests(
  () => {
    const repo = makeMemoryRiskReversalObservationsRepo();
    return {
      storeRiskReversalObservations: repo.storeRiskReversalObservations,
      readRiskReversalSeries: repo.readRiskReversalSeries,
      readRiskReversalHistory: repo.readRiskReversalHistory,
      countObservations: repo.countObservations,
    };
  },
  (): RiskReversalSeedContext => ({
    seedNoop: async (): Promise<void> => {},
  }),
);
