import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { runRateContractTests } from "../__contract__/rate.contract.ts";
import { makeFredRateAdapter } from "./fred.ts";

const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";

// Default msw handler: return a valid FRED response
const server = setupServer(
  http.get(FRED_URL, () =>
    HttpResponse.json({
      observations: [{ date: "2026-06-10", value: "5.25" }],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Contract test for the FRED HTTP rate adapter.
 * Uses msw to mock the FRED network layer.
 */
describe("FRED HTTP rate adapter", () => {
  runRateContractTests(() => ({
    fetchRate: makeFredRateAdapter({
      fetch: globalThis.fetch,
      apiKey: "test-api-key",
      fallbackRate: 0.045,
    }),
  }));
});
