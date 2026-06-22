import { describe } from "vitest";
import { runOrphanFillsContractTests } from "../__contract__/orphan-fills.contract.ts";
import { makeMemoryOrphanFillsRepo } from "./orphan-fills.ts";
import type { OrphanFillsSeedContext } from "../__contract__/orphan-fills.contract.ts";

/**
 * Contract test for the in-memory orphan-fills adapter.
 * No Docker required — runs always.
 *
 * Verifies twin parity with the Postgres adapter per architecture-boundaries §8.
 * In particular: storeOrphanFill with same fillId twice MUST be a no-op (idempotent).
 */
describe("in-memory orphan-fills adapter", () => {
  runOrphanFillsContractTests(
    (_seed) => {
      const repo = makeMemoryOrphanFillsRepo();
      return {
        storeOrphanFill: repo.storeOrphanFill,
        countOrphans: repo.countOrphans,
        getAllOrphans: repo.getAllOrphans,
      };
    },
    (): OrphanFillsSeedContext => ({
      __dummy: undefined,
    }),
  );
});
