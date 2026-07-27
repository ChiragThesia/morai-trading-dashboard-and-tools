/**
 * Chain contract tests (Analyzer rework, Unit 1).
 *
 * chainRow and chainResponse are the single Zod schema source for both the chain HTTP
 * route and its MCP tool twin (MCP-02). chainResponse IS an array (unlike gex) — one row
 * per strike/expiration/side, so `[]` is the valid no-data case.
 *
 * Oracle values follow the live conventions: strike ×1000 integer (7400000 = 7400),
 * bsmIv decimal (0.1249 = 12.49%), observedAt Z-suffixed ISO 8601.
 */

import { describe, it, expect } from "vitest";
import { chainRow, chainResponse } from "./chain.ts";

// ─── Fixture ─────────────────────────────────────────────────────────────────

/** A fully-populated, valid chain row: SPX 7400 call, 27 DTE, solved IV 12.49%. */
const validRow = {
  strike: 7_400_000, // ×1000 → 7400 points
  expiration: "2026-08-21",
  contractType: "C",
  dte: 27,
  bsmIv: 0.1249, // decimal → 12.49%
  bid: 118.4,
  ask: 121.6,
  openInterest: 17_071,
  underlyingPrice: 7381.12,
  source: "schwab",
  observedAt: "2026-07-25T14:00:24.000Z",
};

// ─── chainRow ────────────────────────────────────────────────────────────────

describe("chainRow", () => {
  it("parses a fully-populated valid row", () => {
    expect(() => chainRow.parse(validRow)).not.toThrow();
  });

  it("round-trip preserves every field value", () => {
    const parsed = chainRow.parse(validRow);
    expect(parsed.strike).toBe(7_400_000);
    expect(parsed.expiration).toBe("2026-08-21");
    expect(parsed.contractType).toBe("C");
    expect(parsed.dte).toBe(27);
    expect(parsed.bsmIv).toBe(0.1249);
    expect(parsed.bid).toBe(118.4);
    expect(parsed.ask).toBe(121.6);
    expect(parsed.openInterest).toBe(17_071);
    expect(parsed.underlyingPrice).toBe(7381.12);
    expect(parsed.source).toBe("schwab");
    expect(parsed.observedAt).toBe("2026-07-25T14:00:24.000Z");
  });

  it("accepts null bsmIv (never solved)", () => {
    const parsed = chainRow.parse({ ...validRow, bsmIv: null });
    expect(parsed.bsmIv).toBeNull();
  });

  it('accepts contractType "P"', () => {
    const parsed = chainRow.parse({ ...validRow, contractType: "P" });
    expect(parsed.contractType).toBe("P");
  });

  it("rejects a contractType outside the C/P enum", () => {
    expect(() => chainRow.parse({ ...validRow, contractType: "CALL" })).toThrow();
  });

  it('accepts source "cboe"', () => {
    const parsed = chainRow.parse({ ...validRow, source: "cboe" });
    expect(parsed.source).toBe("cboe");
  });

  it("rejects a source outside the schwab/cboe enum", () => {
    expect(() => chainRow.parse({ ...validRow, source: "orats" })).toThrow();
  });

  it("rejects a fractional strike (×1000 integer convention)", () => {
    expect(() => chainRow.parse({ ...validRow, strike: 7_412_500.5 })).toThrow();
  });

  it("rejects a fractional dte (calendar days are whole)", () => {
    expect(() => chainRow.parse({ ...validRow, dte: 27.5 })).toThrow();
  });

  it("rejects a fractional openInterest (contracts are whole)", () => {
    expect(() => chainRow.parse({ ...validRow, openInterest: 17_071.5 })).toThrow();
  });

  it("accepts dte 0 (0DTE) and zero bid/ask/openInterest (untraded strike)", () => {
    const parsed = chainRow.parse({ ...validRow, dte: 0, bid: 0, ask: 0, openInterest: 0 });
    expect(parsed.dte).toBe(0);
    expect(parsed.bid).toBe(0);
    expect(parsed.openInterest).toBe(0);
  });

  it("rejects a missing required field (bid)", () => {
    const { bid: _omit, ...withoutBid } = validRow;
    expect(() => chainRow.parse(withoutBid)).toThrow();
  });

  it("rejects a missing required field (observedAt)", () => {
    const { observedAt: _omit, ...withoutObservedAt } = validRow;
    expect(() => chainRow.parse(withoutObservedAt)).toThrow();
  });

  it("rejects a missing bsmIv (nullable is not optional)", () => {
    const { bsmIv: _omit, ...withoutIv } = validRow;
    expect(() => chainRow.parse(withoutIv)).toThrow();
  });
});

// ─── chainResponse ───────────────────────────────────────────────────────────

describe("chainResponse", () => {
  it("parses an array with one valid row", () => {
    const parsed = chainResponse.parse([validRow]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.strike).toBe(7_400_000);
  });

  it("parses an empty array (no-data valid case)", () => {
    const parsed = chainResponse.parse([]);
    expect(parsed).toEqual([]);
  });

  it("parses multiple rows and preserves cardinality + order", () => {
    const putRow = { ...validRow, contractType: "P", bid: 96.2, ask: 99.4 };
    const parsed = chainResponse.parse([validRow, putRow]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.contractType).toBe("C");
    expect(parsed[1]?.contractType).toBe("P");
  });

  it("rejects a non-array (single row without wrapping)", () => {
    expect(() => chainResponse.parse(validRow)).toThrow();
  });

  it("rejects the whole array when one row is invalid", () => {
    expect(() => chainResponse.parse([validRow, { ...validRow, source: "orats" }])).toThrow();
  });
});
