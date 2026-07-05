/**
 * useLiveStream.test.ts — TDD suite for the useLiveStream hook.
 *
 * Behaviors under test (WATCH-01 3-state model, Phase 20 D-01/D-02/D-03/D-11/D-17 — see
 * Plan 12-06 Task 1 for the pre-existing ticket-mint/EventSource/greeks-Map behaviors,
 * unchanged here):
 *   1. Mints a ticket via POST /api/stream/ticket and opens EventSource with ?ticket=
 *   2. Initial state: status 'quiet', isRth null, hasReceivedFirstTick false, empty greeks.
 *   3. A well-formed "ping" updates isRth; a malformed ping is dropped (last-known-good).
 *   4. A "ticks" event sets hasReceivedFirstTick + updates the greeks Map — status itself
 *      is set only by the shared interval, never directly by an event (Pattern 1).
 *   5. The interval derives 'live' once isRth is true and a tick has arrived; 'quiet' when
 *      isRth is false regardless of ticks; 'stalled' after >=20s of silence during RTH,
 *      flipping back to 'live' once ticks resume.
 *   6. es.onerror does not set status directly (Pitfall 1) — only sustained elapsed
 *      silence (via the interval) reaches 'stalled'.
 *   7. reconnectNow() cancels the pending exp-backoff timer before reconnecting (D-17
 *      double-connect guard) and is re-entrancy-safe.
 *   8. Malformed frames are silently ignored — no throw, no state change.
 *   9. EventSource is torn down on unmount.
 *  10. subscribeAdHoc POSTs to /api/stream/subscribe with the symbol (SC6 — NOT a no-op).
 *  11. subscribeAdHoc does NOT open a second EventSource.
 *  12. subscribeAdHoc throws StreamSubscribeError on non-2xx.
 *
 * Threat mitigations verified (T-12-06-01, T-20-02):
 *   - Every frame Zod-parsed; malformed frames dropped (no cast into DOM).
 *   - Ticket mint uses apiFetch (Supabase-authed) — unauthenticated client cannot
 *     obtain a ticket (auth gate tested implicitly via mock structure).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

// ─── Mock apiFetch (hoisted so vi.mock sees it) ───────────────────────────────
const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

vi.mock("../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// ─── Import after vi.mock hoisting ───────────────────────────────────────────
import { useLiveStream } from "./useLiveStream.ts";

// ─── Fake EventSource ─────────────────────────────────────────────────────────

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  closed = false;
  // Named-event listeners (addEventListener) — the server sends NAMED SSE events
  // ("ticks", "ping"); the browser routes those here, NOT to onmessage.
  readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: (e: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  /** Test helper: dispatch a NAMED SSE event (matches the server's event: "<name>"). */
  dispatchNamedEvent(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    this.listeners.get(name)?.forEach((h) => h(event));
  }

  /** Server sends event:"ticks" with a JSON ARRAY of live greek ticks. */
  dispatchTicks(ticks: unknown[]): void {
    this.dispatchNamedEvent("ticks", ticks);
  }

  /** Server sends event:"ping" carrying { isRth } (D-03). */
  dispatchPing(data: unknown): void {
    this.dispatchNamedEvent("ping", data);
  }

  /** Test helper: fire the onerror handler. */
  dispatchError(): void {
    this.onerror?.(new Event("error"));
  }

  /** Test helper: fire the onopen handler (reconnect). */
  dispatchOpen(): void {
    this.onopen?.(new Event("open"));
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Must be a RFC-4122 valid UUID (Zod v4 validates version/variant bits):
//   third segment starts with [1-8], fourth segment starts with [89abAB].
const TICKET = "550e8400-e29b-41d4-a716-446655440000";

type TicketResponse = { ok: boolean; status: number; json: () => Promise<{ ticket: string }> };

function makeTicketResponse(ticket = TICKET): TicketResponse {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ticket }),
  };
}

function makeSubscribeResponse(ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve({}),
  };
}

/** A valid streamLiveGreekEvent payload. */
const SAMPLE_TICK = {
  occSymbol: "SPX   260620C05000000",
  mark: 47.2,
  bid: 47.0,
  ask: 47.4,
  bsmIv: 0.18,
  bsmDelta: 0.45,
  bsmGamma: 0.0012,
  bsmTheta: -0.15,
  bsmVega: 0.82,
  ts: "2026-06-28T14:30:00.000Z",
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Returns the first FakeEventSource created in this test. */
function es0(): FakeEventSource {
  const inst = FakeEventSource.instances[0];
  if (inst === undefined) throw new Error("No FakeEventSource instance yet");
  return inst;
}

/** Flushes pending microtasks (Promise resolutions) — unaffected by fake timers, so
 *  this reliably drains connect()'s `await apiFetch(...)` / `await res.json()` chain
 *  whether or not vi.useFakeTimers() is active. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useLiveStream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    // Default: return a valid ticket for the first apiFetch call.
    mockApiFetch.mockResolvedValue(makeTicketResponse());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  // ── 1. Ticket mint + EventSource connect ─────────────────────────────────

  it("mints a ticket via POST /api/stream/ticket and opens an EventSource with the ticket", async () => {
    renderHook(() => useLiveStream());

    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    // apiFetch must be called with the ticket mint endpoint
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/stream/ticket",
      expect.objectContaining({ method: "POST" }),
    );

    // EventSource URL must include the ticket as a query param
    expect(es0().url).toContain(`ticket=${TICKET}`);
  });

  // ── 2. Initial state (WATCH-01 3-state model) ────────────────────────────

  it("starts with status 'quiet', isRth null, hasReceivedFirstTick false, empty greeks, and null lastTickAt", () => {
    const { result } = renderHook(() => useLiveStream());

    expect(result.current.status).toBe("quiet");
    expect(result.current.isRth).toBeNull();
    expect(result.current.hasReceivedFirstTick).toBe(false);
    expect(result.current.lastTickAt).toBeNull();
    expect(result.current.greeks.size).toBe(0);
    expect(result.current.isReconnecting).toBe(false);
  });

  // ── 3. Ping wiring ────────────────────────────────────────────────────────

  it("a well-formed ping updates isRth", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchPing({ isRth: true }); });
    expect(result.current.isRth).toBe(true);

    act(() => { es0().dispatchPing({ isRth: false }); });
    expect(result.current.isRth).toBe(false);
  });

  it("drops a malformed ping and retains last-known-good isRth (T-20-02)", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchPing({ isRth: true }); });
    expect(result.current.isRth).toBe(true);

    act(() => {
      // Malformed: isRth is a string, not a boolean — streamPingEvent.safeParse rejects it.
      es0().dispatchPing({ isRth: "yes" });
    });
    expect(result.current.isRth).toBe(true); // retained, not cleared/overwritten
  });

  // ── 4. Ticks event: hasReceivedFirstTick + greeks Map (status NOT set directly) ──

  it("a 'ticks' event sets hasReceivedFirstTick and populates the greeks Map, without setting status directly", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchTicks([SAMPLE_TICK]); });

    expect(result.current.hasReceivedFirstTick).toBe(true);
    expect(result.current.greeks.get(SAMPLE_TICK.occSymbol)).toMatchObject({
      occSymbol: SAMPLE_TICK.occSymbol,
      mark: 47.2,
      bsmDelta: 0.45,
    });
    expect(result.current.lastTickAt).toBeInstanceOf(Date);
    // Status is unaffected by the tick itself — isRth is still null (no ping yet), so
    // the shared interval (not yet run) would derive 'quiet'/'connecting' either way.
    expect(result.current.status).toBe("quiet");
  });

  it("applies every tick in a multi-tick 'ticks' array frame", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const second = { ...SAMPLE_TICK, occSymbol: "SPX   260620P04800000", mark: 12.3 };
    act(() => { es0().dispatchTicks([SAMPLE_TICK, second]); });

    expect(result.current.greeks.size).toBe(2);
    expect(result.current.greeks.get(SAMPLE_TICK.occSymbol)).toMatchObject({ mark: 47.2 });
    expect(result.current.greeks.get(second.occSymbol)).toMatchObject({ mark: 12.3 });
  });

  // ── 5. Interval-driven status derivation (Pattern 1) ─────────────────────

  // NOTE: fake timers must be installed BEFORE renderHook() in these tests — the shared
  // status interval is created synchronously inside the mount effect, so if it were
  // created under REAL timers, switching to fake timers afterward would not intercept
  // it (fake timers only govern timers registered while they are active). `waitFor`
  // (real-timer polling) is therefore replaced with `flushMicrotasks()`, which drains
  // connect()'s `await apiFetch(...)` / `await res.json()` chain via plain Promise
  // microtasks — unaffected by fake timers either way.

  it("derives 'live' via the shared interval once isRth is true and a tick has arrived", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStream());
      await act(async () => { await flushMicrotasks(); });
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => { es0().dispatchPing({ isRth: true }); });
      act(() => { es0().dispatchTicks([SAMPLE_TICK]); });
      expect(result.current.status).toBe("quiet"); // unchanged synchronously (Pattern 1)

      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(result.current.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives 'quiet' when isRth is false, even once ticks are arriving (quiet wins, Pattern 1 branch order)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStream());
      await act(async () => { await flushMicrotasks(); });
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => { es0().dispatchPing({ isRth: false }); });
      act(() => { es0().dispatchTicks([SAMPLE_TICK]); });

      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(result.current.status).toBe("quiet");
    } finally {
      vi.useRealTimers();
    }
  });

  it("transitions to 'stalled' after >= 20s of silence during RTH, and back to 'live' when ticks resume", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStream());
      await act(async () => { await flushMicrotasks(); });
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => { es0().dispatchPing({ isRth: true }); });
      act(() => { es0().dispatchTicks([SAMPLE_TICK]); });

      // Well under the 20s stall threshold — still 'live'.
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(result.current.status).toBe("live");

      // Cumulative elapsed since the last tick now exceeds the 20s threshold.
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(result.current.status).toBe("stalled");

      // A resumed tick resets the anchor; the next interval tick flips back to 'live'.
      act(() => { es0().dispatchTicks([SAMPLE_TICK]); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(result.current.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 6. onerror does not set status directly (Pitfall 1) ──────────────────

  it("es.onerror does not set status directly — only sustained elapsed silence reaches 'stalled' (Pitfall 1)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStream());
      await act(async () => { await flushMicrotasks(); });
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => { es0().dispatchPing({ isRth: true }); });
      act(() => { es0().dispatchTicks([SAMPLE_TICK]); });

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(result.current.status).toBe("live");

      // Simulate a sustained outage: every reconnect attempt after this point fails too,
      // so the elapsed-time anchor is never reset by a successful reconnect.
      mockApiFetch.mockRejectedValue(new Error("network down"));

      act(() => { es0().dispatchError(); });
      // No direct red/stalled set inside the error handler itself (Pitfall 1).
      expect(result.current.status).toBe("live");

      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(result.current.status).toBe("stalled");
    } finally {
      vi.useRealTimers();
      mockApiFetch.mockResolvedValue(makeTicketResponse());
    }
  });

  // ── 6b. Reconnect mints a FRESH ticket (no single-use ticket reuse) ──────────
  it("reconnects with a fresh ticket after an error — does not reuse the single-use ticket", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchError(); });

    // A new EventSource opens after the backoff, with a freshly-minted ticket.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 3000 });
    const ticketMints = mockApiFetch.mock.calls.filter((c) => c[0] === "/api/stream/ticket");
    expect(ticketMints.length).toBe(2);
    // The first (errored) EventSource was closed before reconnecting.
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(result.current.greeks.size).toBe(0);
  });

  // ── 7. reconnectNow (D-17) ────────────────────────────────────────────────

  it("reconnectNow cancels the pending exp-backoff timer before reconnecting (D-17 double-connect guard)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStream());
      await act(async () => { await flushMicrotasks(); });
      expect(FakeEventSource.instances).toHaveLength(1);

      act(() => { es0().dispatchError(); }); // schedules a 1000ms exp-backoff reconnect

      await act(async () => {
        result.current.reconnectNow();
        await flushMicrotasks();
      });
      expect(FakeEventSource.instances).toHaveLength(2); // the manual reconnect's fresh EventSource

      // Advance well past the original 1000ms backoff delay — if it had NOT been
      // cancelled, it would fire here and open a THIRD EventSource (double-connect).
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(FakeEventSource.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnectNow is re-entrancy-safe — a second call while one is in flight is a no-op", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    // Make the manual reconnect's ticket mint hang so a re-entrant call can be observed
    // while the first reconnectNow() is still in flight.
    let resolveMint: (value: TicketResponse) => void = () => {};
    mockApiFetch.mockImplementationOnce(
      () => new Promise<TicketResponse>((resolve) => { resolveMint = resolve; }),
    );

    act(() => { result.current.reconnectNow(); });
    expect(result.current.isReconnecting).toBe(true);

    act(() => { result.current.reconnectNow(); }); // re-entrant call — must be a no-op

    await act(async () => {
      resolveMint(makeTicketResponse());
      await flushMicrotasks();
    });

    expect(FakeEventSource.instances).toHaveLength(2); // original + exactly one manual reconnect
    expect(result.current.isReconnecting).toBe(false);
  });

  // ── 8. Malformed frames ignored ──────────────────────────────────────────

  it("ignores malformed 'ticks' frames — no throw, no state change, no cast", async () => {
    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchTicks([SAMPLE_TICK]); });
    expect(result.current.hasReceivedFirstTick).toBe(true);
    const beforeSize = result.current.greeks.size;

    act(() => {
      // "ticks" frame whose array entries do not match streamLiveGreekEvent
      es0().dispatchTicks([{ garbage: "data", shouldBeIgnored: true }]);
    });

    expect(result.current.greeks.size).toBe(beforeSize);
  });

  // ── 9. Unmount tears down EventSource ────────────────────────────────────

  it("closes the EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    unmount();

    expect(es0().closed).toBe(true);
  });

  // ── 10 + 11. subscribeAdHoc: POST fires, no second EventSource ────────────

  it("subscribeAdHoc POSTs to /api/stream/subscribe with the symbol — not a no-op (SC6)", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeTicketResponse())
      .mockResolvedValueOnce(makeSubscribeResponse(true));

    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      await result.current.subscribeAdHoc("SPX   260620C05000000");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/stream/subscribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ symbol: "SPX   260620C05000000" }),
      }),
    );

    // Must NOT open a second EventSource (ticks arrive over the existing one)
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  // ── 12. subscribeAdHoc throws on non-2xx ─────────────────────────────────

  it("subscribeAdHoc throws an error on a non-2xx response", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeTicketResponse())
      .mockResolvedValueOnce(makeSubscribeResponse(false));

    const { result } = renderHook(() => useLiveStream());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.subscribeAdHoc("SPX   260620C05000000");
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeInstanceOf(Error);
    // Narrow with instanceof before accessing `.name` (no `as` — consistent-type-assertions rule).
    if (!(caughtError instanceof Error)) throw new Error("Expected an Error instance");
    expect(caughtError.name).toBe("StreamSubscribeError");
  });
});
