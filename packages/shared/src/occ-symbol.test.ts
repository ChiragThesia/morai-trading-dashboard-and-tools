import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  parseOccSymbol,
  formatOccSymbol,
  type OccSymbol,
  type OccSymbolParsed,
} from "./occ-symbol.ts";
import { isOk, isErr } from "./result.ts";

// OCC format: RRRRRRYYMMDDCNNNNNNN
//   root: 6 chars (left-aligned, space-padded)  e.g. "SPX   "
//   YYMMDD: 6 digits                             e.g. "260515"
//   C/P: 1 char                                  e.g. "C"
//   strike: 8 digits, strike × 1000              e.g. "07100000" = 7100

const KNOWN_SYMBOL = "SPX   260515C07100000";

describe("parseOccSymbol", () => {
  it("parses a valid SPX call symbol", () => {
    const result = parseOccSymbol(KNOWN_SYMBOL);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.root).toBe("SPX");
      expect(result.value.expiry).toEqual(new Date(2026, 4, 15)); // month is 0-indexed
      expect(result.value.type).toBe("C");
      expect(result.value.strike).toBe(7100);
    }
  });

  it("parses a valid SPXW put symbol", () => {
    const spxwSymbol = "SPXW  260515P07000000";
    const result = parseOccSymbol(spxwSymbol);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.root).toBe("SPXW");
      expect(result.value.type).toBe("P");
      expect(result.value.strike).toBe(7000);
    }
  });

  it("returns err for a string that is too short", () => {
    const result = parseOccSymbol("SPX260515C07100");
    expect(isErr(result)).toBe(true);
  });

  it("returns err for a string with wrong length (too long)", () => {
    const result = parseOccSymbol("SPX   260515C071000000X");
    expect(isErr(result)).toBe(true);
  });

  it("returns err when type char is not C or P", () => {
    const result = parseOccSymbol("SPX   260515X07100000");
    expect(isErr(result)).toBe(true);
  });

  it("returns err when strike has non-numeric chars", () => {
    const result = parseOccSymbol("SPX   260515C0710000X");
    expect(isErr(result)).toBe(true);
  });

  it("returns err when date has non-numeric chars", () => {
    const result = parseOccSymbol("SPX   26051XC07100000");
    expect(isErr(result)).toBe(true);
  });

  it("never throws on malformed input", () => {
    const malformed = ["", "x", "!!!!!!!!!!!!!!!!!!!!!", "  ".repeat(21)];
    for (const s of malformed) {
      expect(() => parseOccSymbol(s)).not.toThrow();
    }
  });
});

describe("formatOccSymbol", () => {
  it("formats a known SPX call to the canonical OCC string", () => {
    const parsed: OccSymbolParsed = {
      root: "SPX",
      expiry: new Date(2026, 4, 15), // 2026-05-15
      type: "C",
      strike: 7100,
    };
    const sym: OccSymbol = formatOccSymbol(parsed);
    expect(sym).toBe(KNOWN_SYMBOL);
  });

  it("pads root to 6 characters with spaces", () => {
    const sym = formatOccSymbol({
      root: "SPX",
      expiry: new Date(2026, 4, 15),
      type: "C",
      strike: 7100,
    });
    expect(sym.slice(0, 6)).toBe("SPX   ");
  });

  it("encodes strike as integer × 1000 zero-padded to 8 digits", () => {
    const sym = formatOccSymbol({
      root: "SPX",
      expiry: new Date(2026, 4, 15),
      type: "C",
      strike: 7100,
    });
    expect(sym.slice(13)).toBe("07100000");
  });
});

describe("OccSymbol round-trip (example)", () => {
  it("parse → format → parse produces identical result", () => {
    const first = parseOccSymbol(KNOWN_SYMBOL);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    const formatted = formatOccSymbol(first.value);
    const second = parseOccSymbol(formatted);
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;

    expect(second.value).toEqual(first.value);
  });
});

describe("OccSymbol round-trip (fast-check property)", () => {
  it("parse(format(x)) deep-equals x for valid generated inputs", () => {
    // Roots: SPX (3 chars) and SPXW (4 chars) — the only roots this system handles
    const rootArb = fc.constantFrom("SPX", "SPXW");

    // Expiry: date in range 2025-01-01 to 2027-12-31 (realistic options range)
    // Use year 2025-2027 to keep 2-digit year in range.
    // fc.date() can produce Invalid Date (NaN) even with bounds — filter those out.
    const expiryArb = fc
      .date({
        min: new Date(2025, 0, 1),
        max: new Date(2027, 11, 31),
      })
      .filter((d) => !Number.isNaN(d.getTime()));

    const typeArb = fc.constantFrom("C" as const, "P" as const);

    // Strike: positive integer, max 9999 (fits in 8 digits when ×1000 = max 9999000)
    // Must be a positive integer (no fractional strikes for SPX)
    const strikeArb = fc.integer({ min: 1, max: 9999 });

    fc.assert(
      fc.property(rootArb, expiryArb, typeArb, strikeArb, (root, expiry, type, strike) => {
        const input: OccSymbolParsed = { root, expiry, type, strike };
        const formatted = formatOccSymbol(input);
        const parsed = parseOccSymbol(formatted);

        if (!isOk(parsed)) {
          // If parsing fails, the property test fails with context
          throw new Error(
            `Failed to parse formatted symbol "${formatted}" for input ${JSON.stringify({ root, expiry: expiry.toISOString(), type, strike })}: ${JSON.stringify(parsed.error)}`,
          );
        }

        // Deep equality check on all fields
        // Date equality: compare year/month/day (ignore time)
        const parsedExpiry = parsed.value.expiry;
        const inputExpiry = expiry;
        const datesMatch =
          parsedExpiry.getFullYear() === inputExpiry.getFullYear() &&
          parsedExpiry.getMonth() === inputExpiry.getMonth() &&
          parsedExpiry.getDate() === inputExpiry.getDate();

        return (
          parsed.value.root === root &&
          datesMatch &&
          parsed.value.type === type &&
          parsed.value.strike === strike
        );
      }),
      { numRuns: 200 },
    );
  });
});
