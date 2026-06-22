import { describe, it, expect } from "vitest";
import {
  skewEntry,
  skewResponse,
  riskReversalEntry,
  riskReversalResponse,
  termStructureEntry,
  termStructureResponse,
} from "./analytics.ts";

// MCP-02: the SAME schemas back both the HTTP routes and the MCP tools. These tests assert each
// schema parses a valid entry and that the response array accepts the no-data EMPTY array (the
// no-data case returns a contract-valid empty array, never an error — SPEC R5).

describe("skewEntry / skewResponse", () => {
  const validSkew = {
    time: "2026-06-22T15:00:00.000Z",
    underlying: "SPX",
    expiration: "2026-07-17",
    strike: 5500,
    iv: 0.18,
    delta: -0.25,
    moneyness: 1.01,
  };

  it("parses a valid skew entry", () => {
    expect(() => skewEntry.parse(validSkew)).not.toThrow();
  });

  it("accepts null delta and null moneyness", () => {
    expect(() => skewEntry.parse({ ...validSkew, delta: null, moneyness: null })).not.toThrow();
  });

  it("accepts an EMPTY response array (no data, not an error)", () => {
    expect(skewResponse.parse([])).toEqual([]);
  });

  it("accepts a populated response array", () => {
    expect(skewResponse.parse([validSkew])).toHaveLength(1);
  });
});

describe("riskReversalEntry / riskReversalResponse", () => {
  const validRr = {
    time: "2026-06-22T15:00:00.000Z",
    underlying: "SPX",
    expiration: "2026-07-17",
    riskReversal: 0.03,
    rrRank: 0.72,
  };

  it("parses a valid risk-reversal entry", () => {
    expect(() => riskReversalEntry.parse(validRr)).not.toThrow();
  });

  it("accepts null riskReversal and null rrRank (unbracketable ±25Δ)", () => {
    expect(() =>
      riskReversalEntry.parse({ ...validRr, riskReversal: null, rrRank: null }),
    ).not.toThrow();
  });

  it("accepts an EMPTY response array", () => {
    expect(riskReversalResponse.parse([])).toEqual([]);
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
