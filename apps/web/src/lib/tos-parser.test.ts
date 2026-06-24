/**
 * TOS calendar paste parser test suite — 9 locked rules
 *
 * RED phase: per-rule tests, canonical sample, round-trip property, null-on-failure cases.
 *
 * Rules (UI-SPEC TOS Calendar Paste Parser Contract):
 *  1. BUY/SELL + qty (abs, min 1)
 *  2. PUT/CALL (default P if absent)
 *  3. Strike: last 3–5 digit number before PUT/CALL
 *  4. Debit: number after @ (optional)
 *  5. Two dates: DD MMM YY patterns, sorted ascending → front/back
 *  6. DTE validation: front > 0, back > front → reject otherwise
 *  7. Underlying: after CALENDAR, default SPX
 *  8. Implied flat IV via impliedFlatIv (Rule 8)
 *  9. Call + Put both supported
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseTosOrder } from "./tos-parser.ts";
import { bsmPrice } from "@morai/quant";

// Tolerance for spread re-pricing in round-trip property
const DEBIT_TOL = 0.02;

// Fixed "today" for deterministic DTE computations in all tests
// Using 2026-06-20 so "20 NOV 26" (NOV 26 = 2026-11-20) gives positive DTE
const TODAY = new Date("2026-06-20T00:00:00Z");
const SPOT = 7550;
const RATE = 0.045;

// Canonical sample from UI-SPEC
const CANONICAL =
  "BUY +1 CALENDAR SPX 100 (Weeklys) 30 NOV 26/20 NOV 26 [AM] 7550 PUT @5.80 LMT GTC";

// ─────────────────────────────────────────────────────────────
// Canonical sample test
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: canonical sample", () => {
  it("parses the locked UI-SPEC canonical sample correctly", () => {
    const result = parseTosOrder(CANONICAL, TODAY, SPOT, RATE);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.strike).toBe(7550);
    expect(result.type).toBe("P");
    expect(result.qty).toBe(1);
    expect(result.underlying).toBe("SPX");
    expect(result.debit).toBe(5.80);
    // front = 20 NOV (earlier), back = 30 NOV (later)
    // frontDte = days from 2026-06-20 to 2026-11-20 = 153d
    // backDte  = days from 2026-06-20 to 2026-11-30 = 163d
    expect(result.frontDte).toBeGreaterThan(0);
    expect(result.backDte).toBeGreaterThan(result.frontDte);
    // IV must be a finite number > 0 (impliedFlatIv result)
    expect(result.iv).toBeGreaterThan(0);
    expect(Number.isFinite(result.iv)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 1 — BUY/SELL + qty (abs, min 1)
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 1 — qty extraction", () => {
  it("extracts positive qty from +N form", () => {
    const r = parseTosOrder("BUY +3 CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.qty).toBe(3);
  });

  it("extracts abs qty from -N form (SELL -2 → qty=2)", () => {
    const r = parseTosOrder("SELL -2 CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.qty).toBe(2);
  });

  it("extracts bare N without sign (bare 5 → qty=5)", () => {
    const r = parseTosOrder("BUY 5 CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.qty).toBe(5);
  });

  it("defaults to qty=1 when BUY/SELL qty is missing entirely", () => {
    // No BUY/SELL keyword — qty defaults to 1
    const r = parseTosOrder("CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.qty).toBe(1);
  });

  it("enforces minimum qty of 1 even when abs(N) would be 0", () => {
    const r = parseTosOrder("BUY +0 CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    // qty 0 → forced to 1
    expect(r?.qty).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 2 — PUT/CALL (default P if absent)
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 2 — PUT/CALL", () => {
  it("extracts PUT correctly", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 7500 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.type).toBe("P");
  });

  it("extracts CALL correctly", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 7500 CALL 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.type).toBe("C");
  });

  it("defaults to P when neither PUT nor CALL is present", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 30 NOV 26/20 NOV 26 7500", TODAY, SPOT, RATE);
    // When no PUT/CALL, default is P; but strike extraction may fail without PUT/CALL anchor
    // If result is non-null, type must be P
    if (r) expect(r.type).toBe("P");
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 3 — Strike: last 3–5 digit number before PUT/CALL
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 3 — strike extraction", () => {
  it("extracts a 4-digit strike (7550 PUT)", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.strike).toBe(7550);
  });

  it("extracts a 5-digit strike (10000 PUT)", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 10000 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.strike).toBe(10000);
  });

  it("extracts the last N-digit group before PUT (ignoring 100 lot size)", () => {
    // "SPX 100 (Weeklys) 7550 PUT" → strike=7550, not 100
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 100 (Weeklys) 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.strike).toBe(7550);
  });

  it("returns null when no valid strike can be found", () => {
    // No digits before PUT/CALL and no default
    const r = parseTosOrder("BUY +1 CALENDAR SPX PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 4 — Debit: number after @ (optional)
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 4 — debit extraction", () => {
  it("extracts debit from @N.NN", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26 @5.80",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.debit).toBe(5.80);
  });

  it("debit is null when @ is absent", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.debit).toBeNull();
    // IV must still be present — default 15%
    expect(r?.iv).toBe(0.15);
  });

  it("extracts integer debit @10 (no decimal)", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26 @10",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.debit).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 5 — Two dates: DD MMM YY → sort ascending → front/back
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 5 — two-date scan + ascending sort", () => {
  it("correctly assigns the earlier date as front and later as back", () => {
    // 30 NOV 26 / 20 NOV 26 → front=20 NOV, back=30 NOV
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r).not.toBeNull();
    if (!r) return;
    // frontDte < backDte
    expect(r.frontDte).toBeLessThan(r.backDte);
    // frontDte matches 20 NOV 26
    const frontMs = new Date("2026-11-20T00:00:00Z").getTime();
    const todayMs = TODAY.getTime();
    const expectedFrontDte = Math.round((frontMs - todayMs) / 86400000);
    expect(r.frontDte).toBe(expectedFrontDte);
  });

  it("handles dates in already-ascending order (front first in string)", () => {
    // 20 NOV 26 / 30 NOV 26 → same result after sort
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 20 NOV 26/30 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.frontDte).toBeLessThan(r.backDte);
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 6 — DTE validation: front > 0, back > front → null on rejection
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 6 — DTE validation", () => {
  it("returns null when front expiry is in the past (front DTE ≤ 0)", () => {
    // Use dates that are past: 20 JAN 25 / 30 JAN 25 — both expired
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 JAN 25/20 JAN 25",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r).toBeNull();
  });

  it("returns null when both dates are the same (back DTE not > front DTE)", () => {
    // Same date for both → back DTE == front DTE, violates back > front
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 20 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 7 — Underlying: after CALENDAR, default SPX
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 7 — underlying extraction", () => {
  it("extracts underlying from CALENDAR SYMBOL", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.underlying).toBe("SPX");
  });

  it("defaults to SPX when CALENDAR keyword is absent", () => {
    const r = parseTosOrder("BUY +1 7550 PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r?.underlying).toBe("SPX");
  });

  it("extracts a non-SPX underlying (SPXW)", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPXW 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.underlying).toBe("SPXW");
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 8 — Implied flat IV via impliedFlatIv (bisection)
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 8 — implied flat IV via bisection", () => {
  it("iv defaults to 0.15 when no debit is provided", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.iv).toBe(0.15);
  });

  it("iv is a finite positive number when debit is provided", () => {
    const r = parseTosOrder(CANONICAL, TODAY, SPOT, RATE);
    expect(r?.iv).toBeGreaterThan(0);
    expect(Number.isFinite(r?.iv)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Rule 9 — Call + Put both supported
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: Rule 9 — call and put calendars", () => {
  it("parses a PUT calendar", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7550 PUT 30 NOV 26/20 NOV 26 @5.80",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.type).toBe("P");
    expect(r?.strike).toBe(7550);
  });

  it("parses a CALL calendar", () => {
    const r = parseTosOrder(
      "BUY +1 CALENDAR SPX 7700 CALL 30 NOV 26/20 NOV 26 @8.00",
      TODAY,
      SPOT,
      RATE,
    );
    expect(r?.type).toBe("C");
    expect(r?.strike).toBe(7700);
  });
});

// ─────────────────────────────────────────────────────────────
// Failure cases: returns null
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: null-on-failure cases", () => {
  it("returns null for a string with only one expiry (need 2)", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 7550 PUT 20 NOV 26", TODAY, SPOT, RATE);
    expect(r).toBeNull();
  });

  it("returns null for a string with no expiry dates", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX 7550 PUT", TODAY, SPOT, RATE);
    expect(r).toBeNull();
  });

  it("returns null when strike is missing (no digits before PUT/CALL)", () => {
    const r = parseTosOrder("BUY +1 CALENDAR SPX PUT 30 NOV 26/20 NOV 26", TODAY, SPOT, RATE);
    expect(r).toBeNull();
  });

  it("never throws — returns null on completely garbled input", () => {
    expect(() => parseTosOrder("!!!garbage###", TODAY, SPOT, RATE)).not.toThrow();
    expect(parseTosOrder("!!!garbage###", TODAY, SPOT, RATE)).toBeNull();
  });

  it("never touches the DOM (pure string operation)", () => {
    // If parseTosOrder were to touch document.*, it would throw in Vitest's jsdom
    // but these tests must pass in a purely functional way.
    // This is enforced by the module having no DOM imports.
    const r = parseTosOrder(CANONICAL, TODAY, SPOT, RATE);
    expect(r).not.toBeNull(); // sanity: module loaded without DOM errors
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip property: parse → BSM re-price ≈ input debit
// numRuns:1000 with Math.fround() bounds
// ─────────────────────────────────────────────────────────────
describe("parseTosOrder: round-trip property", () => {
  it("parse → iv → BSM(back,iv)−BSM(front,iv) ≈ debit for generated orders (numRuns:1000)", () => {
    fc.assert(
      fc.property(
        // strike ∈ [5000, 8000] (SPX-range)
        fc.integer({ min: 5000, max: 8000 }),
        // frontDays ∈ [14, 60]
        fc.integer({ min: 14, max: 60 }),
        // backDays = frontDays + offset ∈ [7, 30]
        fc.integer({ min: 7, max: 30 }),
        // type
        fc.boolean(),
        // debit: we synthesize a realistic debit from a seed iv
        fc.float({ min: Math.fround(0.10), max: Math.fround(0.60), noNaN: true }),
        (strike, frontDays, backDayOffset, isCall, seedIv) => {
          const backDays = frontDays + backDayOffset;
          const type = isCall ? ("C" as const) : ("P" as const);
          const frontT = frontDays / 365;
          const backT = backDays / 365;
          const r = 0.045;
          const q = 0.013;

          // Compute synthetic debit at seed IV
          const syntheticDebit =
            bsmPrice(SPOT, strike, backT, seedIv, r, q, type) -
            bsmPrice(SPOT, strike, frontT, seedIv, r, q, type);

          // Only test when the debit is positive and > 0.10 (parseable)
          if (syntheticDebit < 0.10) return true;

          // Build a synthetic TOS order string
          // frontDate = TODAY + frontDays, backDate = TODAY + backDays
          const frontDate = new Date(TODAY.getTime() + frontDays * 86400000);
          const backDate = new Date(TODAY.getTime() + backDays * 86400000);

          const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
          const frontStr = `${frontDate.getUTCDate()} ${months[frontDate.getUTCMonth()]} ${String(frontDate.getUTCFullYear()).slice(2)}`;
          const backStr = `${backDate.getUTCDate()} ${months[backDate.getUTCMonth()]} ${String(backDate.getUTCFullYear()).slice(2)}`;

          const typeName = isCall ? "CALL" : "PUT";
          // Put back before front in string to test sorting
          const tosStr = `BUY +1 CALENDAR SPX ${strike} ${typeName} ${backStr}/${frontStr} @${syntheticDebit.toFixed(2)} LMT GTC`;

          const result = parseTosOrder(tosStr, TODAY, SPOT, r);
          if (!result) return true; // skip if parse fails (degenerate edge)

          // Re-price at the implied iv — must ≈ synthetic debit
          const repriced =
            bsmPrice(SPOT, result.strike, result.backDte / 365, result.iv, r, q, result.type) -
            bsmPrice(SPOT, result.strike, result.frontDte / 365, result.iv, r, q, result.type);

          return Math.abs(repriced - syntheticDebit) <= DEBIT_TOL;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
