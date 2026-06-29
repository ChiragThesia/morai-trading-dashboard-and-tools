/**
 * COT contract tests (Phase 13, Plan 13-01).
 *
 * cotSeriesEntry and cotResponse are the single Zod schema source for both
 * GET /api/analytics/cot and the get_cot MCP tool (MCP-02, D-10).
 * TFF class names supersede the legacy net_noncommercial/net_commercial terms (D-05).
 *
 * The net invariant (netLeveraged = levMoneyLong - levMoneyShort) is a construction
 * property of test fixtures here; the derivation property test lives in 13-04.
 */

import { describe, it, expect } from "vitest";
import { cotSeriesEntry, cotResponse } from "./cot.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fully-populated, valid TFF E-mini S&P 500 series entry. */
const validEntry = {
  asOf: "2026-06-24",
  publishedAt: "2026-06-27T17:05:00.000Z",
  contractCode: "13874A",
  openInterest: 2_800_000,
  // Dealer / Intermediary
  dealerLong: 120_000,
  dealerShort: 90_000,
  netDealer: 30_000,
  // Asset Manager / Institutional
  assetMgrLong: 400_000,
  assetMgrShort: 300_000,
  netAssetManager: 100_000,
  // Leveraged Funds (hedge funds — headline D-05 signal)
  levMoneyLong: 250_000,
  levMoneyShort: 310_000,
  netLeveraged: -60_000, // levMoneyLong − levMoneyShort
  // Other Reportable
  otherReptLong: 80_000,
  otherReptShort: 70_000,
  netOther: 10_000,
  // Non-Reportable
  nonreptLong: 50_000,
  nonreptShort: 40_000,
  netNonreportable: 10_000,
};

// ─── cotSeriesEntry ───────────────────────────────────────────────────────────

describe("cotSeriesEntry", () => {
  it("parses a fully-populated valid entry (round-trip)", () => {
    expect(() => cotSeriesEntry.parse(validEntry)).not.toThrow();
  });

  it("round-trip preserves all numeric fields", () => {
    const parsed = cotSeriesEntry.parse(validEntry);
    expect(parsed.openInterest).toBe(2_800_000);
    expect(parsed.levMoneyLong).toBe(250_000);
    expect(parsed.levMoneyShort).toBe(310_000);
    expect(parsed.netLeveraged).toBe(-60_000);
    expect(parsed.contractCode).toBe("13874A");
    expect(parsed.asOf).toBe("2026-06-24");
  });

  it("netLeveraged = levMoneyLong - levMoneyShort in the fixture (derivation invariant)", () => {
    const parsed = cotSeriesEntry.parse(validEntry);
    expect(parsed.netLeveraged).toBe(parsed.levMoneyLong - parsed.levMoneyShort);
  });

  it("rejects a non-integer openInterest", () => {
    const result = cotSeriesEntry.safeParse({ ...validEntry, openInterest: 2_800_000.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an asOf that is not a date string (ISO 8601 date required)", () => {
    const result = cotSeriesEntry.safeParse({ ...validEntry, asOf: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (dealerLong)", () => {
    const { dealerLong: _omit, ...withoutField } = validEntry;
    const result = cotSeriesEntry.safeParse(withoutField);
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer net field (netDealer as float)", () => {
    const result = cotSeriesEntry.safeParse({ ...validEntry, netDealer: 30_000.5 });
    expect(result.success).toBe(false);
  });

  it("rejects publishedAt that is not a datetime", () => {
    const result = cotSeriesEntry.safeParse({ ...validEntry, publishedAt: "2026-06-27" });
    expect(result.success).toBe(false);
  });
});

// ─── cotResponse ─────────────────────────────────────────────────────────────

describe("cotResponse", () => {
  it("parses an array with one valid entry", () => {
    expect(() => cotResponse.parse([validEntry])).not.toThrow();
  });

  it("parses an empty array (no-data valid case)", () => {
    expect(() => cotResponse.parse([])).not.toThrow();
  });

  it("parses multiple entries", () => {
    const secondEntry = {
      ...validEntry,
      asOf: "2026-06-17",
      publishedAt: "2026-06-20T17:05:00.000Z",
    };
    expect(() => cotResponse.parse([validEntry, secondEntry])).not.toThrow();
  });

  it("rejects a non-array (single object without wrapping)", () => {
    expect(() => cotResponse.parse(validEntry)).toThrow();
  });
});
