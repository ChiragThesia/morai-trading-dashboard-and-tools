import { describe, it, expect } from "vitest";
import {
  skewEntry,
  skewResponse,
  skewSmileEntry,
  skewSmileResponse,
  termStructureEntry,
  termStructureResponse,
} from "./analytics.ts";

// MCP-02: the SAME schemas back both the HTTP routes and the MCP tools. These tests assert each
// schema parses a valid entry and that the response array accepts the no-data EMPTY array (the
// no-data case returns a contract-valid empty array, never an error — SPEC R5).

// skewEntry/skewResponse is the HEADLINE skew read (value = risk_reversal + rr_rank) — SPEC R5.
describe("skewEntry / skewResponse (headline risk-reversal)", () => {
  const validSkew = {
    time: "2026-06-22T15:00:00.000Z",
    underlying: "SPX",
    expiration: "2026-07-17",
    value: 0.03,
    rrRank: 0.72,
  };

  it("parses a valid headline skew entry", () => {
    expect(() => skewEntry.parse(validSkew)).not.toThrow();
  });

  it("accepts null value and null rrRank (unbracketable ±25Δ)", () => {
    expect(() => skewEntry.parse({ ...validSkew, value: null, rrRank: null })).not.toThrow();
  });

  it("accepts an EMPTY response array (no data, not an error)", () => {
    expect(skewResponse.parse([])).toEqual([]);
  });

  it("accepts a populated response array", () => {
    expect(skewResponse.parse([validSkew])).toHaveLength(1);
  });

  // WR-01: the first-ever risk-reversal has a real value but no rank (empty trailing history).
  // The contract must carry rrRank: null end-to-end.
  it("accepts a response entry with a real value but null rrRank (first-ever, no history)", () => {
    const parsed = skewResponse.parse([{ ...validSkew, value: 0.06, rrRank: null }]);
    expect(parsed[0]?.rrRank).toBeNull();
    expect(parsed[0]?.value).toBe(0.06);
  });
});

describe("skewSmileEntry / skewSmileResponse (per-strike detail)", () => {
  const validSmile = {
    time: "2026-06-22T15:00:00.000Z",
    underlying: "SPX",
    expiration: "2026-07-17",
    strike: 5500,
    iv: 0.18,
    delta: -0.25,
    moneyness: 1.01,
  };

  it("parses a valid smile entry", () => {
    expect(() => skewSmileEntry.parse(validSmile)).not.toThrow();
  });

  it("accepts null delta and null moneyness", () => {
    expect(() =>
      skewSmileEntry.parse({ ...validSmile, delta: null, moneyness: null }),
    ).not.toThrow();
  });

  it("accepts an EMPTY response array", () => {
    expect(skewSmileResponse.parse([])).toEqual([]);
  });
});

describe("termStructureEntry / termStructureResponse", () => {
  const validTs = {
    time: "2026-06-22T15:00:00.000Z",
    calendarId: "550e8400-e29b-41d4-a716-446655440001",
    value: -0.012,
  };

  it("parses a valid term-structure entry", () => {
    expect(() => termStructureEntry.parse(validTs)).not.toThrow();
  });

  it("accepts an EMPTY response array", () => {
    expect(termStructureResponse.parse([])).toEqual([]);
  });

  it("accepts a populated response array", () => {
    expect(termStructureResponse.parse([validTs])).toHaveLength(1);
  });
});
