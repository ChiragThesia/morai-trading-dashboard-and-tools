/**
 * Contract test for the in-memory calendar-ranking twin.
 * No Docker — runs in plain workspace mode. Proves the twin satisfies the SAME shared
 * contract suite the Postgres adapter must satisfy (architecture-boundaries §8).
 */

import { runCalendarRankingContractTests } from "../__contract__/calendar-ranking.contract.ts";
import { makeMemoryCalendarRankingRepo } from "./calendar-ranking.ts";

runCalendarRankingContractTests(() => {
  const repo = makeMemoryCalendarRankingRepo();
  return {
    insertCalendarRanking: repo.insertCalendarRanking,
    countRows: repo.countRows,
  };
});
