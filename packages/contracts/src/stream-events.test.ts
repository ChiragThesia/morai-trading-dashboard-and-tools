/**
 * Stream-events contract tests — RED phase
 *
 * Enforces the sidecar→server→browser SSE payload schemas.
 * Key invariant (Pitfall 5 / chain_proxy.py lesson): timestamps must end in "Z".
 * A "+00:00" suffix MUST be rejected.
 */

import { describe, it, expect } from "vitest";
import {
  streamTicketResponse,
  streamLiveGreekEvent,
  streamReconcileEvent,
  streamFillEvent,
  streamPingEvent,
  streamSpotEvent,
  streamIndicesEvent,
} from "./stream-events.ts";

// ─── streamTicketResponse ─────────────────────────────────────────────────────

describe("streamTicketResponse", () => {
  it("accepts a valid UUID ticket", () => {
    const result = streamTicketResponse.safeParse({
      ticket: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    const result = streamTicketResponse.safeParse({ ticket: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing ticket field", () => {
    const result = streamTicketResponse.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── streamLiveGreekEvent ─────────────────────────────────────────────────────

const validLiveGreekPayload = {
  occSymbol: "SPX   260620C05000000",
  mark: 12.5,
  bid: 12.0,
  ask: 13.0,
  bsmIv: 0.18,
  bsmDelta: 0.45,
  bsmGamma: 0.002,
  bsmTheta: -0.05,
  bsmVega: 0.12,
  ts: "2026-06-28T14:30:00.000Z",
};

describe("streamLiveGreekEvent", () => {
  it("accepts a valid payload with Z-suffix timestamp", () => {
    const result = streamLiveGreekEvent.safeParse(validLiveGreekPayload);
    expect(result.success).toBe(true);
  });

  it("rejects a +00:00 suffix timestamp — chain_proxy.py Z-suffix contract", () => {
    const result = streamLiveGreekEvent.safeParse({
      ...validLiveGreekPayload,
      ts: "2026-06-28T14:30:00.000+00:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null bid", () => {
    const result = streamLiveGreekEvent.safeParse({
      ...validLiveGreekPayload,
      bid: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null ask", () => {
    const result = streamLiveGreekEvent.safeParse({
      ...validLiveGreekPayload,
      ask: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing mark field", () => {
    const { mark: _mark, ...rest } = validLiveGreekPayload;
    const result = streamLiveGreekEvent.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("greeks are numbers, not strings (diverges from live-greeks.ts string convention)", () => {
    const result = streamLiveGreekEvent.safeParse({
      ...validLiveGreekPayload,
      bsmIv: "0.18",
    });
    // string is NOT accepted — stream events carry numbers directly
    expect(result.success).toBe(false);
  });
});

// ─── streamReconcileEvent ─────────────────────────────────────────────────────

describe("streamReconcileEvent", () => {
  it("accepts a valid reconcile payload", () => {
    const result = streamReconcileEvent.safeParse({
      positions: [
        {
          occSymbol: "SPX   260620C05000000",
          longQty: 1,
          shortQty: 0,
          underlyingSymbol: "SPX",
          marketValue: 1250.0,
        },
      ],
      asOf: "2026-06-28T14:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null marketValue in positions", () => {
    const result = streamReconcileEvent.safeParse({
      positions: [
        {
          occSymbol: "SPX   260620C05000000",
          longQty: 0,
          shortQty: 1,
          underlyingSymbol: "SPX",
          marketValue: null,
        },
      ],
      asOf: "2026-06-28T14:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty positions array", () => {
    const result = streamReconcileEvent.safeParse({
      positions: [],
      asOf: "2026-06-28T14:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects +00:00 asOf timestamp", () => {
    const result = streamReconcileEvent.safeParse({
      positions: [],
      asOf: "2026-06-28T14:30:00.000+00:00",
    });
    expect(result.success).toBe(false);
  });
});

// ─── streamFillEvent ─────────────────────────────────────────────────────────

describe("streamFillEvent", () => {
  it("accepts a fill event with ts and any activity shape", () => {
    const result = streamFillEvent.safeParse({
      ts: "2026-06-28T14:35:00.000Z",
      activity: { MESSAGE_TYPE: "OrderFill", MESSAGE_DATA: "<xml>" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts activity as a string (permissive — MESSAGE_TYPE undocumented)", () => {
    const result = streamFillEvent.safeParse({
      ts: "2026-06-28T14:35:00.000Z",
      activity: "raw message data",
    });
    expect(result.success).toBe(true);
  });

  it("rejects +00:00 ts in fill event", () => {
    const result = streamFillEvent.safeParse({
      ts: "2026-06-28T14:35:00.000+00:00",
      activity: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing ts field", () => {
    const result = streamFillEvent.safeParse({
      activity: { MESSAGE_TYPE: "OrderFill" },
    });
    expect(result.success).toBe(false);
  });
});

// ─── streamSpotEvent ──────────────────────────────────────────────────────────

describe("streamSpotEvent", () => {
  it("accepts a valid payload with Z-suffix timestamp (non-round spot per catch #20)", () => {
    const result = streamSpotEvent.safeParse({
      spot: 5842.375,
      ts: "2026-07-13T14:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a +00:00 suffix timestamp — chain_proxy.py Z-suffix contract", () => {
    const result = streamSpotEvent.safeParse({
      spot: 5842.375,
      ts: "2026-07-13T14:30:00.000+00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-number spot", () => {
    const result = streamSpotEvent.safeParse({
      spot: "5842.375",
      ts: "2026-07-13T14:30:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing spot field", () => {
    const result = streamSpotEvent.safeParse({ ts: "2026-07-13T14:30:00.000Z" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing ts field", () => {
    const result = streamSpotEvent.safeParse({ spot: 5842.375 });
    expect(result.success).toBe(false);
  });

  it("streamLiveGreekEvent still parses a known-good payload — additive, not breaking", () => {
    const result = streamLiveGreekEvent.safeParse(validLiveGreekPayload);
    expect(result.success).toBe(true);
  });
});

// ─── streamIndicesEvent ───────────────────────────────────────────────────────

describe("streamIndicesEvent", () => {
  const validIndicesPayload = {
    vix: 15.2,
    vvix: 92.1,
    vix9d: 14.8,
    vix3m: 16.5,
    ts: "2026-07-13T14:30:00.000Z",
  };

  it("accepts a valid payload with all four symbols present", () => {
    const result = streamIndicesEvent.safeParse(validIndicesPayload);
    expect(result.success).toBe(true);
  });

  it("accepts per-symbol nulls — Schwab omits rather than fabricates", () => {
    const result = streamIndicesEvent.safeParse({
      ...validIndicesPayload,
      vvix: null,
      vix9d: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a +00:00 suffix timestamp", () => {
    const result = streamIndicesEvent.safeParse({
      ...validIndicesPayload,
      ts: "2026-07-13T14:30:00.000+00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a string where a number|null is expected", () => {
    const result = streamIndicesEvent.safeParse({
      ...validIndicesPayload,
      vix: "15.2",
    });
    expect(result.success).toBe(false);
  });
});

// ─── streamPingEvent ──────────────────────────────────────────────────────────

describe("streamPingEvent", () => {
  it("round-trips isRth: true", () => {
    const result = streamPingEvent.parse({ isRth: true });
    expect(result).toEqual({ isRth: true });
  });

  it("round-trips isRth: false", () => {
    const result = streamPingEvent.parse({ isRth: false });
    expect(result).toEqual({ isRth: false });
  });

  it("rejects a missing isRth field", () => {
    const result = streamPingEvent.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean isRth", () => {
    const result = streamPingEvent.safeParse({ isRth: "yes" });
    expect(result.success).toBe(false);
  });

  it("strips extra keys (additive-safe)", () => {
    const result = streamPingEvent.safeParse({ isRth: true, extra: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ isRth: true });
    }
  });
});
