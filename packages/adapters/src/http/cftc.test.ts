import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeCftcCotAdapter } from "./cftc.ts";
import cotFixture from "./__fixtures__/cot-tff-emini.json";

const CFTC_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeAdapter() {
  return makeCftcCotAdapter({ fetch: globalThis.fetch });
}

describe("makeCftcCotAdapter", () => {
  describe("200 — successful TFF row (string→number coercion)", () => {
    it("returns ok(CotReport) with all numeric fields coerced from strings", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const report = result.value;
      // Every numeric field must be a JS number (coerced from Socrata string)
      expect(typeof report.openInterest).toBe("number");
      expect(typeof report.dealerLong).toBe("number");
      expect(typeof report.dealerShort).toBe("number");
      expect(typeof report.assetMgrLong).toBe("number");
      expect(typeof report.assetMgrShort).toBe("number");
      expect(typeof report.levMoneyLong).toBe("number");
      expect(typeof report.levMoneyShort).toBe("number");
      expect(typeof report.otherReptLong).toBe("number");
      expect(typeof report.otherReptShort).toBe("number");
      expect(typeof report.nonreptLong).toBe("number");
      expect(typeof report.nonreptShort).toBe("number");
      // Verify actual values from fixture (string "2987456" → number 2987456)
      expect(report.openInterest).toBe(2987456);
      expect(report.dealerLong).toBe(140230);
      expect(report.dealerShort).toBe(89560);
      expect(report.assetMgrLong).toBe(1102340);
      expect(report.assetMgrShort).toBe(654320);
      expect(report.levMoneyLong).toBe(387650);
      expect(report.levMoneyShort).toBe(523410);
      expect(report.otherReptLong).toBe(210870);
      expect(report.otherReptShort).toBe(198340);
      expect(report.nonreptLong).toBe(145000);
      expect(report.nonreptShort).toBe(132780);
    });

    it("asOf equals the date part of report_date_as_yyyy_mm_dd, NOT date-math", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Fixture has "2026-06-23T00:00:00.000" → asOf must be "2026-06-23"
      expect(result.value.asOf).toBe("2026-06-23");
      // Ensure it's a YYYY-MM-DD string (exactly 10 chars, no time component)
      expect(result.value.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("contractCode equals the passed argument", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.contractCode).toBe("13874A");
    });
  });

  describe("URL contract — $where filter uses 13874A (landmine 2)", () => {
    it("sends $where=cftc_contract_market_code='13874A', $order=DESC, $limit=1", async () => {
      let capturedUrl: string | undefined;
      server.use(
        http.get(CFTC_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(cotFixture);
        }),
      );
      const adapter = makeAdapter();
      await adapter("13874A");
      expect(capturedUrl).toBeDefined();
      if (capturedUrl === undefined) return;
      const parsed = new URL(capturedUrl);
      // $where must use exact contract code (not name LIKE)
      expect(parsed.searchParams.get("$where")).toBe(
        "cftc_contract_market_code='13874A'",
      );
      // Must sort descending by report date
      expect(parsed.searchParams.get("$order")).toBe(
        "report_date_as_yyyy_mm_dd DESC",
      );
      // Must request exactly 1 row (D-06: current week only)
      expect(parsed.searchParams.get("$limit")).toBe("1");
    });
  });

  describe("non-2xx response → err (no throw, no fallback)", () => {
    it("returns err when Socrata responds 500", async () => {
      server.use(
        http.get(CFTC_URL, () => new HttpResponse(null, { status: 500 })),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns err when Socrata responds 404", async () => {
      server.use(
        http.get(CFTC_URL, () => new HttpResponse(null, { status: 404 })),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns err when Socrata responds 429 (rate-limited)", async () => {
      server.use(
        http.get(CFTC_URL, () => new HttpResponse(null, { status: 429 })),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });
  });

  describe("network error → err (no throw)", () => {
    it("returns err and calls console.warn when fetch throws", async () => {
      server.use(
        http.get(CFTC_URL, () => {
          throw new TypeError("network error");
        }),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe("empty array → err (landmine 4 — no fabricated fallback)", () => {
    it("returns err when Socrata returns an empty array", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json([])),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe("malformed body → err (Zod parse failure, landmine 4)", () => {
    it("returns err when response body is not an array", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json({ error: "bad" })),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns err when row is missing required numeric fields", async () => {
      server.use(
        http.get(CFTC_URL, () =>
          HttpResponse.json([
            {
              report_date_as_yyyy_mm_dd: "2026-06-23T00:00:00.000",
              cftc_contract_market_code: "13874A",
              // missing all numeric position fields
            },
          ]),
        ),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });
});
