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

  describe("WR-01: contractCode SoQL-injection guard", () => {
    it("returns err and never calls fetch when contractCode contains SoQL metacharacters", async () => {
      // RED test: "13874A' OR '1'='1" must be rejected before any URL is built or fetch is called.
      // Before WR-01 fix the adapter builds the $where clause with the injected string and
      // sends a request; the msw handler below would set fetchWasCalled = true.
      let fetchWasCalled = false;
      const mockFetch = async (
        ..._args: Parameters<typeof globalThis.fetch>
      ): Promise<Response> => {
        fetchWasCalled = true;
        return new Response(JSON.stringify([]), { status: 200 });
      };
      const adapter = makeCftcCotAdapter({ fetch: mockFetch });
      const result = await adapter("13874A' OR '1'='1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(fetchWasCalled).toBe(false);
    });

    it("returns err and never calls fetch when contractCode contains a semicolon", async () => {
      let fetchWasCalled = false;
      const mockFetch = async (
        ..._args: Parameters<typeof globalThis.fetch>
      ): Promise<Response> => {
        fetchWasCalled = true;
        return new Response(JSON.stringify([]), { status: 200 });
      };
      const adapter = makeCftcCotAdapter({ fetch: mockFetch });
      const result = await adapter("13874A; DROP TABLE reports;--");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(fetchWasCalled).toBe(false);
    });

    it("accepts the default 13874A contract code (no guard false-positive)", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(true);
    });

    it("accepts the combined E-mini code 13874+ (plus sign is valid in CFTC codes)", async () => {
      server.use(
        http.get(CFTC_URL, () => HttpResponse.json(cotFixture)),
      );
      const adapter = makeAdapter();
      // 13874+ is the combined futures+options code — must not be rejected by the guard
      const result = await adapter("13874+");
      // The adapter calls fetch (code passes guard); result shape depends on fixture
      // We only assert the guard itself did not fire (no early-err before fetch)
      // — if the fixture doesn't match, the Zod parse will err, which is fine.
      // Just confirm it is NOT the "invalid contractCode format" path.
      if (!result.ok) {
        expect(result.error.message).not.toContain("invalid contractCode");
      }
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

  describe("WR-02: malformed report_date_as_yyyy_mm_dd → err (parse boundary violation)", () => {
    it("returns err when report_date_as_yyyy_mm_dd is a non-ISO date string (e.g. US-locale format)", async () => {
      // RED test: today "06/23/2026" passes z.string() but must NOT pass the ISO-prefix guard.
      // Before WR-02 fix this wrongly returns ok with asOf="06/23/202" (garbage).
      server.use(
        http.get(CFTC_URL, () =>
          HttpResponse.json([
            {
              report_date_as_yyyy_mm_dd: "06/23/2026",
              cftc_contract_market_code: "13874A",
              open_interest_all: "2987456",
              dealer_positions_long_all: "140230",
              dealer_positions_short_all: "89560",
              asset_mgr_positions_long_all: "1102340",
              asset_mgr_positions_short_all: "654320",
              lev_money_positions_long_all: "387650",
              lev_money_positions_short_all: "523410",
              other_rept_positions_long_all: "210870",
              other_rept_positions_short_all: "198340",
              nonrept_positions_long_all: "145000",
              nonrept_positions_short_all: "132780",
            },
          ]),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns err when report_date_as_yyyy_mm_dd is a plain garbage string", async () => {
      server.use(
        http.get(CFTC_URL, () =>
          HttpResponse.json([
            {
              report_date_as_yyyy_mm_dd: "garbage",
              cftc_contract_market_code: "13874A",
              open_interest_all: "2987456",
              dealer_positions_long_all: "140230",
              dealer_positions_short_all: "89560",
              asset_mgr_positions_long_all: "1102340",
              asset_mgr_positions_short_all: "654320",
              lev_money_positions_long_all: "387650",
              lev_money_positions_short_all: "523410",
              other_rept_positions_long_all: "210870",
              other_rept_positions_short_all: "198340",
              nonrept_positions_long_all: "145000",
              nonrept_positions_short_all: "132780",
            },
          ]),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("still returns ok when date has ISO timestamp suffix (normal Socrata format)", async () => {
      // Regression guard: the normal "2026-06-23T00:00:00.000" must still succeed
      server.use(
        http.get(CFTC_URL, () =>
          HttpResponse.json([
            {
              report_date_as_yyyy_mm_dd: "2026-06-23T00:00:00.000",
              cftc_contract_market_code: "13874A",
              open_interest_all: "2987456",
              dealer_positions_long_all: "140230",
              dealer_positions_short_all: "89560",
              asset_mgr_positions_long_all: "1102340",
              asset_mgr_positions_short_all: "654320",
              lev_money_positions_long_all: "387650",
              lev_money_positions_short_all: "523410",
              other_rept_positions_long_all: "210870",
              other_rept_positions_short_all: "198340",
              nonrept_positions_long_all: "145000",
              nonrept_positions_short_all: "132780",
            },
          ]),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter("13874A");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.asOf).toBe("2026-06-23");
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
