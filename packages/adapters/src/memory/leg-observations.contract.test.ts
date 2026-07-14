import { describe } from "vitest";
import { runLegObservationForSlotContractTests } from "../__contract__/leg-observations.contract.ts";
import { makeMemoryLegObservationsRepo } from "./leg-observations.ts";
import type { MemoryLegObservationsRepo } from "./leg-observations.ts";

/**
 * Contract test for the in-memory leg-observations adapter's as-of-slot read
 * (ForResolvingLegObservationForSlot, HIST-02). No Docker required — runs always.
 *
 * Only the as-of-slot suite runs here (not the full runLegObservationsContractTests) — the
 * memory twin implements resolveLegObservationForSlot but not upsertContracts/readPendingObs/
 * writeBsmResults (Postgres-only BSM-pipeline ports), so the full suite cannot run against it.
 */
describe("in-memory leg-observations adapter — as-of-slot read", () => {
  // Holder so getSeedContext (created first) can reference the repo created by makeRepo.
  const holder: { current: MemoryLegObservationsRepo | null } = { current: null };

  runLegObservationForSlotContractTests(
    (_seed) => {
      const repo = makeMemoryLegObservationsRepo();
      holder.current = repo;
      return { resolveLegObservationForSlot: repo.resolveLegObservationForSlot };
    },
    () => ({
      seedContract: async (): Promise<void> => {
        // Memory adapter resolves legs via the occSymbol's own embedded root — no separate
        // contracts table (mirrors calendar-snapshots' SeedContext.seedContract memory no-op).
      },
      seedObservation: async (
        occ,
        time,
        mark,
        underlyingPrice,
      ): Promise<void> => {
        if (holder.current === null) {
          throw new Error("seedObservation called before makeRepo — holder not populated");
        }
        await holder.current.persistObservations([
          {
            time,
            contract: occ,
            bid: mark,
            ask: mark,
            mark,
            underlyingPrice,
            iv: null,
            delta: null,
            gamma: null,
            theta: null,
            vega: null,
            openInterest: 0,
            volume: 0,
            source: "cboe",
          },
        ]);
      },
    }),
  );
});
