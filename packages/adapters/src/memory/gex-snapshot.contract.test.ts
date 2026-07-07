/**
 * Contract test for the in-memory GEX snapshot twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared contract
 * suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import {
  runGexSnapshotContractTests,
  type GexSnapshotSeedContext,
} from "../__contract__/gex-snapshot.contract.ts";
import { makeMemoryGexSnapshotRepo, type MemoryGexSnapshotRepo } from "./gex-snapshot.ts";

// The suite creates the seed context BEFORE the repo; seedLegs resolves the repo at call time.
let currentRepo: MemoryGexSnapshotRepo | undefined;

runGexSnapshotContractTests(
  () => {
    currentRepo = makeMemoryGexSnapshotRepo();
    return {
      readLegObsForGex: currentRepo.readLegObsForGex,
      persistGexSnapshot: currentRepo.persistGexSnapshot,
      readGexSnapshot: currentRepo.readGexSnapshot,
      countSnapshots: currentRepo.countSnapshots,
    };
  },
  (): GexSnapshotSeedContext => ({
    seedLegs: async (legs) => {
      currentRepo?.seedLegs(legs ?? []);
    },
  }),
);
