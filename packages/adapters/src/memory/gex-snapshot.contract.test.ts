/**
 * Contract test for the in-memory GEX snapshot twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared contract
 * suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import {
  runGexSnapshotContractTests,
  type GexSnapshotSeedContext,
} from "../__contract__/gex-snapshot.contract.ts";
import { makeMemoryGexSnapshotRepo } from "./gex-snapshot.ts";

runGexSnapshotContractTests(
  () => {
    const repo = makeMemoryGexSnapshotRepo();
    return {
      readLegObsForGex: repo.readLegObsForGex,
      persistGexSnapshot: repo.persistGexSnapshot,
      readGexSnapshot: repo.readGexSnapshot,
      countSnapshots: repo.countSnapshots,
    };
  },
  (): GexSnapshotSeedContext => ({
    seedLegs: async () => {},
  }),
);
