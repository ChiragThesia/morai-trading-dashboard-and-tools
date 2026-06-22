/**
 * Contract test for the in-memory skew-observations twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared contract
 * suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import {
  runSkewContractTests,
  type SkewSeedContext,
} from "../__contract__/skew-observations.contract.ts";
import { makeMemorySkewObservationsRepo } from "./skew-observations.ts";

runSkewContractTests(
  () => {
    const repo = makeMemorySkewObservationsRepo();
    return {
      storeSkewObservations: repo.storeSkewObservations,
      readSkewSmileDetail: repo.readSkewSmileDetail,
      countObservations: repo.countObservations,
    };
  },
  (): SkewSeedContext => ({
    seedNoop: async (): Promise<void> => {},
  }),
);
