/**
 * Contract test for the in-memory picker-snapshot twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared
 * contract suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import { runPickerSnapshotContractTests } from "../__contract__/picker-snapshot.contract.ts";
import { makeMemoryPickerSnapshotRepo } from "./picker-snapshot.ts";

runPickerSnapshotContractTests(() => {
  const repo = makeMemoryPickerSnapshotRepo();
  return {
    insertPickerSnapshot: repo.insertPickerSnapshot,
    readPickerSnapshot: repo.readPickerSnapshot,
    countSnapshots: repo.countSnapshots,
  };
});
