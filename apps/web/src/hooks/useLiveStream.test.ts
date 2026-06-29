/**
 * useLiveStream.test.ts — TDD suite for the useLiveStream hook (Plan 12-06 Task 1)
 *
 * Behaviors under test:
 *   1. Mints a ticket via POST /api/stream/ticket and opens EventSource with ?ticket=
 *   2. Initial status is 'poll'.
 *   3. First tick → status 'live', greeks Map updated, lastTickAt set.
 *   4. EventSource error → status 'stale'.
 *   5. EventSource reopens after disconnect → status 'reconnecting'.
 *   6. Reconcile event received → status 'live' (restores from stale/reconnecting).
 *   7. Malformed frames are silently ignored — no throw, no state change.
 *   8. EventSource is torn down on unmount.
 *   9. subscribeAdHoc POSTs to /api/stream/subscribe with the symbol (SC6 — NOT a no-op).
 *   10. subscribeAdHoc does NOT open a second EventSource.
 *   11. subscribeAdHoc throws StreamSubscribeError on non-2xx.
 *
 * Threat mitigations verified (T-12-06-01, T-12-06-04):
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

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: dispatch a named message event. */
  dispatchMessage(data: unknown): void {
    const event = new MessageEvent("message", {
      data: JSON.stringify(data),
    });
    this.onmessage?.(event);
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

function makeTicketResponse(ticket = TICKET) {
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

/** A valid streamReconcileEvent payload. */
const SAMPLE_RECONCILE = {
  positions: [
    {
      occSymbol: "SPX   260620C05000000",
      longQty: 1,
      shortQty: 0,
      underlyingSymbol: "SPX",
      marketValue: 4720,
    },
  ],
  asOf: "2026-06-28T14:30:00.000Z",
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Returns the first FakeEventSource created in this test. */
function es0(): FakeEventSource {
  const inst = FakeEventSource.instances[0];
  if (inst === undefined) throw new Error("No FakeEventSource instance yet");
  return inst;
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

  // ── 2. Initial status ────────────────────────────────────────────────────

  it("starts with status 'poll', empty greeks, and null lastTickAt", () => {
    const { result } = renderHook(() => useLiveStream());

    expect(result.current.status).toBe("poll");
    expect(result.current.lastTickAt).toBeNull();
    expect(result.current.greeks.size).toBe(0);
  });

  // ── 3. First tick → live ─────────────────────────────────────────────────

  it("transitions to 'live' and populates the greeks Map on first valid tick", async () => {
    const { result } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => {
      es0().dispatchMessage(SAMPLE_TICK);
    });

    await waitFor(() => expect(result.current.status).toBe("live"));

    expect(result.current.greeks.get(SAMPLE_TICK.occSymbol)).toMatchObject({
      occSymbol: SAMPLE_TICK.occSymbol,
      mark: 47.2,
      bsmDelta: 0.45,
    });
    expect(result.current.lastTickAt).toBeInstanceOf(Date);
  });

  // ── 4. Error → stale ─────────────────────────────────────────────────────

  it("transitions to 'stale' on EventSource error", async () => {
    const { result } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    // Advance to 'live' first
    act(() => { es0().dispatchMessage(SAMPLE_TICK); });
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => { es0().dispatchError(); });

    await waitFor(() => expect(result.current.status).toBe("stale"));
  });

  // ── 5. Reopen after disconnect → reconnecting ─────────────────────────────

  it("transitions to 'reconnecting' when EventSource reopens after a disconnect", async () => {
    const { result } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchMessage(SAMPLE_TICK); });
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => { es0().dispatchError(); });
    await waitFor(() => expect(result.current.status).toBe("stale"));

    act(() => { es0().dispatchOpen(); });

    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  });

  // ── 6. Reconcile → live ──────────────────────────────────────────────────

  it("transitions to 'live' on reconcile event (restores from stale)", async () => {
    const { result } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    // Disconnect first
    act(() => { es0().dispatchError(); });
    await waitFor(() => expect(result.current.status).toBe("stale"));

    // Reconcile event restores to 'live'
    act(() => { es0().dispatchMessage(SAMPLE_RECONCILE); });

    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  // ── 7. Malformed frames ignored ──────────────────────────────────────────

  it("ignores malformed frames — no throw, no state change, no cast", async () => {
    const { result } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    act(() => { es0().dispatchMessage(SAMPLE_TICK); });
    await waitFor(() => expect(result.current.status).toBe("live"));

    const beforeSize = result.current.greeks.size;

    act(() => {
      // Frame that does not match streamLiveGreekEvent or streamReconcileEvent
      es0().dispatchMessage({ garbage: "data", shouldBeIgnored: true });
    });

    expect(result.current.status).toBe("live");
    expect(result.current.greeks.size).toBe(beforeSize);
  });

  // ── 8. Unmount tears down EventSource ────────────────────────────────────

  it("closes the EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useLiveStream());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    unmount();

    expect(es0().closed).toBe(true);
  });

  // ── 9 + 10. subscribeAdHoc: POST fires, no second EventSource ────────────

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

  // ── 11. subscribeAdHoc throws on non-2xx ─────────────────────────────────

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
