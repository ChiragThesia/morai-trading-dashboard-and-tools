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
import { makeAlpacaNewsAdapter } from "./alpaca-news.ts";
import alpacaNewsFixture from "./__fixtures__/alpaca-news.json";

const ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeAdapter(
  keyId: string | undefined = "test-key-id",
  secretKey: string | undefined = "test-secret-key",
) {
  return makeAlpacaNewsAdapter({ fetch: globalThis.fetch, keyId, secretKey });
}

describe("makeAlpacaNewsAdapter", () => {
  describe("Alpaca 200 — valid batch", () => {
    it("returns ok with rows mapped to NewsItemRow (id stringified, dates as Date)", async () => {
      server.use(
        http.get(ALPACA_NEWS_URL, () => HttpResponse.json(alpacaNewsFixture)),
      );

      const result = await makeAdapter()();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      const [first, second] = result.value;
      expect(first?.id).toBe("24843200");
      expect(first?.url).toBeNull(); // "" → null
      expect(first?.summary).toBe("");
      expect(first?.symbols).toEqual([]);
      expect(second?.id).toBe("24843171");
      expect(second?.headline).toBe(
        "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
      );
      expect(second?.url).toBe("https://www.benzinga.com/markets/24843171");
      expect(second?.symbols).toEqual(["SPY", "QQQ"]);
      expect(second?.source).toBe("benzinga");
      expect(second?.publishedAt).toEqual(new Date("2026-07-24T13:05:00Z"));
      expect(second?.updatedAt).toEqual(new Date("2026-07-24T13:06:00Z"));
    });

    it("sends the key pair as APCA headers and requests limit=50 sort=desc", async () => {
      let capturedKeyId: string | null = null;
      let capturedSecret: string | null = null;
      let capturedUrl: URL | undefined;
      server.use(
        http.get(ALPACA_NEWS_URL, ({ request }) => {
          capturedKeyId = request.headers.get("APCA-API-KEY-ID");
          capturedSecret = request.headers.get("APCA-API-SECRET-KEY");
          capturedUrl = new URL(request.url);
          return HttpResponse.json(alpacaNewsFixture);
        }),
      );

      await makeAdapter()();

      expect(capturedKeyId).toBe("test-key-id");
      expect(capturedSecret).toBe("test-secret-key");
      expect(capturedUrl?.searchParams.get("limit")).toBe("50");
      expect(capturedUrl?.searchParams.get("sort")).toBe("desc");
    });
  });

  describe("missing credentials — err, no fetch", () => {
    it("returns err and does NOT call the injected fetch when keyId is undefined", async () => {
      const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
      const adapter = makeAlpacaNewsAdapter({
        fetch: fetchSpy,
        keyId: undefined,
        secretKey: "test-secret-key",
      });

      const result = await adapter();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns err when secretKey is empty, and never logs the key values", async () => {
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter("test-key-id", "");

      const result = await adapter();

      expect(result.ok).toBe(false);
      const allWarnText = warnSpy.mock.calls.flat().join(" ");
      expect(allWarnText).not.toContain("test-key-id");
    });
  });

  describe("Alpaca 500 — err, no fallback", () => {
    it("returns err(fetch-error) with the HTTP status", async () => {
      server.use(
        http.get(ALPACA_NEWS_URL, () => new HttpResponse(null, { status: 500 })),
      );

      const result = await makeAdapter()();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
      expect(result.error.message).toContain("500");
    });
  });

  describe("network error — err", () => {
    it("returns err(fetch-error) when fetch throws", async () => {
      server.use(
        http.get(ALPACA_NEWS_URL, () => {
          throw new TypeError("network error");
        }),
      );

      const result = await makeAdapter()();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });
  });

  describe("unexpected payload — err", () => {
    it("returns err(fetch-error) on a Zod parse failure", async () => {
      server.use(
        http.get(ALPACA_NEWS_URL, () =>
          HttpResponse.json({ news: [{ id: "not-a-number" }] }),
        ),
      );

      const result = await makeAdapter()();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returns ok([]) on an empty news array (valid quiet-wire case)", async () => {
      server.use(
        http.get(ALPACA_NEWS_URL, () =>
          HttpResponse.json({ news: [], next_page_token: null }),
        ),
      );

      const result = await makeAdapter()();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });
  });
});
