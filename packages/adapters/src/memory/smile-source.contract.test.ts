/**
 * Contract test for the in-memory leg-observations smile-source read.
 * No Docker — proves the twin satisfies the SAME shared smile-source contract suite the Postgres
 * adapter must satisfy (architecture-boundaries §8).
 */

import {
  runSmileSourceContractTests,
  type SmileSourceRepo,
} from "../__contract__/smile-source.contract.ts";
import { makeMemoryLegObservationsRepo } from "./leg-observations.ts";

runSmileSourceContractTests((): SmileSourceRepo => {
  const repo = makeMemoryLegObservationsRepo();
  return {
    readSmile: repo.readSmile,
    seedLeg: async (leg): Promise<void> => {
      repo.seedSmileLeg({
        snapshotTime: leg.snapshotTime,
        underlying: leg.underlying,
        expiration: leg.expiration,
        strike: leg.strike,
        bsmIv: leg.bsmIv,
        bsmDelta: leg.bsmDelta,
      });
    },
  };
});
