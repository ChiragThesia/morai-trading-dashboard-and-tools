/**
 * stream-fan-out.ts — SSE fan-out hub + 1/sec per-symbol coalescer (D-07, STRM-03)
 *
 * Maintains a Set of SSEClient handles and a per-symbol tick buffer. bufferTick()
 * keeps only the latest tick per OCC symbol (coalescing); flushTicks() sends one
 * "ticks" SSE event to every live client and clears the buffer.
 *
 * Two dead-client cleanup paths (Pitfall 6 — prevents memory leak from disconnected tabs):
 *   1. aborted=true on flush → client removed before writeSSE is called
 *   2. writeSSE() rejection → client removed in .catch()
 *
 * Route handler registers onAbort → unregisterClient for clean-disconnect cleanup (a third
 * path, wired in stream.routes.ts, not here).
 *
 * D-07: ~1/sec coalescing via startFlushInterval(). The composition root (main.ts) calls
 *       startFlushInterval() once at startup.
 *
 * STRM-04: No Postgres/Drizzle import — pure in-memory pub-sub, display-only.
 * T-12-04-03: dead clients removed on aborted + writeSSE-rejection; coalescer bounds
 *             per-symbol to one tick per flush interval.
 */

import type { LiveGreekTick } from "@morai/core";

// ─── Structural SSEClient type ────────────────────────────────────────────────

/**
 * Structural subset of hono/streaming SSEStreamingApi used by the fan-out hub.
 * Tests inject fakes implementing this interface — no real Hono stream needed.
 *
 * Matches the installed hono/dist/types/helper/streaming/sse.d.ts contract:
 *   SSEStreamingApi.writeSSE(message: SSEMessage): Promise<void>
 *   StreamingApi.aborted: boolean
 *   StreamingApi.onAbort(listener: () => void | Promise<void>): void
 */
export type SSEClient = {
  writeSSE: (message: { event?: string; data: string }) => Promise<void>;
  aborted: boolean;
  onAbort: (listener: () => void) => void;
};

// ─── Module-level state ───────────────────────────────────────────────────────

/** Set of currently-connected SSE clients. */
const clients = new Set<SSEClient>();

/**
 * Per-symbol coalescer buffer (D-07).
 * bufferTick() overwrites any prior tick for the same OCC symbol.
 * flushTicks() drains this map to all live clients, then clears it.
 */
const tickBuffer = new Map<string, LiveGreekTick>();

// ─── Public API ───────────────────────────────────────────────────────────────

/** Add an SSE client to the fan-out set. Call from the SSE route handler on connect. */
export function registerClient(stream: SSEClient): void {
  clients.add(stream);
}

/** Remove an SSE client from the fan-out set. Call from onAbort and after stream ends. */
export function unregisterClient(stream: SSEClient): void {
  clients.delete(stream);
}

/**
 * bufferTick — coalesce a live greek tick into the per-symbol buffer (D-07).
 * If a tick for the same OCC symbol already exists in the buffer, it is overwritten
 * by the new value (latest-wins). Only one tick per symbol is sent per flush.
 */
export function bufferTick(tick: LiveGreekTick): void {
  tickBuffer.set(tick.occSymbol, tick);
}

/**
 * flushTicks — broadcast buffered ticks to all live clients, then clear the buffer.
 *
 * No-op if:
 *   - The buffer is empty (nothing to send)
 *   - There are no registered clients
 *
 * Dead-client cleanup (Pitfall 6 — two paths):
 *   Path 1: client.aborted is true → skip write, delete from Set immediately.
 *   Path 2: client.writeSSE() rejects → delete from Set in the .catch() handler.
 *
 * The SSE event is named "ticks" with data = JSON array of all buffered LiveGreekTick objects.
 */
export function flushTicks(): void {
  if (tickBuffer.size === 0 || clients.size === 0) return;

  const ticks = [...tickBuffer.values()];
  tickBuffer.clear();
  const data = JSON.stringify(ticks);

  for (const stream of clients) {
    if (stream.aborted) {
      clients.delete(stream);
      continue;
    }
    // void: the .catch handles rejection; we intentionally do not await the write
    void stream.writeSSE({ event: "ticks", data }).catch(() => {
      clients.delete(stream);
    });
  }
}

/**
 * startFlushInterval — begin the ~1/sec coalesced flush timer.
 *
 * Call once from the composition root (apps/server/src/main.ts) at startup.
 * The returned timer handle can be used to stop the interval on shutdown.
 *
 * Tests must NOT call this — they invoke flushTicks() directly to avoid
 * depending on real timer behaviour (assumption A5 in RESEARCH.md).
 */
export function startFlushInterval(): ReturnType<typeof setInterval> {
  return setInterval(flushTicks, 1_000);
}

// ─── Test-only reset ─────────────────────────────────────────────────────────

/**
 * resetForTesting — clears module-level state between tests.
 *
 * MUST only be called from test files. The fan-out uses module-level mutable state
 * (a Set + Map); without reset, state leaks across test cases and causes false positives.
 *
 * Named with "ForTesting" suffix to signal test-only intent (no eslint-disable needed —
 * this is a deliberate test-isolation helper, not production logic).
 */
export function resetForTesting(): void {
  clients.clear();
  tickBuffer.clear();
}
