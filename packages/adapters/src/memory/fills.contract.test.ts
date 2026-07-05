import { describe, beforeEach } from "vitest";
import { runFillsContractTests } from "../__contract__/fills.contract.ts";
import { makeMemoryFillsRepo } from "./fills.ts";

/**
 * Contract test for the in-memory fills twin (A1 + A3).
 * Always runs (no Docker). Mirrors the Postgres adapter's behavior.
 */

describe("in-memory fills twin", () => {
  let repo: ReturnType<typeof makeMemoryFillsRepo>;

  beforeEach(() => {
    repo = makeMemoryFillsRepo();
  });

  runFillsContractTests(
    () => ({
      readUnprocessedFills: repo.readUnprocessedFills,
      readUnprocessedFillsForCalendar: repo.readUnprocessedFillsForCalendar,
      readCalendarLegs: repo.readCalendarLegs,
      resetCalendarAmounts: repo.resetCalendarAmounts,
      recomputeCalendarAmounts: repo.recomputeCalendarAmounts,
      markFillsProcessed: repo.markFillsProcessed,
      writeFills: repo.writeFills,
      wipeDerivedFills: repo.wipeDerivedFills,
    }),
    () => ({
      seedCalendar: async (cal) => repo.seedCalendar(cal),
      seedEvent: async (event) => repo.seedEvent(event),
      seedOrphan: async (orphan) => repo.seedOrphan(orphan),
      readCalendarAmounts: async (calendarId) => repo.readCalendarAmounts(calendarId),
      countFills: async () => repo.countFills(),
      readProcessedFillIds: async () => repo.readProcessedFillIds(),
      countEvents: async () => repo.countEvents(),
      countOrphans: async () => repo.countOrphans(),
    }),
  );
});
