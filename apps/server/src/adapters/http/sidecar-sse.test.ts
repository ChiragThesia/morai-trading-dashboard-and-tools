/**
 * sidecar-sse.test.ts — TDD tests for connectToSidecarStream (D-02, STRM-05)
 *
 * RED scaffold: this file imports from ./sidecar-sse.ts which does not exist yet.
 * Must fail on the unresolved import (TDD red-first).
 *
 * Behaviors under test:
 *   - A well-formed streamLiveGreekEvent frame is Zod-parsed → recomputeLiveGreek
 *     called → bufferTick called with the result.
 *   - A ping frame ("event: ping\ndata: \n\n") is ignored — no recompute, no bufferTick.
 *   - A malformed / unparseable frame is dropped — no any/as cast, no bufferTick.
 *   - A streamFillEvent frame is forwarded directly (no recompute needed, just bufferTick).
 *   - connectToSidecarStream returns when the stream is done (fetch body closes).
 *
 * Pattern: injects a fake ReadableStream of SSE text via a fake fetch, not a live sidecar.
 * No msw needed — dependencies are fully injectable.
 */
import { describe, it, expect, vi } from "vitest";
import { connectToSidecarStream, runSidecarStreamWithReconnect } from "./sidecar-sse.ts";
import type { LiveGreekTick, RawOptionTick } from "@morai/core";

// ─── SSE text helpers ─────────────────────────────────────────────────────────

/** Build a raw SSE frame from a payload string */
function makeDataFrame(dataJson: string): string {
  return `data: ${dataJson}\n\n`;
}

/** Build a named SSE event frame (e.g. "event: ping\ndata: \n\n") */
function makeEventFrame(event: string, dataJson: string): string {
  return `event: ${event}\ndata: ${dataJson}\n\n`;
}

/** Encode a string as a Uint8Array (UTF-8) */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Build a fake fetch that returns a text/event-stream body with the given SSE frames
 * concatenated, then closes (ReadableStream done = true after all chunks sent).
 */
function makeSseStreamFetch(frames: string[]): typeof globalThis.fetch {
  return async (_input, _init) => {
    const chunks = frames.map(encode);
    let idx = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (idx < chunks.length) {
          // Non-null assertion avoided: we check idx < chunks.length above
          const chunk = chunks[idx];
          if (chunk !== undefined) {
            ctrl.enqueue(chunk);
          }
          idx++;
        } else {
          ctrl.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
}

// ─── Tick fixtures ────────────────────────────────────────────────────────────

/** Valid OCC symbol (SPX, 2026-06-20, Call, strike 5900) */
const VALID_OCC = "SPX   260620C05900000";
const FUTURE_DATE = "2026-06-20T00:00:00.000Z";

/** A raw option tick payload matching streamLiveGreekEvent (but used here as RawOptionTick) */
const VALID_TICK_PAYLOAD = {
  occSymbol: VALID_OCC,
  mark: 15.5,
  bid: 15.0,
  ask: 16.0,
  underlyingPrice: 5950.0,
  ts: FUTURE_DATE,
};

// ─── Fake deps ────────────────────────────────────────────────────────────────

/** A no-op bufferTick that records calls */
function makeBufferTickSpy(): {
  spy: (tick: LiveGreekTick) => void;
  calls: LiveGreekTick[];
} {
  const calls: LiveGreekTick[] = [];
  return {
    spy: (tick: LiveGreekTick) => {
      calls.push(tick);
    },
    calls,
  };
}

/** A no-op recomputeLiveGreek that returns a canned LiveGreekTick */
function makeRecomputeSpy(result: LiveGreekTick | null): {
  spy: (tick: RawOptionTick, rate: number, q: number, now: Date) => { ok: true; value: LiveGreekTick } | { ok: false; error: { kind: string } };
  callCount: () => number;
} {
  let count = 0;
  return {
    spy: (_tick, _rate, _q, _now) => {
      count++;
      if (result === null) {
        return { ok: false as const, error: { kind: "no-price" as const } };
      }
      return { ok: true as const, value: result };
    },
    callCount: () => count,
  };
}

const CANNED_TICK: LiveGreekTick = {
  occSymbol: VALID_OCC,
  mark: 15.5,
  bid: 15.0,
  ask: 16.0,
  bsmIv: 0.18,
  bsmDelta: -0.45,
  bsmGamma: 0.002,
  bsmTheta: -0.85,
  bsmVega: 1.2,
  ts: FUTURE_DATE,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("connectToSidecarStream", () => {
  it("calls recomputeLiveGreek and bufferTick for a valid option tick frame", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    // recompute must have been called once for the valid tick
    expect(callCount()).toBe(1);
    // bufferTick must have received the canned result
    expect(calls).toHaveLength(1);
    expect(calls[0]?.occSymbol).toBe(VALID_OCC);
  });

  it("ignores a ping frame — no recompute, no bufferTick called", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeEventFrame("ping", ""),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(callCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("drops a malformed frame (not valid JSON) — no recompute, no bufferTick", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame("this is not json {{{"),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(callCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("drops a well-formed JSON frame that does not match the tick schema", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify({ unexpected: "shape" })),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(callCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does NOT call bufferTick when recomputeLiveGreek returns a skip result", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    // recompute returns null → skip result
    const { spy: recompute, callCount } = makeRecomputeSpy(null);

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    // recompute was called but returned skip → no bufferTick
    expect(callCount()).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("processes multiple frames in order, skipping invalid ones", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeEventFrame("ping", ""),
      makeDataFrame("bad json{{"),
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    // Only the 2 valid ticks should have triggered recompute + bufferTick
    expect(callCount()).toBe(2);
    expect(calls).toHaveLength(2);
  });

  // ─── observeSpot hook (SNAP-01, 20-06, Pattern 2) ────────────────────────────

  it("invokes observeSpot(price, ts) for a valid tick with underlyingPrice > 0", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);
    const observeSpotCalls: Array<{ spot: number; ts: string }> = [];
    const observeSpot = (spot: number, ts: string) => {
      observeSpotCalls.push({ spot, ts });
    };

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      observeSpot,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(observeSpotCalls).toEqual([
      { spot: VALID_TICK_PAYLOAD.underlyingPrice, ts: VALID_TICK_PAYLOAD.ts },
    ]);
  });

  it("invokes observeSpot even when recomputeLiveGreek returns a skip result", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    // recompute returns null → skip result — observeSpot must still fire.
    const { spy: recompute } = makeRecomputeSpy(null);
    const observeSpotCalls: Array<{ spot: number; ts: string }> = [];
    const observeSpot = (spot: number, ts: string) => {
      observeSpotCalls.push({ spot, ts });
    };

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      observeSpot,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(observeSpotCalls).toHaveLength(1);
  });

  it("does NOT invoke observeSpot when underlyingPrice is null", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);
    const observeSpotCalls: Array<{ spot: number; ts: string }> = [];
    const observeSpot = (spot: number, ts: string) => {
      observeSpotCalls.push({ spot, ts });
    };

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify({ ...VALID_TICK_PAYLOAD, underlyingPrice: null })),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      observeSpot,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(observeSpotCalls).toHaveLength(0);
  });

  it("does NOT invoke observeSpot when underlyingPrice is <= 0", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);
    const observeSpotCalls: Array<{ spot: number; ts: string }> = [];
    const observeSpot = (spot: number, ts: string) => {
      observeSpotCalls.push({ spot, ts });
    };

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify({ ...VALID_TICK_PAYLOAD, underlyingPrice: 0 })),
    ]);

    await connectToSidecarStream("http://sidecar.test.internal:8000", {
      fetch: fakeFetch,
      recompute,
      bufferTick,
      observeSpot,
      riskFreeRate: 0.045,
      dividendYield: 0.013,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(observeSpotCalls).toHaveLength(0);
  });

  it("does not throw when observeSpot is not provided", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    await expect(
      connectToSidecarStream("http://sidecar.test.internal:8000", {
        fetch: fakeFetch,
        recompute,
        bufferTick,
        riskFreeRate: 0.045,
        dividendYield: 0.013,
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the sidecar fetch returns a non-200 status", async () => {
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);

    const failFetch: typeof globalThis.fetch = async () =>
      new Response(null, { status: 503 });

    await expect(
      connectToSidecarStream("http://sidecar.test.internal:8000", {
        fetch: failFetch,
        recompute,
        bufferTick,
        riskFreeRate: 0.045,
        dividendYield: 0.013,
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/503/);
  });

  // ─── REVIEW CR-01: a throwing observeSpot must NOT sever the stream ───────────

  it("does NOT reject the stream when observeSpot throws — the frame still processes", async () => {
    const { spy: bufferTick, calls } = makeBufferTickSpy();
    const { spy: recompute, callCount } = makeRecomputeSpy(CANNED_TICK);
    const throwingObserveSpot = (): void => {
      // Simulates the old CR-01 bug: a synchronous RangeError from the RTH gate.
      throw new RangeError("Invalid time value");
    };

    const fakeFetch = makeSseStreamFetch([
      makeDataFrame(JSON.stringify(VALID_TICK_PAYLOAD)),
    ]);

    // The connect must RESOLVE (not reject) even though observeSpot threw — the
    // stream survives a bad callback.
    await expect(
      connectToSidecarStream("http://sidecar.test.internal:8000", {
        fetch: fakeFetch,
        recompute,
        bufferTick,
        observeSpot: throwingObserveSpot,
        riskFreeRate: 0.045,
        dividendYield: 0.013,
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();

    // And the frame still reached recompute + bufferTick — the throw was contained.
    expect(callCount()).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

// ─── REVIEW WR-02: self-healing reconnect loop ─────────────────────────────────

describe("runSidecarStreamWithReconnect", () => {
  it("reconnects after a failed connect cycle, backing off between attempts", async () => {
    let attempts = 0;
    // fetch always throws → connectToSidecarStream rejects each cycle.
    const failFetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      throw new Error("ECONNREFUSED");
    };
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);

    const onErrorCalls: unknown[] = [];
    const sleepCalls: number[] = [];
    let iterations = 0;

    await runSidecarStreamWithReconnect(
      "http://sidecar.test.internal:8000",
      {
        fetch: failFetch,
        recompute,
        bufferTick,
        riskFreeRate: 0.045,
        dividendYield: 0.013,
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      },
      {
        backoffMs: 2000,
        sleep: async (ms: number) => {
          sleepCalls.push(ms);
        },
        onError: (e: unknown) => {
          onErrorCalls.push(e);
        },
        // Run exactly 3 connect cycles, then stop.
        shouldContinue: () => {
          iterations += 1;
          return iterations <= 3;
        },
      },
    );

    // 3 connect attempts, each failed → 3 onError, and backoff slept between cycles.
    expect(attempts).toBe(3);
    expect(onErrorCalls).toHaveLength(3);
    expect(sleepCalls.every((ms) => ms === 2000)).toBe(true);
  });

  it("reconnects after the stream closes cleanly (connect resolves)", async () => {
    let attempts = 0;
    // A stream that closes immediately (done=true) → connectToSidecarStream resolves.
    const closingFetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      const stream = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          ctrl.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const { spy: bufferTick } = makeBufferTickSpy();
    const { spy: recompute } = makeRecomputeSpy(CANNED_TICK);

    let iterations = 0;
    await runSidecarStreamWithReconnect(
      "http://sidecar.test.internal:8000",
      {
        fetch: closingFetch,
        recompute,
        bufferTick,
        riskFreeRate: 0.045,
        dividendYield: 0.013,
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      },
      {
        sleep: async () => undefined,
        shouldContinue: () => {
          iterations += 1;
          return iterations <= 2;
        },
      },
    );

    // The loop re-opened the stream after each clean close.
    expect(attempts).toBe(2);
  });
});
