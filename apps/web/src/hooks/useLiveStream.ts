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
    // `cancelled` prevents state mutation after unmount if the async mint is still
    // in flight when the component is torn down.
    let cancelled = false;

    const connect = async (): Promise<void> => {
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
        if (hasEverDisconnectedRef.current) {
          setStatus("reconnecting");
        }
        // On the very first connect, stay in 'poll' until the first tick arrives.
      };

      // On disconnect / error: freeze last values as stale.
      es.onerror = (): void => {
        hasEverDisconnectedRef.current = true;
        setStatus("stale");
      };

      // Process every unnamed SSE frame. Try both schemas; ignore if neither parses.
      es.onmessage = (event: MessageEvent): void => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return; // malformed JSON — ignore
        }

        // Try as a live greeks tick first.
        const tickResult = streamLiveGreekEvent.safeParse(raw);
        if (tickResult.success) {
          const tick = tickResult.data;
          setGreeks((prev) => {
            const next = new Map(prev);
            next.set(tick.occSymbol, tick);
            return next;
          });
          setStatus("live");
          setLastTickAt(new Date());
          return;
        }

        // Try as a reconcile event (sent on first connect and after reconnects).
        const reconcileResult = streamReconcileEvent.safeParse(raw);
        if (reconcileResult.success) {
          setStatus("live"); // restore from stale/reconnecting
          return;
        }

        // Frame matched neither schema — silently ignore (T-12-06-01).
      };
    };

    void connect();

    return (): void => {
      cancelled = true;
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
