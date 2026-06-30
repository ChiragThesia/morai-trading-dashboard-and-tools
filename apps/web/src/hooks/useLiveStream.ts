/**
 * useLiveStream — EventSource hook for the live BSM greeks stream (Plan 12-06, D-04/D-05/STRM-03)
 *
 * On mount: mints a short-lived ticket via POST /api/stream/ticket (Supabase-authed,
 * through apiFetch), then opens an EventSource at /api/stream?ticket=<ticket>.
 *
 * Every incoming frame is Zod-parsed (streamLiveGreekEvent / streamReconcileEvent).
 * Malformed frames are silently dropped — never cast into state (T-12-06-01).
 *
 * D-04 state machine:
 *   poll → live    (first valid tick or reconcile event)
 *   live → stale   (EventSource error / disconnect)
 *   stale → reconnecting  (EventSource reopens after a disconnect — onopen fires again)
 *   reconnecting → live   (reconcile event received over the re-opened EventSource)
 *
 * subscribeAdHoc(symbol): POSTs { symbol } to POST /api/stream/subscribe via apiFetch
 * (Supabase-authed). On 200, the server activates the symbol on the already-open
 * stream — no second EventSource is opened. Throws StreamSubscribeError on non-2xx.
 * This is NOT a no-op (SC6 / D-05 / STRM-01 expanded).
 *
 * Teardown: EventSource is closed on unmount.
 */

import { useState, useEffect, useRef } from "react";
import {
  streamLiveGreekEvent,
  streamReconcileEvent,
  streamTicketResponse,
} from "@morai/contracts";
import type { StreamLiveGreekEvent } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// ─── Error types ──────────────────────────────────────────────────────────────

/** Thrown when the ticket mint POST returns a non-2xx status. */
export class StreamMintError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`POST /api/stream/ticket failed: ${status}`);
    this.name = "StreamMintError";
    this.status = status;
  }
}

/**
 * Thrown by subscribeAdHoc when POST /api/stream/subscribe returns non-2xx.
 * The AdHocPicker catches this to surface inline error copy (Surface 4 error slot).
 */
export class StreamSubscribeError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`POST /api/stream/subscribe failed: ${status}`);
    this.name = "StreamSubscribeError";
    this.status = status;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Live stream connection status (D-04 state machine, UI-SPEC Surface 3). */
export type LiveStreamStatus = "live" | "stale" | "reconnecting" | "poll";

export type UseLiveStreamResult = {
  /** Latest Zod-parsed tick per OCC symbol. Keyed by occSymbol. */
  greeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  /** Current EventSource connection state. */
  status: LiveStreamStatus;
  /** Timestamp of the most recently processed tick (null until first tick). */
  lastTickAt: Date | null;
  /**
   * POST /api/stream/subscribe with { symbol } (Supabase-authed via apiFetch).
   * On 200, the server activates the symbol; ticks flow over the existing EventSource.
   * Throws StreamSubscribeError on non-2xx. Does NOT open a second EventSource. (SC6)
   */
  subscribeAdHoc: (symbol: string) => Promise<void>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveStream(): UseLiveStreamResult {
  const [greeks, setGreeks] = useState<Map<string, StreamLiveGreekEvent>>(
    () => new Map(),
  );
  const [status, setStatus] = useState<LiveStreamStatus>("poll");
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);

  // useRef for EventSource — mutation does not trigger re-render.
  const esRef = useRef<EventSource | null>(null);
  // Tracks whether the EventSource has ever disconnected (to distinguish initial
  // onopen from a post-error reconnect).
  const hasEverDisconnectedRef = useRef(false);

  useEffect(() => {
    // `cancelled` prevents state mutation / reconnects after unmount.
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = 1000;

    // Each connect() mints a FRESH single-use ticket. The browser's native
    // EventSource reconnect would reuse the consumed ticket in the URL → 401
    // (then EventSource gives up permanently), so on every error we close the
    // EventSource and reconnect ourselves with exponential backoff.
    const scheduleReconnect = (): void => {
      if (cancelled || reconnectTimer !== undefined) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    };

    async function connect(): Promise<void> {
      let ticketBody: { ticket: string };
      try {
        const res = await apiFetch("/api/stream/ticket", {
          method: "POST",
          body: JSON.stringify({}),
        });

        if (!res.ok) {
          throw new StreamMintError(res.status);
        }

        ticketBody = streamTicketResponse.parse(await res.json());
      } catch (err) {
        if (!cancelled) {
          // Log error name only — never log the message (may contain PII or token data).
          console.error(
            "useLiveStream: ticket mint failed —",
            err instanceof Error ? err.name : "UnknownError",
          );
          // A mint failure is recoverable (e.g. a transient 401 during token refresh) —
          // mark stale and retry with backoff so the stream self-heals.
          hasEverDisconnectedRef.current = true;
          setStatus("stale");
          scheduleReconnect();
        }
        return;
      }

      if (cancelled) return; // component unmounted while mint was in flight

      // Construct the EventSource URL. VITE_API_BASE_URL is "" in dev (relative path)
      // and "https://..." in production (cross-origin to Railway API).
      const base = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");
      const es = new EventSource(`${base}/api/stream?ticket=${ticketBody.ticket}`);
      esRef.current = es;

      // On (re)connect: if we've previously disconnected, move to 'reconnecting'.
      es.onopen = (): void => {
        backoffMs = 1000; // reset backoff after a successful (re)connect
        if (hasEverDisconnectedRef.current) {
          setStatus("reconnecting");
        }
        // On the very first connect, stay in 'poll' until the first tick arrives.
      };

      // On disconnect / error: freeze last values as stale, then reconnect with a
      // fresh ticket (the current one is single-use and now consumed).
      es.onerror = (): void => {
        hasEverDisconnectedRef.current = true;
        setStatus("stale");
        es.close();
        if (esRef.current === es) esRef.current = null;
        scheduleReconnect();
      };

      // The server sends NAMED SSE events (stream.routes.ts + stream-fan-out.ts):
      //   event:"ticks"     → JSON ARRAY of coalesced live greek ticks (~1/sec)
      //   event:"reconcile" → positions snapshot (cold-start + after a reconnect)
      //   event:"ping"      → keep-alive (ignored)
      // EventSource delivers NAMED events to addEventListener — never to onmessage —
      // so an onmessage-only consumer receives nothing and the badge never leaves
      // 'poll' even on a healthy stream.
      es.addEventListener("ticks", (event: Event): void => {
        if (!(event instanceof MessageEvent)) return;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return; // malformed JSON — ignore (T-12-06-01)
        }
        // "ticks" carries a JSON array of ticks (coalescer batches per flush).
        const parsed = streamLiveGreekEvent.array().safeParse(raw);
        if (!parsed.success || parsed.data.length === 0) return;
        const ticks = parsed.data;
        setGreeks((prev) => {
          const next = new Map(prev);
          for (const tick of ticks) {
            next.set(tick.occSymbol, tick);
          }
          return next;
        });
        setStatus("live");
        setLastTickAt(new Date());
      });

      es.addEventListener("reconcile", (event: Event): void => {
        if (!(event instanceof MessageEvent)) return;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return;
        }
        // Only restore from stale/reconnecting on a well-formed snapshot (T-12-06-01).
        if (!streamReconcileEvent.safeParse(raw).success) return;
        setStatus("live");
      });
    };

    void connect();

    return (): void => {
      cancelled = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (esRef.current !== null) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []); // intentionally empty — connect once on mount, clean up on unmount

  /**
   * Subscribe an ad-hoc OCC symbol to the stream (D-05, SC6).
   *
   * POSTs { symbol } to POST /api/stream/subscribe via apiFetch (Supabase-authed).
   * The server validates the symbol and activates it in the fan-out subscription set.
   * Ticks for the symbol then arrive over the already-open EventSource — this function
   * does NOT open or mutate the EventSource in any way.
   *
   * Throws StreamSubscribeError on non-2xx so the AdHocPicker can surface the error.
   */
  const subscribeAdHoc = async (symbol: string): Promise<void> => {
    const res = await apiFetch("/api/stream/subscribe", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      throw new StreamSubscribeError(res.status);
    }
  };

  return { greeks, status, lastTickAt, subscribeAdHoc };
}
