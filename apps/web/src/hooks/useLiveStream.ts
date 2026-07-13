/**
 * useLiveStream — EventSource hook for the live BSM greeks stream.
 *
 * On mount: mints a short-lived ticket via POST /api/stream/ticket (Supabase-authed,
 * through apiFetch), then opens an EventSource at /api/stream?ticket=<ticket>.
 *
 * Every incoming frame is Zod-parsed (streamLiveGreekEvent / streamPingEvent).
 * Malformed frames are silently dropped — never cast into state (T-12-06-01 / T-20-02).
 *
 * WATCH-01 3-state model (D-01/D-02/D-03/D-11, Phase 20 — replaces the old
 * live/stale/reconnecting/poll machine):
 *   - The server pushes `{ isRth }` on every `ping` heartbeat (D-03) — the client has no
 *     local RTH clock and never computes market-open itself.
 *   - A shared interval re-evaluates `deriveStreamStatus` (apps/web/src/lib) every
 *     STATUS_INTERVAL_MS against a single anchor timestamp — "time of the last valid
 *     tick, or connection-attempt start if none yet" — combined with the last known
 *     `isRth`. This is the ONLY place status is set.
 *   - `es.onerror`/`es.onopen` never set status directly (Pitfall 1) — they only manage
 *     the EventSource lifecycle + exponential-backoff reconnect; disconnection just stops
 *     the tick clock and lets the shared interval notice the resulting silence.
 *   - The public `status` is 3-valued ("live"|"quiet"|"stalled"). `deriveStreamStatus`'s
 *     "connecting" branch collapses into "quiet" here — CONNECTING is a copy-only
 *     condition the badge derives itself from `(status, isRth, hasReceivedFirstTick)`,
 *     not a 4th enum member (D-01).
 *
 * `reconnectNow` (D-17): a manual force-reconnect action for the STALLED badge state.
 * Cancels the pending exponential-backoff timer BEFORE reconnecting (double-connect
 * guard) and is re-entrancy-safe (a second call while one is in flight is a no-op).
 *
 * subscribeAdHoc(symbol): POSTs { symbol } to POST /api/stream/subscribe via apiFetch
 * (Supabase-authed). On 200, the server activates the symbol on the already-open
 * stream — no second EventSource is opened. Throws StreamSubscribeError on non-2xx.
 * This is NOT a no-op (SC6 / D-05 / STRM-01 expanded).
 *
 * Teardown: EventSource + the status interval are closed/cleared on unmount.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  streamLiveGreekEvent,
  streamPingEvent,
  streamTicketResponse,
  streamSpotEvent,
  streamIndicesEvent,
} from "@morai/contracts";
import type { StreamLiveGreekEvent, StreamIndicesEvent } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";
import { deriveStreamStatus } from "../lib/deriveStreamStatus.ts";

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

/** Live stream connection status (WATCH-01 3-state model, D-01). */
export type LiveStreamStatus = "live" | "quiet" | "stalled";

export type UseLiveStreamResult = {
  /** Latest Zod-parsed tick per OCC symbol. Keyed by occSymbol. */
  greeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  /** Current 3-state stream status, derived from elapsed time + server-pushed isRth. */
  status: LiveStreamStatus;
  /** Timestamp of the most recently processed tick (null until first tick). */
  lastTickAt: Date | null;
  /** Server-pushed RTH truth from the last well-formed ping (null until the first ping). */
  isRth: boolean | null;
  /** True once at least one valid "ticks" frame has been processed. */
  hasReceivedFirstTick: boolean;
  /** True while a manual reconnectNow() call is in flight. */
  isReconnecting: boolean;
  /** Latest Zod-parsed live SPX spot tick (null until the first "spot" frame). Own
   *  freshness stamp, separate from the greeks clock — a spot-only feed never flips
   *  the greeks badge to live (Phase 38 LIVE-04, catch #26). */
  liveSpot: number | null;
  /** Latest Zod-parsed VIX-family frame (null until the first "indices" frame);
   *  per-symbol nulls are preserved (a single failed symbol, never fabricated). */
  liveIndices: StreamIndicesEvent | null;
  /**
   * Manual force-reconnect (D-17, STALLED badge action). Cancels the pending
   * exponential-backoff timer, then reconnects immediately with a fresh ticket.
   * Re-entrancy-safe — a call while one is already in flight is a no-op.
   */
  reconnectNow: () => void;
  /**
   * POST /api/stream/subscribe with { symbol } (Supabase-authed via apiFetch).
   * On 200, the server activates the symbol; ticks flow over the existing EventSource.
   * Throws StreamSubscribeError on non-2xx. Does NOT open a second EventSource. (SC6)
   */
  subscribeAdHoc: (symbol: string) => Promise<void>;
};

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** ~20x the ~1/sec tick cadence (D-02, tunable) — no tick for this long during RTH → stalled. */
export const STALL_THRESHOLD_MS = 20_000;

/** Shared status-derivation re-evaluation cadence (1-5s per RESEARCH Pattern 1; 2s chosen). */
const STATUS_INTERVAL_MS = 2_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveStream(): UseLiveStreamResult {
  const [greeks, setGreeks] = useState<Map<string, StreamLiveGreekEvent>>(
    () => new Map(),
  );
  const [status, setStatus] = useState<LiveStreamStatus>("quiet");
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);
  const [isRth, setIsRth] = useState<boolean | null>(null);
  const [hasReceivedFirstTick, setHasReceivedFirstTick] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [liveSpot, setLiveSpot] = useState<number | null>(null);
  const [liveIndices, setLiveIndices] = useState<StreamIndicesEvent | null>(null);

  // useRef for EventSource — mutation does not trigger re-render.
  const esRef = useRef<EventSource | null>(null);
  // Elapsed-time anchor for deriveStreamStatus: last valid tick, or the start of the
  // most recent connection attempt if no tick has arrived yet (Pattern 1).
  const lastTickOrConnectAtRef = useRef<number>(Date.now());
  // Spot's OWN freshness anchor — deliberately separate from lastTickOrConnectAtRef so
  // a spot-only feed never flips the greeks badge to live (catch #26).
  const lastSpotAtRef = useRef<number | null>(null);
  const isRthRef = useRef<boolean | null>(null);
  const hasReceivedFirstTickRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoffMsRef = useRef(1000);
  const cancelledRef = useRef(false);
  const reconnectInFlightRef = useRef(false);
  // WR-05: a single in-flight guard shared by BOTH the timer-driven scheduleReconnect
  // path and the manual reconnectNow path, so a manual reconnect fired while a backoff
  // timer's connect() is already mid-mint cannot open a second concurrent EventSource.
  const connectInFlightRef = useRef(false);
  // Set inside the effect below so reconnectNow() can trigger a fresh connect() from
  // outside the effect's closure without duplicating the ticket-mint/EventSource logic.
  const connectRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    cancelledRef.current = false;

    // Each connect() mints a FRESH single-use ticket. The browser's native
    // EventSource reconnect would reuse the consumed ticket in the URL → 401
    // (then EventSource gives up permanently), so on every error we close the
    // EventSource and reconnect ourselves with exponential backoff.
    const scheduleReconnect = (): void => {
      if (cancelledRef.current || reconnectTimerRef.current !== undefined) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = undefined;
        void connect();
      }, backoffMsRef.current);
      backoffMsRef.current = Math.min(backoffMsRef.current * 2, 30_000);
    };

    async function connect(): Promise<void> {
      // WR-05: bail if a connect() from either path is already mid-flight, so a manual
      // reconnect and a timer-driven reconnect can never both mint a ticket + open an
      // EventSource concurrently. Cleared in the finally once this attempt finishes
      // setting up (or failing to set up) its EventSource.
      if (connectInFlightRef.current) return;
      connectInFlightRef.current = true;
      try {
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
          if (!cancelledRef.current) {
            // Log error name only — never log the message (may contain PII or token data).
            console.error(
              "useLiveStream: ticket mint failed —",
              err instanceof Error ? err.name : "UnknownError",
            );
            // A mint failure is recoverable (e.g. a transient 401 during token refresh) —
            // retry with backoff so the stream self-heals. Status is never set directly
            // here (Pitfall 1) — the shared interval will reflect the resulting silence.
            scheduleReconnect();
          }
          return;
        }

        if (cancelledRef.current) return; // component unmounted while mint was in flight

        // A fresh connection attempt resets the elapsed-time anchor — it starts its own
        // ~20s cold-start grace window (D-11), same as a resumed tick would.
        lastTickOrConnectAtRef.current = Date.now();

        // Construct the EventSource URL. VITE_API_BASE_URL is "" in dev (relative path)
        // and "https://..." in production (cross-origin to Railway API).
        const base = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");
        const es = new EventSource(`${base}/api/stream?ticket=${ticketBody.ticket}`);
        esRef.current = es;

        es.onopen = (): void => {
          backoffMsRef.current = 1000; // reset backoff after a successful (re)connect
        };

        // On disconnect / error: close and reconnect with a fresh ticket (the current one
        // is single-use and now consumed). Status is deliberately NOT set here (Pitfall 1) —
        // a transient reconnect stops the tick clock, and the shared interval decides
        // LIVE/QUIET/STALLED from how long that silence has lasted, not from this handler.
        es.onerror = (): void => {
          es.close();
          if (esRef.current === es) esRef.current = null;
          scheduleReconnect();
        };

        // The server sends NAMED SSE events (stream.routes.ts + stream-fan-out.ts):
        //   event:"ticks" → JSON ARRAY of coalesced live greek ticks (~1/sec)
        //   event:"ping"  → keep-alive carrying server-authoritative { isRth } (D-03)
        // EventSource delivers NAMED events to addEventListener — never to onmessage —
        // so an onmessage-only consumer receives nothing.
        es.addEventListener("ping", (event: Event): void => {
          if (!(event instanceof MessageEvent)) return;
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return; // malformed JSON — drop, retain last-known-good isRth (T-20-02)
          }
          const parsed = streamPingEvent.safeParse(raw);
          if (!parsed.success) return; // malformed shape — drop, retain last-known-good isRth
          isRthRef.current = parsed.data.isRth;
          setIsRth(parsed.data.isRth);
        });

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
          hasReceivedFirstTickRef.current = true;
          setHasReceivedFirstTick(true);
          lastTickOrConnectAtRef.current = Date.now();
          setLastTickAt(new Date());
        });

        // event:"spot" → dedicated live SPX spot lane (Phase 38 LIVE-04). Own freshness
        // stamp — does NOT touch lastTickOrConnectAtRef/hasReceivedFirstTick, so a
        // spot-only feed never paints the greeks badge live (catch #26).
        es.addEventListener("spot", (event: Event): void => {
          if (!(event instanceof MessageEvent)) return;
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return; // malformed JSON — drop, retain last-known-good liveSpot
          }
          const parsed = streamSpotEvent.safeParse(raw);
          if (!parsed.success) return; // malformed shape — drop, retain last-known-good
          lastSpotAtRef.current = Date.now();
          setLiveSpot(parsed.data.spot);
        });

        // event:"indices" → VIX-family live quotes (Phase 38 LIVE-04). Display-only —
        // regime gates keep reading EOD macro_observations, never this stream.
        es.addEventListener("indices", (event: Event): void => {
          if (!(event instanceof MessageEvent)) return;
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return; // malformed JSON — drop, retain last-known-good liveIndices
          }
          const parsed = streamIndicesEvent.safeParse(raw);
          if (!parsed.success) return; // malformed shape — drop, retain last-known-good
          setLiveIndices(parsed.data);
        });
      } finally {
        connectInFlightRef.current = false;
      }
    }

    connectRef.current = connect;
    void connect();

    // The ONLY place status is set — re-evaluates every STATUS_INTERVAL_MS against the
    // elapsed-time anchor + last known isRth, so a stall is detected even when no event
    // ever arrives to trigger it (Pattern 1 — silence is itself the signal).
    const statusInterval = setInterval(() => {
      const derived = deriveStreamStatus({
        hasReceivedFirstTick: hasReceivedFirstTickRef.current,
        msSinceLastTickOrConnect: Date.now() - lastTickOrConnectAtRef.current,
        isRth: isRthRef.current,
        stallThresholdMs: STALL_THRESHOLD_MS,
      });
      // "connecting" is a copy-only condition the badge derives itself — no 4th enum
      // member on the public status (D-01).
      setStatus(derived === "connecting" ? "quiet" : derived);
    }, STATUS_INTERVAL_MS);

    return (): void => {
      cancelledRef.current = true;
      clearInterval(statusInterval);
      if (reconnectTimerRef.current !== undefined) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = undefined;
      }
      if (esRef.current !== null) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []); // intentionally empty — connect once on mount, clean up on unmount

  /**
   * Manual force-reconnect (D-17). Cancels the pending exponential-backoff timer BEFORE
   * reconnecting so the stale timer can never fire later and open a second EventSource
   * on top of this manual one (double-connect guard). Re-entrancy-safe: a call while one
   * is already in flight is a no-op.
   */
  const reconnectNow = useCallback((): void => {
    if (reconnectInFlightRef.current) return;
    reconnectInFlightRef.current = true;
    setIsReconnecting(true);

    if (reconnectTimerRef.current !== undefined) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    backoffMsRef.current = 1000;

    if (esRef.current !== null) {
      esRef.current.close();
      esRef.current = null;
    }

    void connectRef.current().finally(() => {
      reconnectInFlightRef.current = false;
      setIsReconnecting(false);
    });
  }, []);

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

  return {
    greeks,
    status,
    lastTickAt,
    isRth,
    hasReceivedFirstTick,
    isReconnecting,
    liveSpot,
    liveIndices,
    reconnectNow,
    subscribeAdHoc,
  };
}
