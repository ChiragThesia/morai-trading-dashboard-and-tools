/**
 * Contract test for the in-memory term-structure-observations twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME
 * shared contract suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import {
  runTermStructureContractTests,
  type TermStructureSeedContext,
} from "../__contract__/term-structure-observations.contract.ts";
import { makeMemoryTermStructureObservationsRepo } from "./term-structure-observations.ts";

runTermStructureContractTests(
  () => {
    const repo = makeMemoryTermStructureObservationsRepo();
    return {
      storeTermStructureObservations: repo.storeTermStructureObservations,
      readTermStructureSeries: repo.readTermStructureSeries,
      countObservations: repo.countObservations,
    };
  },
  (): TermStructureSeedContext => ({
    // The in-memory twin has no FK; seeding a calendar is a no-op for parity.
    seedCalendar: async (): Promise<void> => {},
  }),
);
