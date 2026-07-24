import { runNewsItemsContractTests } from "../__contract__/news-items.contract.ts";
import { makeMemoryNewsItemsRepo } from "./news-items.ts";

/**
 * Contract test for the in-memory news-items twin (D28).
 * Fresh repo per test — the contract's beforeEach calls makeRepo again.
 */

runNewsItemsContractTests(() => {
  const repo = makeMemoryNewsItemsRepo();
  return {
    upsertNewsItems: repo.upsertNewsItems,
    listNewsItems: repo.listNewsItems,
  };
});
