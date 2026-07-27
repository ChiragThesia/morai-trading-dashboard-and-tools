/**
 * chain-risk-reversal.test.ts — TDD suite for riskReversalForExpiry
 *
 * The 25Δ risk-reversal formula itself is NOT under test here — it ships in
 * `packages/core/src/analytics/domain/risk-reversal.ts` and has its own property suite.
 * What IS under test is the ADAPTER: chain rows carry `bsmIv` but no delta, so this
 * module must compute delta per row (×1000 strike → index points, dte → 365.25-day-year
 * T) and hand the resulting smile to the core interpolator unchanged.
 *
 * The two failure modes worth pinning:
 *   1. Unit slips — forgetting the ×1000 strike divide or the 365.25 divisor silently
 *      produces deltas that never bracket ±0.25 (→ always null), or the wrong ones.
 *      Test 2 is an exact-equality oracle against the core function on the same smile.
 *   2. Fabricating a wing — the chain read is puts-only until the sibling widening lands,
 *      and a missing `bsmIv` must be dropped, never defaulted (T-17-01 "never DEFAULT_IV").
 *      Tests 3-6 pin null-out, not number-out.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import { interpolateRiskReversal } from "@morai/core";
import type { SmileQuote } from "@morai/core";
import { riskReversalForExpiry, type ChainSmileRow } from "./chain-risk-reversal.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const R = 0.045; // risk-free rate (decimal)
const Q = 0.013; // continuous dividend yield (D-01)
const DAYS_PER_YEAR = 365.25; // D-04 basis
const EXPIRY = "2026-09-18";
const OTHER_EXPIRY = "2026-10-16";
const SPOT = 6000;
const DTE = 30;
/** The default fixture root. SPX vs SPXW quote the same strikes, so root scopes the smile. */
const ROOT = "SPXW" as const;

/** 5400…6600 in 25-point steps — a dense near-the-money grid, both ±25Δ well inside. */
const GRID: ReadonlyArray<number> = Array.from({ length: 49 }, (_, i) => 5400 + i * 25);

function makeRow(
  strikePoints: number,
  contractType: "C" | "P",
  bsmIv: number | null,
  overrides: Partial<ChainSmileRow> = {},
): ChainSmileRow {
  return {
    strike: Math.round(strikePoints * 1000), // ×1000 int convention
    expiration: EXPIRY,
    contractType,
    root: ROOT,
    dte: DTE,
    bsmIv,
    underlyingPrice: SPOT,
    ...overrides,
  };
}

/** A full both-wing chain: every strike carries a call and a put. */
function makeChain(
  strikes: ReadonlyArray<number>,
  ivFor: (strikePoints: number, contractType: "C" | "P") => number | null,
  overrides: Partial<ChainSmileRow> = {},
): ChainSmileRow[] {
  return strikes.flatMap((k) => [
    makeRow(k, "P", ivFor(k, "P"), overrides),
    makeRow(k, "C", ivFor(k, "C"), overrides),
  ]);
}

const flatIv = (): number => 0.2;

/** Classic equity put skew: IV falls monotonically as strike rises. */
const skewIv = (strikePoints: number): number => 0.2 + 0.35 * ((SPOT - strikePoints) / SPOT);

// ─── Example tests ───────────────────────────────────────────────────────────

describe("riskReversalForExpiry", () => {
  it("returns ~0 for a flat smile (both wings interpolate the same level)", () => {
    const rr = riskReversalForExpiry(makeChain(GRID, flatIv), EXPIRY, R, Q, ROOT);
    expect(rr).not.toBeNull();
    expect(rr ?? Number.NaN).toBeCloseTo(0, 12);
  });

  it("matches the core interpolator exactly (pins ×1000 strike and 365.25-day T)", () => {
    const rows = makeChain(GRID, skewIv);

    // Oracle: build the same smile by hand, in the units the core function expects.
    const oracle: ReadonlyArray<SmileQuote> = rows.map((row) => {
      const iv = row.bsmIv ?? Number.NaN;
      return {
        underlying: "SPX",
        expiration: row.expiration,
        strike: row.strike,
        iv,
        delta: bsmGreeks(SPOT, row.strike / 1000, DTE / DAYS_PER_YEAR, iv, R, Q, row.contractType)
          .delta,
        moneyness: null,
      };
    });
    const expected = interpolateRiskReversal(oracle);
    expect(expected).not.toBeNull();
    expect(expected ?? Number.NaN).toBeGreaterThan(0); // put skew ⇒ positive risk-reversal

    expect(riskReversalForExpiry(rows, EXPIRY, R, Q, ROOT)).toBe(expected);
  });

  it("returns null when the chain is puts-only (call wing absent)", () => {
    const puts = makeChain(GRID, skewIv).filter((row) => row.contractType === "P");
    expect(riskReversalForExpiry(puts, EXPIRY, R, Q, ROOT)).toBeNull();
  });

  it("returns null when the chain is calls-only (put wing absent)", () => {
    const calls = makeChain(GRID, skewIv).filter((row) => row.contractType === "C");
    expect(riskReversalForExpiry(calls, EXPIRY, R, Q, ROOT)).toBeNull();
  });

  it("returns null when a whole wing has no bsmIv — never substitutes a default", () => {
    const rows = makeChain(GRID, (k, type) => (type === "C" ? null : skewIv(k)));
    expect(riskReversalForExpiry(rows, EXPIRY, R, Q, ROOT)).toBeNull();
  });

  it("drops individual bsmIv-null rows rather than defaulting them", () => {
    const isEdge = (k: number): boolean => k <= 5500 || k >= 6500;
    const withNulls = makeChain(GRID, (k) => (isEdge(k) ? null : skewIv(k)));
    const withoutRows = makeChain(
      GRID.filter((k) => !isEdge(k)),
      skewIv,
    );

    const rr = riskReversalForExpiry(withNulls, EXPIRY, R, Q, ROOT);
    expect(rr).not.toBeNull();
    expect(rr).toBe(riskReversalForExpiry(withoutRows, EXPIRY, R, Q, ROOT));
  });

  it("only reads rows for the requested expiration", () => {
    const asked = makeChain(GRID, skewIv).filter((row) => row.contractType === "P");
    const other = makeChain(GRID, skewIv, { expiration: OTHER_EXPIRY });
    const mixed = [...asked, ...other];

    // The asked-for expiration is puts-only — the other expiration's calls must not leak in.
    expect(riskReversalForExpiry(mixed, EXPIRY, R, Q, ROOT)).toBeNull();
    expect(riskReversalForExpiry(mixed, OTHER_EXPIRY, R, Q, ROOT)).not.toBeNull();
  });

  // REGRESSION (prod, 2026-07-26). SPX and SPXW quote the SAME strike on the SAME date, so an
  // expiration-only filter builds ONE smile out of TWO books. Nothing nulls: the interpolator
  // gets two IVs per delta and walks a jagged mixture, returning a clean plausible wrong number.
  // Same class as the cross-wing ATM — so root is a PARAMETER, not a caller convention.
  it("only reads rows for the requested root — the twin's book is not part of the smile", () => {
    // SPXW carries the real skew. SPX carries a wildly different level, so any leakage moves
    // the headline by vol POINTS, not decimals. Differing levels are load-bearing: with equal
    // IVs this test would pass whether or not root is respected.
    const spxw = makeChain(GRID, skewIv);
    const spx = makeChain(GRID, (k, t) => (skewIv(k) ?? 0) + (t === "P" ? 0.5 : -0.5), {
      root: "SPX",
    });
    const mixed = [...spxw, ...spx];

    const clean = riskReversalForExpiry(spxw, EXPIRY, R, Q, "SPXW");
    expect(clean).not.toBeNull();
    // Reading the mixed book gives the SAME answer as reading SPXW alone, in either array order.
    // MEASURED CAVEAT: deleting the root filter leaves these two assertions GREEN — the core
    // interpolator takes the TIGHTEST bracket around ±0.25Δ, and on this fixture the SPX points
    // never win that bracket. They are an invariance check, not the teeth.
    expect(riskReversalForExpiry(mixed, EXPIRY, R, Q, "SPXW")).toBe(clean);
    expect(riskReversalForExpiry([...spx, ...spxw], EXPIRY, R, Q, "SPXW")).toBe(clean);
    // THESE are the teeth — both fail when the root filter is deleted (verified by deleting it):
    // SPX's own book must be a reachable, DIFFERENT number, not a copy of its twin's.
    expect(riskReversalForExpiry(mixed, EXPIRY, R, Q, "SPX")).not.toBe(clean);
  });

  it("returns null when the requested root has no rows in that expiration", () => {
    expect(riskReversalForExpiry(makeChain(GRID, skewIv), EXPIRY, R, Q, "SPX")).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(riskReversalForExpiry([], EXPIRY, R, Q, ROOT)).toBeNull();
  });

  it("returns null at or past expiry — T=0 delta is a step, not interpolable", () => {
    expect(riskReversalForExpiry(makeChain(GRID, skewIv, { dte: 0 }), EXPIRY, R, Q, ROOT)).toBeNull();
    expect(riskReversalForExpiry(makeChain(GRID, skewIv, { dte: -1 }), EXPIRY, R, Q, ROOT)).toBeNull();
  });

  // ─── Property tests ────────────────────────────────────────────────────────

  /**
   * Build a both-wing chain whose strike step scales with the smaller wing's σ√T, so the
   * ±25Δ targets are always bracketed by an adjacent pair well inside MAX_BRACKET_WIDTH.
   * Each wing carries a single flat IV level, so its interpolated 25Δ vol IS that level.
   */
  function twoLevelChain(
    spot: number,
    dte: number,
    ivPut: number,
    ivCall: number,
  ): ChainSmileRow[] {
    const step = 0.25 * Math.min(ivPut, ivCall) * Math.sqrt(dte / DAYS_PER_YEAR) * spot;
    const rows: ChainSmileRow[] = [];
    for (let k = -40; k <= 40; k += 1) {
      const strikePoints = spot + k * step;
      if (strikePoints <= 0) continue;
      const base = {
        strike: Math.round(strikePoints * 1000),
        expiration: EXPIRY,
        root: ROOT,
        dte,
        underlyingPrice: spot,
      };
      rows.push({ ...base, contractType: "P", bsmIv: ivPut });
      rows.push({ ...base, contractType: "C", bsmIv: ivCall });
    }
    return rows;
  }

  const arbSpot = fc.double({ min: 3000, max: 8000, noNaN: true });
  const arbDte = fc.integer({ min: 7, max: 120 });
  const arbIv = fc.double({ min: 0.1, max: 0.4, noNaN: true });

  it("property: never returns NaN or Infinity, whatever the rows carry", () => {
    const arbRow: fc.Arbitrary<ChainSmileRow> = fc.record({
      strike: fc.integer({ min: 0, max: 12_000_000 }),
      expiration: fc.constantFrom(EXPIRY, OTHER_EXPIRY),
      contractType: fc.boolean().map((b): "C" | "P" => (b ? "C" : "P")),
      // Both roots, so the never-NaN property also covers a chain carrying two books at once.
      root: fc.constantFrom<"SPX" | "SPXW">("SPX", "SPXW"),
      dte: fc.integer({ min: -5, max: 400 }),
      bsmIv: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: null }),
      underlyingPrice: fc.double({ min: 0, max: 12_000, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(arbRow, { maxLength: 60 }),
        fc.double({ min: -0.05, max: 0.2, noNaN: true }),
        fc.double({ min: -0.05, max: 0.2, noNaN: true }),
        (rows, r, q) => {
          const rr = riskReversalForExpiry(rows, EXPIRY, r, q, ROOT);
          expect(rr === null || Number.isFinite(rr)).toBe(true);
        },
      ),
    );
  });

  it("property: a two-level smile prices at exactly (put-wing IV − call-wing IV)", () => {
    fc.assert(
      fc.property(arbSpot, arbDte, arbIv, arbIv, (spot, dte, ivPut, ivCall) => {
        const rr = riskReversalForExpiry(twoLevelChain(spot, dte, ivPut, ivCall), EXPIRY, R, Q, ROOT);
        // Non-vacuous: this grid always brackets, so a null here is a real failure.
        expect(rr).not.toBeNull();
        expect(rr ?? Number.NaN).toBeCloseTo(ivPut - ivCall, 12);
      }),
    );
  });

  it("property: stripping the call wing always yields null", () => {
    fc.assert(
      fc.property(arbSpot, arbDte, arbIv, arbIv, (spot, dte, ivPut, ivCall) => {
        const puts = twoLevelChain(spot, dte, ivPut, ivCall).filter((r) => r.contractType === "P");
        expect(riskReversalForExpiry(puts, EXPIRY, R, Q, ROOT)).toBeNull();
      }),
    );
  });
});
