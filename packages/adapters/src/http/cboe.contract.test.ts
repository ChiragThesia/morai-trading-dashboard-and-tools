import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { runChainContractTests } from "../__contract__/chain.contract.ts";
import { makeCboeChainAdapter } from "./cboe.ts";
import spxFixture from "../../test/fixtures/cboe-spx.fixture.json";

const CBOE_SPX_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";

const server = setupServer(
  http.get(CBOE_SPX_URL, () => HttpResponse.json(spxFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Contract test for the CBOE chain adapter backed by msw.
 * No Docker required — uses msw to mock the CBOE CDN.
 */
describe("cboe chain adapter (msw-backed)", () => {
  runChainContractTests(() => {
    const adapter = makeCboeChainAdapter({
      fetch: globalThis.fetch,
      userAgent: "Morai-Test/1.0",
    });
    return { fetchChain: adapter.fetchChain };
  });
});
