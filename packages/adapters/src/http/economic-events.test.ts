import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeEconomicEventsAdapter, FOMC_SEED } from "./economic-events.ts";

const FRED_RELEASE_DATES_URL = "https://api.stlouisfed.org/fred/release/dates";

function releaseDatesResponse(
  rows: ReadonlyArray<{ release_id: number; date: string; release_name?: string }>,
) {
  return { release_dates: rows };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeAdapter(apiKey: string | undefined = "test-api-key") {
  return makeEconomicEventsAdapter({
    fetch: globalThis.fetch,
    apiKey,
    fomcSeed: FOMC_SEED,
  });
}

describe("makeEconomicEventsAdapter", () => {
  it("unions FRED CPI (release_id=10) + NFP (release_id=50) with the FOMC seed into one sorted-by-date array", async () => {
    server.use(
      http.get(FRED_RELEASE_DATES_URL, ({ request }) => {
        const url = new URL(request.url);
        const releaseId = url.searchParams.get("release_id");
        if (releaseId === "10") {
          return HttpResponse.json(
            releaseDatesResponse([
              { release_id: 10, release_name: "Consumer Price Index", date: "2026-08-12" },
            ]),
          );
        }
        if (releaseId === "50") {
          return HttpResponse.json(
            releaseDatesResponse([
              { release_id: 50, release_name: "Employment Situation", date: "2026-08-07" },
            ]),
          );
        }
        return HttpResponse.json(releaseDatesResponse([]));
      }),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cpiRow = result.value.find((e) => e.name === "CPI");
    expect(cpiRow).toEqual({ date: "2026-08-12", name: "CPI", source: "fred" });

    const nfpRow = result.value.find((e) => e.name === "NFP");
    expect(nfpRow).toEqual({ date: "2026-08-07", name: "NFP", source: "fred" });

    // FOMC seed rows are present, tagged source:"seed"
    const fomcRows = result.value.filter((e) => e.name === "FOMC");
    expect(fomcRows.length).toBeGreaterThan(0);
    for (const row of fomcRows) {
      expect(row.source).toBe("seed");
    }

    // sorted by date ascending
    const dates = result.value.map((e) => e.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  // ── WR-05: FOMC_SEED is unioned regardless of FRED fetch success/failure — the seed
  // supplements CPI/NFP, it never depends on them. Only the FRED-sourced CPI/NFP rows drop
  // out on a failure; the seed (and whichever of CPI/NFP DID succeed) is always returned.

  it("WR-05: returns ok(FOMC seed only) when apiKey is undefined — no fetch attempted, key never logged, seed never gated by FRED", async () => {
    const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
    const adapter = makeEconomicEventsAdapter({
      fetch: fetchSpy,
      apiKey: undefined,
      fomcSeed: FOMC_SEED,
    });
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([...FOMC_SEED].sort((a, b) => (a.date < b.date ? -1 : 1)));
    expect(result.value.some((e) => e.name === "CPI" || e.name === "NFP")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("WR-05: returns ok(FOMC seed only) when apiKey is empty string", async () => {
    const fetchSpy: typeof fetch = vi.fn<typeof fetch>();
    const adapter = makeEconomicEventsAdapter({
      fetch: fetchSpy,
      apiKey: "",
      fomcSeed: FOMC_SEED,
    });
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((e) => e.name === "FOMC")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("WR-05: a malformed CPI payload drops ONLY the CPI rows — NFP + FOMC seed still returned ok", async () => {
    server.use(
      http.get(FRED_RELEASE_DATES_URL, ({ request }) => {
        const url = new URL(request.url);
        const releaseId = url.searchParams.get("release_id");
        if (releaseId === "10") {
          return HttpResponse.json({ not: "the expected shape" }); // CPI malformed
        }
        return HttpResponse.json(
          releaseDatesResponse([{ release_id: 50, date: "2026-08-07" }]), // NFP ok
        );
      }),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((e) => e.name === "CPI")).toBe(false);
    expect(result.value.find((e) => e.name === "NFP")).toEqual({
      date: "2026-08-07",
      name: "NFP",
      source: "fred",
    });
    expect(result.value.some((e) => e.name === "FOMC")).toBe(true);
  });

  it("WR-05: returns ok(FOMC seed only), with static warn text (no key interpolation), when BOTH CPI and NFP get a non-2xx FRED response", async () => {
    server.use(
      http.get(FRED_RELEASE_DATES_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const loggedMessages: unknown[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      loggedMessages.push(...args);
    });
    const adapter = makeEconomicEventsAdapter({
      fetch: globalThis.fetch,
      apiKey: "SUPER_SECRET_KEY_123",
      fomcSeed: FOMC_SEED,
    });
    const result = await adapter();
    warnSpy.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((e) => e.name === "FOMC")).toBe(true);
    const loggedStr = loggedMessages.map(String).join(" ");
    expect(loggedStr).not.toContain("SUPER_SECRET_KEY_123");
  });

  it("WR-05: returns ok(FOMC seed only) on a network throw — never permanently zeroes events (D-17 still holds for CPI/NFP: never fabricated)", async () => {
    server.use(
      http.get(FRED_RELEASE_DATES_URL, () => {
        throw new TypeError("network error");
      }),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((e) => e.name === "FOMC")).toBe(true);
    expect(result.value.length).toBe(FOMC_SEED.length);
  });
});
