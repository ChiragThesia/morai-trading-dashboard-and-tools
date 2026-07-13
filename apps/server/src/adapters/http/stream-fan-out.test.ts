/**
 * stream-fan-out.test.ts — Unit tests for the SSE fan-out hub + 1/sec coalescer (D-07, STRM-03)
 *
 * Uses structural fake SSEClients (recording writeSSE, settable aborted flag) to avoid
 * any dependency on real Hono streams. Tests call flushTicks() directly instead of
 * waiting on real setInterval timers.
 *
 * Covers:
 *   - registerClient/unregisterClient membership
 *   - bufferTick: latest tick per symbol overwrites earlier (D-07 coalescing)
 *   - flushTicks: writes one "ticks" SSE event to all live clients
 *   - flushTicks: no-op on empty buffer or no clients
 *   - Dead-client cleanup path 1: aborted=true → skip + remove from Set (Pitfall 6)
 *   - Dead-client cleanup path 2: writeSSE rejection → remove from Set (Pitfall 6)
 *   - Multiple bufferTick calls for same symbol → one tick at flush (D-07 coalescing)
 *   - startFlushInterval: returns a truthy timer handle
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  registerClient,
  unregisterClient,
  bufferTick,
  flushTicks,
  bufferSpot,
  flushSpot,
  bufferIndices,
  flushIndices,
  startFlushInterval,
  resetForTesting,
} from "./stream-fan-out.ts";
import type { SSEClient } from "./stream-fan-out.ts";
import type { LiveGreekTick } from "@morai/core";

// Non-round fixture values (catch #20 jsdom-honesty law) — never coincide with a
// rounded production constant.
const SPOT_A = 5842.375;
const SPOT_B = 5859.125;

// ─── Zod schemas for test assertions (parse-don't-cast) ──────────────────────
const tickItem = z.object({ mark: z.number(), occSymbol: z.string() });
const ticksPayload = z.array(tickItem);

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FakeCall = { event: string | undefined; data: string };

type FakeClient = SSEClient & {
  calls: FakeCall[];
  aborted: boolean;
  reject: boolean; // if true, writeSSE throws on next call
};

function makeFakeClient(): FakeClient {
  const client: FakeClient = {
    calls: [],
    aborted: false,
    reject: false,
    onAbort(_listener: () => void) {
      // no-op in unit tests; route handler registers this in real use
    },
    writeSSE(msg: { event?: string; data: string }): Promise<void> {
      if (client.reject) {
        return Promise.reject(new Error("write failed"));
      }
      client.calls.push({ event: msg.event, data: msg.data });
      return Promise.resolve();
    },
  };
  return client;
}

function makeTick(occSymbol: string, mark = 100): LiveGreekTick {
  return {
    occSymbol,
    mark,
    bid: mark - 1,
    ask: mark + 1,
    bsmIv: 0.25,
    bsmDelta: 0.5,
    bsmGamma: 0.01,
    bsmTheta: -0.05,
    bsmVega: 0.1,
    ts: "2026-06-28T10:00:00.000Z",
  };
}

// ─── State cleanup between tests ─────────────────────────────────────────────

beforeEach(() => {
  resetForTesting();
});

afterEach(() => {
  resetForTesting();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("stream-fan-out", () => {
  describe("registerClient / unregisterClient", () => {
    it("registers a client and flushTicks delivers to it", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      // give microtasks a chance to run
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]?.event).toBe("ticks");
    });

    it("unregistered client does not receive ticks", async () => {
      const client = makeFakeClient();
      registerClient(client);
      unregisterClient(client);
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      await Promise.resolve();
      expect(client.calls).toHaveLength(0);
    });
  });

  describe("bufferTick — D-07 coalescer", () => {
    it("latest tick for the same symbol overwrites earlier one", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferTick(makeTick("SPX   271218C05000000", 100));
      bufferTick(makeTick("SPX   271218C05000000", 200)); // overwrites
      flushTicks();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);
      const parsed = ticksPayload.parse(JSON.parse(client.calls[0]?.data ?? "[]"));
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.mark).toBe(200); // latest wins
    });

    it("different symbols are both present in flush payload", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferTick(makeTick("SPX   271218C05000000", 100));
      bufferTick(makeTick("SPX   271218P05000000", 50));
      flushTicks();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);
      const parsed = ticksPayload.parse(JSON.parse(client.calls[0]?.data ?? "[]"));
      expect(parsed).toHaveLength(2);
    });

    it("buffer is cleared after flush (second flush sends nothing)", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks(); // consumes the buffer
      await Promise.resolve();
      flushTicks(); // buffer is empty → no-op
      await Promise.resolve();
      expect(client.calls).toHaveLength(1); // only the first flush
    });
  });

  describe("flushTicks — no-op conditions", () => {
    it("is a no-op when buffer is empty (no error, no write)", async () => {
      const client = makeFakeClient();
      registerClient(client);
      flushTicks(); // empty buffer
      await Promise.resolve();
      expect(client.calls).toHaveLength(0);
    });

    it("is a no-op when no clients are registered", async () => {
      // buffer has a tick but no clients
      bufferTick(makeTick("SPX   271218C05000000"));
      // should not throw
      expect(() => flushTicks()).not.toThrow();
    });
  });

  describe("dead-client cleanup — Pitfall 6 (two cleanup paths)", () => {
    it("path 1: removes a client with aborted=true on flush, does not write to it", async () => {
      const deadClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(deadClient);
      registerClient(liveClient);
      deadClient.aborted = true; // mark as dead
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      await Promise.resolve();
      // dead client receives no write
      expect(deadClient.calls).toHaveLength(0);
      // live client receives the event
      expect(liveClient.calls).toHaveLength(1);
      // dead client is removed — re-register it and flush again to confirm it wasn't re-added
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      await Promise.resolve();
      expect(deadClient.calls).toHaveLength(0); // still gone
    });

    it("path 2: removes a client whose writeSSE rejects on flush", async () => {
      const failClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(failClient);
      registerClient(liveClient);
      failClient.reject = true; // will throw on writeSSE
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      // Wait for the .catch microtask to fire and remove the failing client
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // live client received the event
      expect(liveClient.calls).toHaveLength(1);
      // fail client is removed — a subsequent flush should not attempt to write to it
      liveClient.calls.length = 0; // reset
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(liveClient.calls).toHaveLength(1); // still 1 client
    });
  });

  describe("flushTicks — multiple clients", () => {
    it("delivers to all registered clients in one flush", async () => {
      const c1 = makeFakeClient();
      const c2 = makeFakeClient();
      const c3 = makeFakeClient();
      registerClient(c1);
      registerClient(c2);
      registerClient(c3);
      bufferTick(makeTick("SPX   271218C05000000"));
      flushTicks();
      await Promise.resolve();
      expect(c1.calls).toHaveLength(1);
      expect(c2.calls).toHaveLength(1);
      expect(c3.calls).toHaveLength(1);
    });
  });

  describe("startFlushInterval", () => {
    it("returns a truthy timer handle", () => {
      const handle = startFlushInterval();
      expect(handle).toBeTruthy();
      clearInterval(handle);
    });
  });

  describe("bufferSpot / flushSpot — on-change throttle", () => {
    it("flushes one named 'spot' event with { spot, ts } on first buffer", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]?.event).toBe("spot");
      expect(JSON.parse(client.calls[0]?.data ?? "{}")).toEqual({
        spot: SPOT_A,
        ts: "2026-07-13T10:00:00.000Z",
      });
    });

    it("buffering the SAME spot value again and flushing is a no-op", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);

      bufferSpot(SPOT_A, "2026-07-13T10:00:01.000Z"); // same value, later ts
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1); // no second write
    });

    it("a CHANGED spot value sends again", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await Promise.resolve();

      bufferSpot(SPOT_B, "2026-07-13T10:00:01.000Z");
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(2);
      expect(JSON.parse(client.calls[1]?.data ?? "{}")).toEqual({
        spot: SPOT_B,
        ts: "2026-07-13T10:00:01.000Z",
      });
    });

    it("is a no-op when nothing buffered or no clients registered", async () => {
      const client = makeFakeClient();
      registerClient(client);
      flushSpot(); // nothing buffered
      await Promise.resolve();
      expect(client.calls).toHaveLength(0);

      unregisterClient(client);
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      expect(() => flushSpot()).not.toThrow();
    });

    it("dead-client cleanup: aborted client is skipped and removed", async () => {
      const deadClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(deadClient);
      registerClient(liveClient);
      deadClient.aborted = true;
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await Promise.resolve();
      expect(deadClient.calls).toHaveLength(0);
      expect(liveClient.calls).toHaveLength(1);
    });

    it("dead-client cleanup: a rejecting writeSSE removes the client", async () => {
      const failClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(failClient);
      registerClient(liveClient);
      failClient.reject = true;
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(liveClient.calls).toHaveLength(1);

      liveClient.calls.length = 0;
      bufferSpot(SPOT_B, "2026-07-13T10:00:01.000Z");
      flushSpot();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(liveClient.calls).toHaveLength(1); // failClient no longer attempted
    });
  });

  describe("bufferIndices / flushIndices — on-change throttle", () => {
    const VALUES_A = { vix: 16.2, vvix: 88.5, vix9d: 15.1, vix3m: 17.8 };
    const VALUES_B = { vix: 18.4, vvix: 90.1, vix9d: 16.9, vix3m: 19.2 };

    it("flushes one named 'indices' event with { vix, vvix, vix9d, vix3m, ts } on first buffer", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]?.event).toBe("indices");
      expect(JSON.parse(client.calls[0]?.data ?? "{}")).toEqual({
        ...VALUES_A,
        ts: "2026-07-13T10:00:00.000Z",
      });
    });

    it("buffering the SAME indices snapshot again and flushing is a no-op", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);

      bufferIndices(VALUES_A, "2026-07-13T10:00:01.000Z"); // same values, later ts
      flushIndices();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1); // no second write
    });

    it("a CHANGED indices snapshot (even one field) sends again", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await Promise.resolve();

      bufferIndices(VALUES_B, "2026-07-13T10:00:01.000Z");
      flushIndices();
      await Promise.resolve();
      expect(client.calls).toHaveLength(2);
      expect(JSON.parse(client.calls[1]?.data ?? "{}")).toEqual({
        ...VALUES_B,
        ts: "2026-07-13T10:00:01.000Z",
      });
    });

    it("null fields are preserved (per-symbol omit, not fabricated)", async () => {
      const client = makeFakeClient();
      registerClient(client);
      const withNull = { vix: 16.2, vvix: null, vix9d: 15.1, vix3m: 17.8 };
      bufferIndices(withNull, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await Promise.resolve();
      expect(JSON.parse(client.calls[0]?.data ?? "{}")).toEqual({
        ...withNull,
        ts: "2026-07-13T10:00:00.000Z",
      });
    });

    it("is a no-op when nothing buffered or no clients registered", async () => {
      const client = makeFakeClient();
      registerClient(client);
      flushIndices(); // nothing buffered
      await Promise.resolve();
      expect(client.calls).toHaveLength(0);

      unregisterClient(client);
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      expect(() => flushIndices()).not.toThrow();
    });

    it("dead-client cleanup: aborted client is skipped and removed", async () => {
      const deadClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(deadClient);
      registerClient(liveClient);
      deadClient.aborted = true;
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await Promise.resolve();
      expect(deadClient.calls).toHaveLength(0);
      expect(liveClient.calls).toHaveLength(1);
    });

    it("dead-client cleanup: a rejecting writeSSE removes the client", async () => {
      const failClient = makeFakeClient();
      const liveClient = makeFakeClient();
      registerClient(failClient);
      registerClient(liveClient);
      failClient.reject = true;
      bufferIndices(VALUES_A, "2026-07-13T10:00:00.000Z");
      flushIndices();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(liveClient.calls).toHaveLength(1);

      liveClient.calls.length = 0;
      bufferIndices(VALUES_B, "2026-07-13T10:00:01.000Z");
      flushIndices();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(liveClient.calls).toHaveLength(1); // failClient no longer attempted
    });
  });

  describe("resetForTesting — clears spot/indices state", () => {
    it("clears the last-sent trackers so a repeated value sends fresh after reset", async () => {
      const client = makeFakeClient();
      registerClient(client);
      bufferSpot(SPOT_A, "2026-07-13T10:00:00.000Z");
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);

      resetForTesting();
      registerClient(client); // resetForTesting cleared the client Set too — re-register
      bufferSpot(SPOT_A, "2026-07-13T10:00:01.000Z"); // same value as before reset
      flushSpot();
      await Promise.resolve();
      expect(client.calls).toHaveLength(2); // sends again — lastSentSpot was cleared
    });
  });
});
