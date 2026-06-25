/**
 * journal-history.test.ts — Unit tests for classifyTradeHistory (JOURNAL-01 foundation)
 *
 * RED phase: Assert expected behavior before implementation exists.
 *
 * classifyTradeHistory(trade) returns:
 *   "history"       — trade lifecycle overlaps the Jun-12-forward chain window
 *   "entry-exit-only" — trade whose entire lifecycle is before 2026-06-12
 *
 * JOURNAL-01: trades before the Jun-12 chain start never produce errors — just a badge.
 */
import { describe, it, expect } from "vitest";
import { classifyTradeHistory } from "./journal-history.ts";

describe("classifyTradeHistory", () => {
  it("returns 'history' when the trade has at least one snapshot on or after 2026-06-12", () => {
    const result = classifyTradeHistory({
      openedAt: "2026-06-12T14:00:00.000Z",
      closedAt: "2026-06-15T20:00:00.000Z",
      hasSnapshots: true,
    });
    expect(result).toBe("history");
  });

  it("returns 'history' when the trade opened after 2026-06-12", () => {
    const result = classifyTradeHistory({
      openedAt: "2026-06-17T14:00:00.000Z",
      closedAt: "2026-06-20T20:00:00.000Z",
      hasSnapshots: true,
    });
    expect(result).toBe("history");
  });

  it("returns 'entry-exit-only' when the trade closed entirely before 2026-06-12", () => {
    const result = classifyTradeHistory({
      openedAt: "2026-05-01T14:00:00.000Z",
      closedAt: "2026-06-01T20:00:00.000Z",
      hasSnapshots: false,
    });
    expect(result).toBe("entry-exit-only");
  });

  it("returns 'entry-exit-only' when the trade opened before Jun-12 and has no snapshots", () => {
    const result = classifyTradeHistory({
      openedAt: "2026-04-16T14:00:00.000Z",
      closedAt: "2026-06-01T20:00:00.000Z",
      hasSnapshots: false,
    });
    expect(result).toBe("entry-exit-only");
  });

  it("returns 'history' for an OPEN trade (null closedAt) when snapshots exist", () => {
    // An OPEN trade with chain data (snapshots on/after Jun-12) is classified as history
    const result = classifyTradeHistory({
      openedAt: "2026-06-22T14:00:00.000Z",
      closedAt: null,
      hasSnapshots: true,
    });
    expect(result).toBe("history");
  });

  it("returns 'entry-exit-only' for an OPEN trade opened before Jun-12 with no snapshots", () => {
    // An OPEN trade predating chain history — entry/exit badges
    const result = classifyTradeHistory({
      openedAt: "2026-05-19T14:00:00.000Z",
      closedAt: null,
      hasSnapshots: false,
    });
    expect(result).toBe("entry-exit-only");
  });

  it("returns 'history' for a trade that opened before Jun-12 but has snapshots on/after it", () => {
    // Trade opened before chain start, but extends into the chain window
    const result = classifyTradeHistory({
      openedAt: "2026-06-09T14:00:00.000Z",
      closedAt: "2026-06-15T20:00:00.000Z",
      hasSnapshots: true,
    });
    expect(result).toBe("history");
  });
});
