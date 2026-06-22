import { describe, it, expect } from "vitest";
import { parseSchwabSymbol } from "./schwab-symbol.ts";
import { formatOccSymbol } from "@morai/shared";

describe("parseSchwabSymbol", () => {
  it("parses a valid SPX put symbol", () => {
    // Schwab format: root left-padded to 6, YYMMDD, C/P, 8-digit strike×1000
    // "SPX   250620P07100000" (note: 3 spaces to pad SPX to 6)
    const result = parseSchwabSymbol("SPX   250620P07100000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBe("SPX");
    expect(result.value.type).toBe("P");
    expect(result.value.strike).toBe(7100);
    expect(result.value.expiry.getFullYear()).toBe(2025);
    expect(result.value.expiry.getMonth()).toBe(5); // June = 5
    expect(result.value.expiry.getDate()).toBe(20);
  });

  it("parses a valid SPX call symbol", () => {
    const result = parseSchwabSymbol("SPX   260611C07275000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBe("SPX");
    expect(result.value.type).toBe("C");
    expect(result.value.strike).toBe(7275);
  });

  it("produces a 21-char OCC symbol via formatOccSymbol", () => {
    const result = parseSchwabSymbol("SPX   250620P07100000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const occ = formatOccSymbol(result.value);
    expect(occ).toHaveLength(21);
    // OCC format: "SPX   250620P07100000"
    expect(occ).toBe("SPX   250620P07100000");
  });

  it("parses SPXW symbol", () => {
    // SPXW padded to 6: "SPXW  "
    const result = parseSchwabSymbol("SPXW  260611C07275000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBe("SPXW");
    expect(result.value.type).toBe("C");
    expect(result.value.strike).toBe(7275);
  });

  it("returns err for a symbol that is too short", () => {
    const result = parseSchwabSymbol("SHORT");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err for an invalid type character", () => {
    // 'X' in place of C/P
    const result = parseSchwabSymbol("SPX   250620X07100000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err for non-numeric date", () => {
    const result = parseSchwabSymbol("SPX   ZZZZZZP07100000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns err for invalid/zero strike", () => {
    const result = parseSchwabSymbol("SPX   250620P00000000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("never throws — always returns Result", () => {
    // Garbage input
    const result = parseSchwabSymbol("!!!!!!!!!!!!!!!!!!!!!");
    expect(result.ok).toBe(false);
  });
});
