/**
 * macro contract tests (Phase 14, Plan 14-01).
 *
 * macroSeriesPoint / macroResponse / macroQuery / MACRO_SERIES_IDS are the single Zod
 * schema source for both GET /api/analytics/macro and the get_macro MCP tool (MCP-02, D-10).
 */

import { describe, it, expect } from "vitest";
import { macroSeriesPoint, macroResponse, macroQuery, MACRO_SERIES_IDS } from "./macro.ts";

// ─── macroSeriesPoint ──────────────────────────────────────────────────────────

describe("macroSeriesPoint", () => {
  it("parses a valid point (round-trip)", () => {
    const parsed = macroSeriesPoint.parse({ time: "2026-04-02", value: 3.83 });
    expect(parsed.time).toBe("2026-04-02");
    expect(parsed.value).toBe(3.83);
  });

  it("rejects a time that is not a YYYY-MM-DD date string", () => {
    const result = macroSeriesPoint.safeParse({ time: "not-a-date", value: 3.83 });
    expect(result.success).toBe(false);
  });

  it("rejects a value that is not a number", () => {
    const result = macroSeriesPoint.safeParse({ time: "2026-04-02", value: "3.83" });
    expect(result.success).toBe(false);
  });
});

// ─── macroResponse ─────────────────────────────────────────────────────────────

describe("macroResponse", () => {
  it("parses a valid map with multiple series", () => {
    const payload = {
      DFF: [{ time: "2026-04-02", value: 3.83 }],
      VVIX: [{ time: "2026-04-02", value: 89.0 }],
    };
    expect(() => macroResponse.parse(payload)).not.toThrow();
  });

  it("parses the empty map (no-data valid case)", () => {
    expect(() => macroResponse.parse({})).not.toThrow();
  });

  it("rejects a map containing a malformed point", () => {
    const result = macroResponse.safeParse({ DFF: [{ time: "bad", value: 3.83 }] });
    expect(result.success).toBe(false);
  });
});

// ─── MACRO_SERIES_IDS ───────────────────────────────────────────────────────────

describe("MACRO_SERIES_IDS", () => {
  it("contains all eight series ids", () => {
    expect(MACRO_SERIES_IDS).toEqual([
      "DFF",
      "DGS1MO",
      "DGS3MO",
      "SOFR",
      "T10Y2Y",
      "T10Y3M",
      "VIXCLS",
      "VVIX",
    ]);
  });
});

// ─── macroQuery ──────────────────────────────────────────────────────────────

describe("macroQuery", () => {
  it("parses an empty object (all params omitted)", () => {
    const result = macroQuery.safeParse({});
    expect(result.success).toBe(true);
  });

  it("coerces a string days param to a number", () => {
    const result = macroQuery.parse({ days: "90" });
    expect(result.days).toBe(90);
  });

  it("rejects days > 1825", () => {
    const result = macroQuery.safeParse({ days: "1826" });
    expect(result.success).toBe(false);
  });

  it("accepts days === 1825 (boundary)", () => {
    const result = macroQuery.safeParse({ days: "1825" });
    expect(result.success).toBe(true);
  });

  it("parses a valid series CSV into a string array", () => {
    const result = macroQuery.parse({ series: "DFF,VVIX" });
    expect(result.series).toEqual(["DFF", "VVIX"]);
  });

  it("rejects a series CSV containing an unknown series id", () => {
    const result = macroQuery.safeParse({ series: "DFF,NOTREAL" });
    expect(result.success).toBe(false);
  });
});
