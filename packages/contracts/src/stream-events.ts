import { z } from "zod";

// MCP-02: ONE schema source for the sidecar→server→browser SSE stream payloads.
// Parsed at every trust boundary (sidecar JSON → Zod → typed TS).
//
// Timestamp discipline (chain_proxy.py lesson, Pitfall 5):
//   All ts / asOf fields use z.string().datetime() which REQUIRES a trailing "Z".
//   Python's datetime.isoformat() emits "+00:00" by default — that is REJECTED here.
//   Sidecar must call .replace("+00:00", "Z") before emitting any timestamp field.
//
// Greek values diverge from live-greeks.ts intentionally:
//   live-greeks.ts uses string fields (journal display-formatted strings).
//   stream-events uses number fields — stream payloads are ephemeral display-only
//   data consumed directly by fmtGreek on the client, not persisted or journal-matched.
//   See D-02: live = BSM math at streaming cadence; no raw Schwab greeks here.

// ─── streamTicketResponse ─────────────────────────────────────────────────────

/**
 * Response from POST /api/stream/ticket — a short-lived single-use opaque UUID.
 * The UUID is passed as ?ticket= to GET /api/stream (D-01).
 */
export const streamTicketResponse = z.object({
  ticket: z.string().uuid(),
});

export type StreamTicketResponse = z.infer<typeof streamTicketResponse>;

// ─── streamLiveGreekEvent ─────────────────────────────────────────────────────

/**
 * SSE "ticks" event payload — one per OCC symbol, coalesced to ~1/sec (D-07).
 * Greeks are BSM-recomputed (D-02) — never Schwab raw LEVELONE greeks.
 * STRM-04: display-only; this event is never persisted to leg_observations.
 */
export const streamLiveGreekEvent = z.object({
  occSymbol: z.string(),
  mark: z.number(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  bsmIv: z.number(),
  bsmDelta: z.number(),
  bsmGamma: z.number(),
  bsmTheta: z.number(),
  bsmVega: z.number(),
  /** ISO-8601 UTC timestamp. MUST end in "Z" — "+00:00" is rejected. */
  ts: z.string().datetime(),
});

export type StreamLiveGreekEvent = z.infer<typeof streamLiveGreekEvent>;

// ─── streamReconcilePosition ──────────────────────────────────────────────────

const streamReconcilePosition = z.object({
  occSymbol: z.string(),
  longQty: z.number(),
  shortQty: z.number(),
  underlyingSymbol: z.string(),
  marketValue: z.number().nullable(),
});

export type StreamReconcilePosition = z.infer<typeof streamReconcilePosition>;

// ─── streamReconcileEvent ─────────────────────────────────────────────────────

/**
 * SSE "reconcile" event payload — current open positions snapshot (STRM-05).
 * Sent on first connect and on every reconnect so the browser has a cold-start baseline.
 * Shape mirrors /sidecar/positions response decomposed for the browser.
 */
export const streamReconcileEvent = z.object({
  positions: z.array(streamReconcilePosition),
  /** ISO-8601 UTC timestamp of the reconcile snapshot. MUST end in "Z". */
  asOf: z.string().datetime(),
});

export type StreamReconcileEvent = z.infer<typeof streamReconcileEvent>;

// ─── streamFillEvent ─────────────────────────────────────────────────────────

/**
 * SSE "fill" event payload — raw ACCT_ACTIVITY forwarded from the sidecar.
 *
 * IMPORTANT (D-03 / Pitfall 1 / RESEARCH.md Open Question 1):
 *   ACCT_ACTIVITY MESSAGE_TYPE values are UNDOCUMENTED on the Schwab API.
 *   The `activity` field is intentionally z.unknown() — do NOT add a MESSAGE_TYPE enum.
 *   Discover actual type strings empirically from live fills during UAT.
 *
 * Security (T-12-01-02): the forwarder in 12-02 strips the raw ACCOUNT field before
 *   this payload reaches the browser. No account numbers in browser-facing events.
 */
export const streamFillEvent = z.object({
  /** ISO-8601 UTC timestamp. MUST end in "Z". */
  ts: z.string().datetime(),
  activity: z.unknown(),
});

export type StreamFillEvent = z.infer<typeof streamFillEvent>;
