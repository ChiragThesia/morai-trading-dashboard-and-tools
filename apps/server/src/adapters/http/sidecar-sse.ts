/**
 * sidecar-sse.ts — Server-side SSE consumer: sidecar → fan-out
 *
 * connectToSidecarStream fetches {sidecarUrl}/sidecar/events, reads the streaming
 * response body as SSE frames, Zod-parses each frame, and dispatches:
 *
 *   valid RawOptionTick → deps.recompute() → on ok: deps.bufferTick(result)
 *   ping / malformed / unparseable → dropped (no any/as/!, no throw)
 *
 * This is the GREENFIELD SSE consumer described in RESEARCH.md Pattern 4 and
 * PATTERNS.md sidecar-sse.ts section.
 *
 * D-02: recompute via injected recompute function (wraps recomputeLiveGreek from core).
 *   Live greeks are always BSM-derived — never raw Schwab LEVELONE greeks.
 * STRM-04: no Postgres access — pure in-memory dispatch.
 * T-12-05-04: every frame Zod-safeParsed before use — no cast on incoming frames.
 *
 * Reconnect / backoff: the CALLER (main.ts) is responsible for reconnect logic.
 * connectToSidecarStream resolves when the stream closes (fetch body done=true).
 * If the fetch fails (non-200 or network error) it throws — main.ts catches and
 * handles reconnect with a reason comment ("void connectToSidecarStream(...)").
 *
 * Injection contract: fetch + recompute + bufferTick + rate/now are all injectable
 * so tests feed a fake ReadableStream without a live sidecar.
 */

import { z } from "zod";
import type { RawOptionTick, LiveGreekTick } from "@morai/core";

// ─── Frame schema ──────────────────────────────────────────────────────────────

/**
 * Permissive schema for a sidecar LEVELONE_OPTIONS tick frame.
 *
 * Fields are nullable because Schwab sends only changed fields on incremental
 * ticks (Pitfall 4). The recompute function handles null mark via midpoint fallback.
 *
 * This schema is intentionally local to this adapter (not from packages/contracts)
 * because it represents the raw sidecar wire format, not the browser-facing event.
 */
const sidecarTickSchema = z.object({
  occSymbol: z.string(),
  mark: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  underlyingPrice: z.number().nullable(),
  ts: z.string(),
});

// ─── Dependency types ─────────────────────────────────────────────────────────

/**
 * RecomputeFn — the injected BSM recompute function.
 * Mirrors the signature of recomputeLiveGreek from @morai/core/streaming.
 */
export type RecomputeFn = (
  tick: RawOptionTick,
  rate: number,
  q: number,
  now: Date,
) => { ok: true; value: LiveGreekTick } | { ok: false; error: { kind: string } };

export type ConnectToSidecarStreamDeps = {
  /** Injectable fetch — defaults to globalThis.fetch in production. */
  readonly fetch: typeof globalThis.fetch;
  /** BSM recompute function — wraps recomputeLiveGreek (D-02). */
  readonly recompute: RecomputeFn;
  /** Fan-out tick buffer (coalescer) — wraps bufferTick from stream-fan-out.ts. */
  readonly bufferTick: (tick: LiveGreekTick) => void;
  /** Risk-free rate (decimal). Caller caches from rate_observations; refresh every 30 min. */
  readonly riskFreeRate: number;
  /** Continuous dividend yield (decimal). Typical: BSM_DIVIDEND_YIELD = 0.013. */
  readonly dividendYield: number;
  /** Reference time for T computation. Defaults to Date.now() per call in production. */
  readonly now: () => Date;
};

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * connectToSidecarStream — fetch-based SSE consumer (GREENFIELD — RESEARCH.md Pattern 4).
 *
 * Fetches GET {sidecarUrl}/sidecar/events with Accept: text/event-stream.
 * Reads the ReadableStream chunk-by-chunk, buffers, splits on blank-line (\n\n) frame
 * boundaries, extracts the "data: " line from each frame, JSON-parses, and routes by
 * Zod safeParse.
 *
 * Frame routing:
 *   - No "data: " line in frame → skip (e.g. "event: ping\ndata: \n\n")
 *   - "data: " line but JSON.parse fails → drop (malformed)
 *   - JSON OK but sidecarTickSchema.safeParse fails → drop (unexpected shape)
 *   - sidecarTickSchema.safeParse OK → call deps.recompute() with the parsed RawOptionTick
 *     → on ok → deps.bufferTick(result.value)
 *     → on err (skip result) → drop silently
 *
 * @throws When the sidecar fetch returns a non-200 status or has no body.
 *         The caller (main.ts) should catch and reconnect with backoff.
 */
export async function connectToSidecarStream(
  sidecarUrl: string,
  deps: ConnectToSidecarStreamDeps,
): Promise<void> {
  const response = await deps.fetch(`${sidecarUrl}/sidecar/events`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!response.ok || response.body === null) {
    throw new Error(
      `sidecar SSE stream failed: HTTP ${response.status} (${sidecarUrl}/sidecar/events)`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frame delimiter: blank line (\n\n)
    const frames = buffer.split("\n\n");
    // The last element may be an incomplete frame — keep it in the buffer
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      dispatchFrame(frame.trim(), deps);
    }
  }

  // Flush any remaining content in the buffer (no trailing \n\n)
  if (buffer.trim().length > 0) {
    dispatchFrame(buffer.trim(), deps);
  }
}

// ─── Frame dispatcher (private) ────────────────────────────────────────────────

/**
 * dispatchFrame — parse and route a single SSE frame.
 *
 * Drops the frame silently on any parse failure (no cast, no throw — T-12-05-04).
 */
function dispatchFrame(
  frame: string,
  deps: ConnectToSidecarStreamDeps,
): void {
  // Find the "data: " line in the frame (there may also be an "event: " line, etc.)
  const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine === undefined) {
    // Ping or event-only frame with no data payload — skip.
    return;
  }

  const rawPayload = dataLine.slice("data: ".length).trim();
  if (rawPayload === "") {
    // Empty data line (e.g. "event: ping\ndata: \n\n") — skip.
    return;
  }

  // JSON.parse — catch without type assertions (typescript.md: useUnknownInCatchVariables)
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload) as unknown;
  } catch {
    // Malformed JSON — drop the frame silently (T-12-05-04).
    return;
  }

  // Zod safeParse at the trust boundary — no any/as/! (typescript.md).
  const tickResult = sidecarTickSchema.safeParse(parsed);
  if (!tickResult.success) {
    // Unexpected shape (e.g. fill event, unknown future type) — drop silently.
    return;
  }

  const rawTick: RawOptionTick = tickResult.data;

  // BSM recompute (D-02) — skip result on no-price, bad-symbol, expired, iv-failed.
  const recomputeResult = deps.recompute(
    rawTick,
    deps.riskFreeRate,
    deps.dividendYield,
    deps.now(),
  );

  if (recomputeResult.ok) {
    // Feed the coalescer buffer (D-07, ~1/sec flush via startFlushInterval in main.ts)
    deps.bufferTick(recomputeResult.value);
  }
  // On skip (err result): drop silently — no event emitted for this tick.
}
