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
import { makeFredRateAdapter, makeFredSeriesAdapter } from "./fred.ts";

const FRED_URL =
  "https://api.stlouisfed.org/fred/series/observations";

// Build a FRED response with both a '.' row and a valid row
function fredResponse(observations: Array<{ date: string; value: string }>) {
  return { observations };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeAdapter(apiKey: string | undefined = "test-api-key") {
  return makeFredRateAdapter({
    fetch: globalThis.fetch,
    apiKey,
    fallbackRate: 0.045,
  });
}

describe("makeFredRateAdapter", () => {
  describe("FRED 200 — numeric row after a '.' row", () => {
    it("returns ok with the numeric rate, skipping the '.' row (Pitfall 7)", async () => {
      server.use(
        http.get(FRED_URL, () =>
          HttpResponse.json(
            fredResponse([
              { date: "2026-06-11", value: "." },
              { date: "2026-06-10", value: "5.25" },
            ]),
          ),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBeCloseTo(5.25 / 100, 8);
    });

    it("returns ok with rate from the most-recent valid observation (first non-'.' row)", async () => {
      server.use(
        http.get(FRED_URL, () =>
          HttpResponse.json(
            fredResponse([
              { date: "2026-06-09", value: "5.10" },
              { date: "2026-06-08", value: "5.05" },
            ]),
          ),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 5.10% → 0.051
      expect(result.value.rate).toBeCloseTo(5.10 / 100, 8);
    });
  });

  describe("FRED 500 — fallback", () => {
    it("returns ok with 0.045 and calls console.warn once when FRED returns 500", async () => {
      server.use(
        http.get(FRED_URL, () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.045);
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe("network error — fallback", () => {
    it("returns ok with 0.045 and calls console.warn once when fetch throws", async () => {
      server.use(
        http.get(FRED_URL, () => {
          throw new TypeError("network error");
        }),
      );
      const warnSpy = vi.spyOn(console, "warn");
      const adapter = makeAdapter();
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.045);
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe("apiKey undefined — immediate fallback, no fetch", () => {
    it("returns ok with 0.045 and does NOT call the injected fetch", async () => {
      // Use a properly-typed mock rather than an `as` cast (typescript.md)
      const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
      const adapter = makeFredRateAdapter({
        fetch: fetchSpy,
        apiKey: undefined,
        fallbackRate: 0.045,
      });
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.045);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns ok with 0.045 when apiKey is empty string", async () => {
      const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
      const adapter = makeFredRateAdapter({
        fetch: fetchSpy,
        apiKey: "",
        fallbackRate: 0.045,
      });
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.045);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("FRED_API_KEY never logged (T-02-11)", () => {
    it("warn message on fallback does not contain the api key value", async () => {
      server.use(
        http.get(FRED_URL, () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );
      const loggedMessages: unknown[] = [];
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation((...args) => {
          loggedMessages.push(...args);
        });
      const adapter = makeFredRateAdapter({
        fetch: globalThis.fetch,
        apiKey: "SUPER_SECRET_KEY_123",
        fallbackRate: 0.045,
      });
      await adapter();
      warnSpy.mockRestore();
      const loggedStr = loggedMessages.map(String).join(" ");
      expect(loggedStr).not.toContain("SUPER_SECRET_KEY_123");
    });
  });

  describe("all '.' rows — fallback", () => {
    it("returns ok with 0.045 when all observations are '.'", async () => {
      server.use(
        http.get(FRED_URL, () =>
          HttpResponse.json(
            fredResponse([
              { date: "2026-06-11", value: "." },
              { date: "2026-06-10", value: "." },
            ]),
          ),
        ),
      );
      const adapter = makeAdapter();
      const result = await adapter();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.045);
    });
  });
});

// ─── makeFredSeriesAdapter — parameterized, no-fallback, raw value (MAC-01) ───

function makeSeriesAdapter(apiKey: string | undefined = "test-api-key") {
  return makeFredSeriesAdapter({
    fetch: globalThis.fetch,
    apiKey,
  });
}

describe("makeFredSeriesAdapter", () => {
  it("returns ok with the RAW value (no /100) and seriesId/source set", async () => {
    server.use(
      http.get(FRED_URL, () =>
        HttpResponse.json(fredResponse([{ date: "2026-06-30", value: "18.9" }])),
      ),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // RAW — NOT 0.189
    expect(result.value.value).toBe(18.9);
    expect(result.value.seriesId).toBe("VIXCLS");
    expect(result.value.source).toBe("fred");
    expect(result.value.date).toBe("2026-06-30");
  });

  it("filters '.' rows and takes the most-recent non-'.' observation (sort_order=desc)", async () => {
    server.use(
      http.get(FRED_URL, () =>
        HttpResponse.json(
          fredResponse([
            { date: "2026-06-30", value: "." },
            { date: "2026-06-29", value: "18.5" },
          ]),
        ),
      ),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(18.5);
    expect(result.value.date).toBe("2026-06-29");
  });

  it("returns err when apiKey is undefined (D-09 — no fabricated fallback)", async () => {
    const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
    const adapter = makeFredSeriesAdapter({ fetch: fetchSpy, apiKey: undefined });
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns err when apiKey is empty string (D-09)", async () => {
    const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
    const adapter = makeFredSeriesAdapter({ fetch: fetchSpy, apiKey: "" });
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns err on non-2xx (D-09 — no fallback)", async () => {
    server.use(
      http.get(FRED_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err on network throw (D-09)", async () => {
    server.use(
      http.get(FRED_URL, () => {
        throw new TypeError("network error");
      }),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
  });

  it("returns err on Zod parse failure (D-09)", async () => {
    server.use(
      http.get(FRED_URL, () => HttpResponse.json({ not: "the expected shape" })),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
  });

  it("returns err when all rows are '.' (D-09)", async () => {
    server.use(
      http.get(FRED_URL, () =>
        HttpResponse.json(
          fredResponse([
            { date: "2026-06-30", value: "." },
            { date: "2026-06-29", value: "." },
          ]),
        ),
      ),
    );
    const adapter = makeSeriesAdapter();
    const result = await adapter("VIXCLS");
    expect(result.ok).toBe(false);
  });

  it("never logs the apiKey value in a warn message (static warn text)", async () => {
    server.use(
      http.get(FRED_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const loggedMessages: unknown[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args) => {
        loggedMessages.push(...args);
      });
    const adapter = makeFredSeriesAdapter({
      fetch: globalThis.fetch,
      apiKey: "SUPER_SECRET_KEY_123",
    });
    await adapter("VIXCLS");
    warnSpy.mockRestore();
    const loggedStr = loggedMessages.map(String).join(" ");
    expect(loggedStr).not.toContain("SUPER_SECRET_KEY_123");
  });
});
