/**
 * stream.routes.test.ts — TDD tests for stream.routes.ts
 *
 * Task 1: POST /api/stream/ticket (JWT-gated mint) + GET /api/stream (ticket-gated SSE, reconcile-first)
 * Task 4: POST /api/stream/subscribe (JWT-gated, OCC-validated sidecar proxy)
 *
 * D-01: opaque ticket pattern — JWT never goes in query params; only the ticket does.
 * STRM-03: invalid/expired/reused ticket → 401, no SSE opened, no client registered.
 * STRM-05: first SSE frame after connect is always the "reconcile" event.
 * SC6: POST /api/stream/subscribe validates OCC then proxies to sidecar; 400 on bad symbol (no sidecar call).
 *
 * Auth group enforcement (Pitfall 7) is wired in main.ts (Task 3).
 * These tests use a fake auth middleware to simulate the JWT group for ticket/subscribe routes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type { ForReconcilingPositions, ReconciledPosition } from "@morai/core";
import {
  streamTicketResponse,
  streamReconcileEvent,
  streamPingEvent,
} from "@morai/contracts";
import type { JWTPayload } from "jose";
import { resetForTesting } from "./stream-fan-out.ts";
import { streamRoutes } from "./stream.routes.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_USER_ID = "user-aaaaaa-test-00000000";
const DUMMY_SIDECAR_URL = "http://sidecar.test.internal:8000";

// Valid OCC symbol: SPX, 2026-06-20, Call, strike 5900
const VALID_OCC = "SPX   260620C05900000";
// Wrong-length OCC (bad format)
const BAD_OCC = "NOT-AN-OCC-SYMBOL";

// ─── Test doubles ─────────────────────────────────────────────────────────────

const SEED_POSITION: ReconciledPosition = {
  occSymbol: VALID_OCC,
  longQty: 0,
  shortQty: 2,
  underlyingSymbol: "SPX",
  marketValue: -1800,
};

const emptyReconciler: ForReconcilingPositions = async () =>
  ok<ReadonlyArray<ReconciledPosition>, never>([]);

const seededReconciler: ForReconcilingPositions = async () =>
  ok<ReadonlyArray<ReconciledPosition>, never>([SEED_POSITION]);

const failingReconciler: ForReconcilingPositions = async () =>
  err({ kind: "AuthExpired" as const });

// ─── Fake fetch helpers ───────────────────────────────────────────────────────

/** Build a fake fetch that returns the given status + JSON body. */
function makeFakeFetch(
  status: number,
  body: unknown,
): typeof globalThis.fetch {
  return async (_input, _init) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** Fake fetch that throws a network error (connection refused). */
const networkErrorFetch: typeof globalThis.fetch = async () => {
  throw new Error("ECONNREFUSED: connection refused");
};

/** Call counter fetch spy — wraps another fetch and counts calls. */
function makeCallCounterFetch(inner: typeof globalThis.fetch): {
  fetch: typeof globalThis.fetch;
  count: () => number;
} {
  let callCount = 0;
  const counted: typeof globalThis.fetch = async (input, init) => {
    callCount++;
    return inner(input, init);
  };
  return {
    fetch: counted,
    count: () => callCount,
  };
}

// ─── App factory ─────────────────────────────────────────────────────────────

/**
 * Build a test Hono app.
 *
 * Simulates the authReadGroup from main.ts by injecting a fake jwtPayload
 * middleware before the stream routes. In production, makeSupabaseJwtAuth does
 * this; here we short-circuit to test route behaviour, not the JWT middleware.
 *
 * @param reconcilePositions - ForReconcilingPositions implementation to inject
 * @param fetchImpl          - Injectable fetch for the subscribe proxy (Task 4)
 */
function buildApp(
  reconcilePositions: ForReconcilingPositions = emptyReconciler,
  fetchImpl?: typeof globalThis.fetch,
) {
  // Use a typed Hono app so c.set("jwtPayload", ...) compiles without casts.
  type TestEnv = { Variables: { jwtPayload: JWTPayload } };
  const app = new Hono<TestEnv>();

  // Simulate the JWT auth middleware — all routes here see jwtPayload in context.
  app.use("*", async (c, next) => {
    const fakePayload: JWTPayload = { sub: FAKE_USER_ID };
    c.set("jwtPayload", fakePayload);
    await next();
  });

  app.route(
    "/api",
    streamRoutes({
      reconcilePositions,
      sidecarUrl: DUMMY_SIDECAR_URL,
      fetch: fetchImpl,
    }),
  );
  return app;
}

// ─── SSE reading helper ────────────────────────────────────────────────────────

/**
 * Read SSE frames from a streaming response body until the given event is found
 * or we run out of data. Cancels the reader after getting the target event.
 *
 * Returns the raw accumulated SSE text (may include multiple frames).
 */
async function readUntilEvent(
  body: ReadableStream<Uint8Array>,
  targetEvent: string,
  maxChunks = 30,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (let i = 0; i < maxChunks; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(`event: ${targetEvent}`)) break;
    }
  } finally {
    // Cancel triggers stream.aborted → cleanup callbacks in the route handler.
    await reader.cancel();
  }
  return buffer;
}

// ─── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset fan-out module state between tests to prevent cross-test client leaks.
  resetForTesting();
});

// ─── Task 1: POST /api/stream/ticket ─────────────────────────────────────────

describe("POST /api/stream/ticket", () => {
  it("returns 200 with a UUID ticket when the jwtPayload.sub is set (D-01)", async () => {
    const app = buildApp();
    const res = await app.request("/api/stream/ticket", { method: "POST" });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = streamTicketResponse.parse(body);
    // ticket must be a UUID (crypto.randomUUID format)
    expect(parsed.ticket).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns distinct UUIDs on successive mints (each call issues a fresh ticket)", async () => {
    const app = buildApp();
    const r1 = await app.request("/api/stream/ticket", { method: "POST" });
    const r2 = await app.request("/api/stream/ticket", { method: "POST" });
    const t1 = streamTicketResponse.parse(await r1.json()).ticket;
    const t2 = streamTicketResponse.parse(await r2.json()).ticket;
    expect(t1).not.toBe(t2);
  });
});

// ─── Task 1: GET /api/stream — auth ──────────────────────────────────────────

describe("GET /api/stream — auth (STRM-03)", () => {
  it("returns 401 { error:'Unauthorized' } when no ?ticket= is provided", async () => {
    const app = buildApp();
    const res = await app.request("/api/stream");
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when ?ticket= is an unknown UUID", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/stream?ticket=00000000-0000-4000-8000-000000000000",
    );
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the ticket has already been used (single-use invariant)", async () => {
    const app = buildApp();
    // Mint and use a ticket the first time → SSE opens
    const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
    const { ticket } = streamTicketResponse.parse(await mintRes.json());
    const firstRes = await app.request(`/api/stream?ticket=${ticket}`);
    expect(firstRes.status).toBe(200);
    // Cancel the first stream body
    if (firstRes.body) await firstRes.body.cancel();

    // Second attempt with the same (now consumed) ticket → 401
    const secondRes = await app.request(`/api/stream?ticket=${ticket}`);
    expect(secondRes.status).toBe(401);
    const body: unknown = await secondRes.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});

// ─── Task 1: GET /api/stream — reconcile-first (STRM-05) ─────────────────────

describe("GET /api/stream — reconcile-first (STRM-05)", () => {
  it("opens SSE (200 text/event-stream) on a valid ticket", async () => {
    const app = buildApp();
    const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
    const { ticket } = streamTicketResponse.parse(await mintRes.json());

    const res = await app.request(`/api/stream?ticket=${ticket}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    if (res.body) await res.body.cancel();
  });

  it("sends a 'reconcile' event as the FIRST frame (STRM-05)", async () => {
    const app = buildApp(seededReconciler);
    const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
    const { ticket } = streamTicketResponse.parse(await mintRes.json());

    const res = await app.request(`/api/stream?ticket=${ticket}`);
    expect(res.status).toBe(200);
    const body1 = res.body;
    if (!body1) throw new Error("expected body");

    // Read until we get the reconcile event
    const rawSse = await readUntilEvent(body1, "reconcile");
    expect(rawSse).toContain("event: reconcile");
  });

  it("reconcile event data is a valid streamReconcileEvent with the injected positions", async () => {
    const app = buildApp(seededReconciler);
    const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
    const { ticket } = streamTicketResponse.parse(await mintRes.json());

    const res = await app.request(`/api/stream?ticket=${ticket}`);
    const body2 = res.body;
    if (!body2) throw new Error("expected body");

    const rawSse = await readUntilEvent(body2, "reconcile");

    // Extract the "data: ..." line from the first frame
    const dataLine = rawSse
      .split("\n")
      .find((l) => l.startsWith("data: "));
    if (!dataLine) throw new Error("expected data: line in SSE frame");
    const raw: unknown = JSON.parse(dataLine.slice("data: ".length));
    const parsed = streamReconcileEvent.parse(raw);
    expect(parsed.positions).toHaveLength(1);
    expect(parsed.positions[0]?.occSymbol).toBe(VALID_OCC);
    expect(parsed.asOf).toMatch(/Z$/); // Must end in Z (Pitfall 5)
  });

  it("sends empty positions in reconcile event when the reconciler fails gracefully", async () => {
    const app = buildApp(failingReconciler);
    const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
    const { ticket } = streamTicketResponse.parse(await mintRes.json());

    const res = await app.request(`/api/stream?ticket=${ticket}`);
    const body3 = res.body;
    if (!body3) throw new Error("expected body");

    const rawSse = await readUntilEvent(body3, "reconcile");
    const dataLine = rawSse.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) throw new Error("expected data: line in SSE frame");
    const raw: unknown = JSON.parse(dataLine.slice("data: ".length));
    const parsed = streamReconcileEvent.parse(raw);
    // Graceful degradation: stream still opens, reconcile sent with empty positions
    expect(parsed.positions).toHaveLength(0);
  });
});

// ─── Task 1 (20-02): GET /api/stream — ping heartbeat carries isRth (WATCH-01, D-03) ──

/**
 * Extracts the JSON-parsed data payload of the first frame for the given SSE event
 * from raw accumulated SSE text (helper local to this describe block).
 */
function extractEventData(rawSse: string, targetEvent: string): unknown {
  const frames = rawSse.split("\n\n");
  const frame = frames.find((f) => f.includes(`event: ${targetEvent}`));
  if (frame === undefined) throw new Error(`expected an "${targetEvent}" frame`);
  const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`expected a data: line in the "${targetEvent}" frame`);
  return JSON.parse(dataLine.slice("data: ".length));
}

describe("GET /api/stream — ping heartbeat carries isRth (WATCH-01, D-03)", () => {
  it("emits a ping frame whose data parses via streamPingEvent with isRth true under an open-market clock", async () => {
    vi.useFakeTimers();
    try {
      // Monday 2026-07-06, 11:00 ET (15:00 UTC, EDT) — within RTH, not a holiday.
      vi.setSystemTime(new Date("2026-07-06T15:00:00.000Z"));

      const app = buildApp();
      const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
      const { ticket } = streamTicketResponse.parse(await mintRes.json());

      const res = await app.request(`/api/stream?ticket=${ticket}`);
      const body = res.body;
      if (!body) throw new Error("expected body");

      const readPromise = readUntilEvent(body, "ping");
      await vi.advanceTimersByTimeAsync(30_000);
      const rawSse = await readPromise;

      const raw = extractEventData(rawSse, "ping");
      const parsed = streamPingEvent.parse(raw);
      expect(parsed.isRth).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits a ping frame with isRth false under a holiday clock (RTH hours, NYSE closed)", async () => {
    vi.useFakeTimers();
    try {
      // Thursday 2026-01-01 (New Year's Day), 10:00 ET (15:00 UTC, EST) — RTH hours,
      // but a full NYSE closure day. isRth must be false (AND of both predicates).
      vi.setSystemTime(new Date("2026-01-01T15:00:00.000Z"));

      const app = buildApp();
      const mintRes = await app.request("/api/stream/ticket", { method: "POST" });
      const { ticket } = streamTicketResponse.parse(await mintRes.json());

      const res = await app.request(`/api/stream?ticket=${ticket}`);
      const body = res.body;
      if (!body) throw new Error("expected body");

      const readPromise = readUntilEvent(body, "ping");
      await vi.advanceTimersByTimeAsync(30_000);
      const rawSse = await readPromise;

      const raw = extractEventData(rawSse, "ping");
      const parsed = streamPingEvent.parse(raw);
      expect(parsed.isRth).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Task 4: POST /api/stream/subscribe ──────────────────────────────────────

describe("POST /api/stream/subscribe (SC6 sidecar proxy)", () => {
  it("proxies a valid OCC symbol to the sidecar and returns { subscribed, evicted } on 200", async () => {
    const sidecarBody = { subscribed: VALID_OCC, evicted: null };
    const fakeFetch = makeFakeFetch(200, sidecarBody);
    const app = buildApp(emptyReconciler, fakeFetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: VALID_OCC }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual(sidecarBody);
  });

  it("returns 400 { error:'InvalidSymbol' } for a malformed OCC symbol (no sidecar call)", async () => {
    const spy = makeCallCounterFetch(
      makeFakeFetch(200, { subscribed: VALID_OCC, evicted: null }),
    );
    const app = buildApp(emptyReconciler, spy.fetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: BAD_OCC }),
    });

    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "InvalidSymbol" });
    // No sidecar call should have been made
    expect(spy.count()).toBe(0);
  });

  it("returns 400 when the body has no symbol field", async () => {
    const spy = makeCallCounterFetch(
      makeFakeFetch(200, { subscribed: VALID_OCC, evicted: null }),
    );
    const app = buildApp(emptyReconciler, spy.fetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    // No sidecar call for missing symbol
    expect(spy.count()).toBe(0);
  });

  it("returns 503 { error:'AUTH_EXPIRED' } when the sidecar returns 503", async () => {
    const fakeFetch = makeFakeFetch(503, { error: "AUTH_EXPIRED" });
    const app = buildApp(emptyReconciler, fakeFetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: VALID_OCC }),
    });

    expect(res.status).toBe(503);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "AUTH_EXPIRED" });
  });

  it("returns 502 { error:'SidecarUnavailable' } when the sidecar is down (network error)", async () => {
    const app = buildApp(emptyReconciler, networkErrorFetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: VALID_OCC }),
    });

    expect(res.status).toBe(502);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "SidecarUnavailable" });
  });

  it("returns 502 when sidecar returns any non-200/non-503 status", async () => {
    const fakeFetch = makeFakeFetch(500, { detail: "internal server error" });
    const app = buildApp(emptyReconciler, fakeFetch);

    const res = await app.request("/api/stream/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: VALID_OCC }),
    });

    expect(res.status).toBe(502);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "SidecarUnavailable" });
  });
});
