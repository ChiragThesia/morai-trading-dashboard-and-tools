import { describe } from "vitest";
import { runChainContractTests } from "../__contract__/chain.contract.ts";
import { makeMemoryChainAdapter } from "./chain.ts";

/**
 * Contract test for the in-memory chain adapter.
 * No Docker required — runs always.
 */
describe("in-memory chain adapter", () => {
  runChainContractTests(() => makeMemoryChainAdapter());
});
