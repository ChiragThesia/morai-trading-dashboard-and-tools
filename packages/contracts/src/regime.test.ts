/**
 * regime contract tests (Phase 24, Plan 24-03).
 *
 * regimeIndicator / regimeResponse are the single Zod schema source for both the future
 * GET /api/analytics/regime route and the get_regime MCP tool (MCP-02, BOARD-01/02).
 */

import { describe, it, expect } from "vitest";
import { regimeIndicator, regimeResponse } from "./regime.ts";

const validIndicator = {
  id: "vix-term-structure",
  label: "VIX/VIX3M",
  value: 0.87,
  band: "calm",
  bandWarn: 0.9,
  bandCrisis: 0.95,
  asOf: "2026-07-09",
  source: "FRED VIXCLS/VXVCLS",
  rationale: "warn >=0.90, crisis >=0.95 — systemtrader.co backwardation study",
};

// ─── regimeIndicator ────────────────────────────────────────────────────────

describe("regimeIndicator", () => {
  it("parses a well-formed indicator object", () => {
    const result = regimeIndicator.safeParse(validIndicator);
    expect(result.success).toBe(true);
  });

  it("rejects a band outside calm|warning|crisis", () => {
    const result = regimeIndicator.safeParse({ ...validIndicator, band: "panic" });
    expect(result.success).toBe(false);
  });

  it("rejects an asOf with time-of-day (not a date-only string)", () => {
    const result = regimeIndicator.safeParse({
      ...validIndicator,
      asOf: "2026-07-09T14:30:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("parses without inputs (optional field omitted)", () => {
    const result = regimeIndicator.safeParse(validIndicator);
    expect(result.success).toBe(true);
  });

  it("parses with inputs present as a record of string to number", () => {
    const result = regimeIndicator.safeParse({
      ...validIndicator,
      inputs: { vix: 16.2, vix3m: 18.6 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects inputs with a non-number value", () => {
    const result = regimeIndicator.safeParse({
      ...validIndicator,
      inputs: { vix: "16.2" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an indicator missing bandWarn — required, not optional (T-31-04)", () => {
    const { bandWarn: _bandWarn, ...withoutBandWarn } = validIndicator;
    const result = regimeIndicator.safeParse(withoutBandWarn);
    expect(result.success).toBe(false);
  });

  it("rejects an indicator missing bandCrisis — required, not optional (T-31-04)", () => {
    const { bandCrisis: _bandCrisis, ...withoutBandCrisis } = validIndicator;
    const result = regimeIndicator.safeParse(withoutBandCrisis);
    expect(result.success).toBe(false);
  });
});

// ─── regimeResponse ─────────────────────────────────────────────────────────

describe("regimeResponse", () => {
  it("parses an array of indicators", () => {
    const result = regimeResponse.safeParse([validIndicator]);
    expect(result.success).toBe(true);
  });

  it("accepts the empty array (empty board is valid)", () => {
    const result = regimeResponse.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects an array containing a malformed indicator", () => {
    const result = regimeResponse.safeParse([{ ...validIndicator, band: "panic" }]);
    expect(result.success).toBe(false);
  });
});
