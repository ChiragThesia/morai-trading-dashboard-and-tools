import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { makeCboeVvixAdapter } from "./cboe-vvix.ts";

const VVIX_URL =
  "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json";

function vvixResponse(overrides: {
  timestamp?: string;
  current_price?: number | null;
  close?: number | null;
  prev_day_close?: number | null;
}) {
  return {
    timestamp: overrides.timestamp ?? "2026-07-02 01:00:55",
    data: {
      current_price: overrides.current_price ?? 89.0,
      close: overrides.close ?? 88.1,
      prev_day_close: overrides.prev_day_close ?? 87.5,
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
  return makeCboeVvixAdapter({
    fetch: globalThis.fetch,
    userAgent: "morai-test",
  });
}

describe("makeCboeVvixAdapter", () => {
  it("returns ok with seriesId VVIX, RAW value, source cboe, and UTC-derived date", async () => {
    server.use(
      http.get(VVIX_URL, () => HttpResponse.json(vvixResponse({}))),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.seriesId).toBe("VVIX");
    expect(result.value.value).toBe(89.0);
    expect(result.value.source).toBe("cboe");
    // timestamp "2026-07-02 01:00:55" UTC → date 2026-07-02
    expect(result.value.date).toBe("2026-07-02");
  });

  it("falls through current_price → close when current_price is null", async () => {
    server.use(
      http.get(VVIX_URL, () =>
        HttpResponse.json(vvixResponse({ current_price: null, close: 88.1 })),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(88.1);
  });

  it("falls through current_price → close → prev_day_close when both earlier fields are null", async () => {
    server.use(
      http.get(VVIX_URL, () =>
        HttpResponse.json(
          vvixResponse({ current_price: null, close: null, prev_day_close: 87.5 }),
        ),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(87.5);
  });

  it("returns err when spot is null (all fields null)", async () => {
    server.use(
      http.get(VVIX_URL, () =>
        HttpResponse.json(
          vvixResponse({ current_price: null, close: null, prev_day_close: null }),
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
      http.get(VVIX_URL, () =>
        HttpResponse.json(
          vvixResponse({ current_price: 0, close: null, prev_day_close: null }),
        ),
      ),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("returns err on non-2xx", async () => {
    server.use(http.get(VVIX_URL, () => new HttpResponse(null, { status: 500 })));
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err on network throw", async () => {
    server.use(
      http.get(VVIX_URL, () => {
        throw new TypeError("network error");
      }),
    );
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("returns err on Zod parse failure", async () => {
    server.use(http.get(VVIX_URL, () => HttpResponse.json({ not: "expected shape" })));
    const adapter = makeAdapter();
    const result = await adapter();
    expect(result.ok).toBe(false);
  });

  it("derives date from the UTC top-level timestamp, not last_trade_time (Pitfall 6)", async () => {
    server.use(
      http.get(VVIX_URL, () =>
        HttpResponse.json({
          timestamp: "2026-07-01 23:30:00", // UTC — still 2026-07-01
          data: {
            current_price: 90.2,
            close: 89.0,
            prev_day_close: 88.0,
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
