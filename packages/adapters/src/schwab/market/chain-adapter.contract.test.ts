import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ok } from "@morai/shared";
import { runChainContractTests } from "../../__contract__/chain.contract.ts";
import { makeSchwabChainAdapter } from "./chain-adapter.ts";
import schwabChainFixture from "../../../test/fixtures/schwab-chain.fixture.json";

const SCHWAB_CHAIN_URL = "https://api.schwabapi.com/marketdata/v1/chains";

const server = setupServer(
  http.get(SCHWAB_CHAIN_URL, () => HttpResponse.json(schwabChainFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Contract test: Schwab chain adapter (msw-backed).
 *
 * Proves the Schwab adapter satisfies the SAME ForFetchingChain contract as CBOE
 * (PATTERNS.md chain-adapter section — mirror cboe.contract.test.ts).
 */
describe("schwab chain adapter (msw-backed)", () => {
  runChainContractTests(() => {
    const adapter = makeSchwabChainAdapter({
      fetch: globalThis.fetch,
      getAccessToken: async () => ok("test-access-token"),
      userAgent: "Morai-Test/1.0",
      symbol: "$SPX",
      strikeCount: 50,
      range: "NTM",
      fromDate: "2026-06-21",
      toDate: "2026-09-21",
    });
    return { fetchChain: adapter.fetchChain };
  });
});
