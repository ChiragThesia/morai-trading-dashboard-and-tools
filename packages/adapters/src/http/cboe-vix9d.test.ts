import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeCboeVix9dAdapter } from "./cboe-vix9d.ts";

const VIX9D_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json";

function vix9dResponse(overrides: {
  timestamp?: string;
  current_price?: number | null;
  close?: number | null;
  prev_day_close?: number | null;
}) {
  return {
    timestamp: overrides.timestamp ?? "2026-07-02 01:00:55",
    data: {
      current_price: "current_price" in overrides ? overrides.current_price : 14.2,
      close: "close" in overrides ? overrides.close : 14.0,
      prev_day_close: "prev_day_close" in overrides ? overrides.prev_day_close : 13.8,
    },
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeAdapter() {
  return makeCboeVix9dAdapter({
    fetch: globalThis.fetch,
    userAgent: "morai-test",
  });
}

describe("makeCboeVix9dAdapter", () => {
  it("returns ok with seriesId VIX9D, RAW value, source cboe, and ET-trading-day date", async () => {
    server.use(
      http.get(VIX9D_URL, () => HttpResponse.json(vix9dResponse({}))),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.seriesId).toBe("VIX9D");
    expect(result.value.value).toBe(14.2);
    expect(result.value.source).toBe("cboe");
    // "2026-07-02 01:00:55" UTC is 21:00:55 ET on July 1 — the row must carry the ET
    // trading day (2026-07-01), not the UTC calendar day (regression gate, review WR-02).
    expect(result.value.date).toBe("2026-07-01");
  });

  it("falls through current_price → close when current_price is null", async () => {
    server.use(
      http.get(VIX9D_URL, () =>
        HttpResponse.json(vix9dResponse({ current_price: null, close: 14.0 })),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(14.0);
  });

  it("falls through current_price → close → prev_day_close when both earlier fields are null", async () => {
    server.use(
      http.get(VIX9D_URL, () =>
        HttpResponse.json(
          vix9dResponse({ current_price: null, close: null, prev_day_close: 13.8 }),
        ),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(13.8);
  });

  it("returns err when spot is null (all fields null)", async () => {
    server.use(
      http.get(VIX9D_URL, () =>
        HttpResponse.json(
          vix9dResponse({ current_price: null, close: null, prev_day_close: null }),
        ),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err when spot is 0", async () => {
    server.use(
      http.get(VIX9D_URL, () =>
        HttpResponse.json(
          vix9dResponse({ current_price: 0, close: null, prev_day_close: null }),
        ),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("returns err on non-2xx", async () => {
    server.use(http.get(VIX9D_URL, () => new HttpResponse(null, { status: 500 })));
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err on network throw", async () => {
    server.use(
      http.get(VIX9D_URL, () => {
        throw new TypeError("network error");
      }),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("returns err on Zod parse failure", async () => {
    server.use(http.get(VIX9D_URL, () => HttpResponse.json({ not: "expected shape" })));
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("derives date from the UTC top-level timestamp (ET-converted), not last_trade_time (Pitfall 6)", async () => {
    server.use(
      http.get(VIX9D_URL, () =>
        HttpResponse.json({
          timestamp: "2026-07-01 23:30:00", // UTC = 19:30 ET July 1 → ET date 2026-07-01
          data: {
            current_price: 14.5,
            close: 14.2,
            prev_day_close: 14.0,
            last_trade_time: "2026-07-02T00:15:00", // would wrongly imply 07-02 if misread
          },
        }),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.date).toBe("2026-07-01");
  });
});
