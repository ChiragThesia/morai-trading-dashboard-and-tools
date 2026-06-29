import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { runCotReportContractTests } from "../__contract__/cot.contract.ts";
import { makeCftcCotAdapter } from "./cftc.ts";
import cotFixture from "./__fixtures__/cot-tff-emini.json";

const CFTC_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";

// Default msw handler: return the captured TFF fixture for any query
const server = setupServer(
  http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Contract test for the CFTC HTTP adapter.
 * Uses msw to serve the captured cot-tff-emini.json fixture.
 * Proves the HTTP adapter satisfies the same ForFetchingCotReport contract as the memory twin.
 */
describe("CFTC HTTP CotReport adapter", () => {
  runCotReportContractTests(() => ({
    fetchReport: makeCftcCotAdapter({ fetch: globalThis.fetch }),
  }));
});
