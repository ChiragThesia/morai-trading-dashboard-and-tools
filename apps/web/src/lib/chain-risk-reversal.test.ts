/**
 * chain-risk-reversal.test.ts — the 25-delta risk reversal for one expiry.
 *
 * RR is the skew number a vol trader reads first: IV of the 25Δ put minus IV of
 * the 25Δ call. It is reported, never scored, and it is null whenever the chain
 * does not actually contain both wings near 25 delta.
 */
import { describe, it, expect } from "vitest";
import { riskReversalForExpiry, RR_DELTA_TOLERANCE } from "./chain-risk-reversal.ts";
import { legGreeks } from "./chain-math.ts";
import type { ChainRow } from "./chain-contract.ts";

function row(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6500_000,
    expiration: "2026-08-21",
    contractType: "P",
    dte: 30,
    bsmIv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 100,
    underlyingPrice: 6500,
    source: "schwab",
    observedAt: "2026-07-26T18:00:00.000Z",
    ...over,
  };
}

/** A strike ladder wide enough to bracket both 25Δ wings. */
function ladder(): ReadonlyArray<ChainRow> {
  const out: ChainRow[] = [];
  for (let k = 5800; k <= 7200; k += 25) {
    // A downward-sloping smile: lower strikes carry more IV.
    const iv = 0.2 - (k - 5800) * 0.00004;
    out.push(row({ strike: k * 1000, bsmIv: iv, contractType: "P" }));
    out.push(row({ strike: k * 1000, bsmIv: iv - 0.01, contractType: "C" }));
  }
  return out;
}

describe("riskReversalForExpiry", () => {
  it("is put IV minus call IV at the strikes nearest 25 delta", () => {
    const rows = ladder();
    const rr = riskReversalForExpiry(rows);
    expect(rr).not.toBeNull();

    // Recompute by hand: find each wing independently and difference the IVs.
    const nearest = (type: "C" | "P"): ChainRow | undefined => {
      let best: ChainRow | undefined;
      let bestErr = Number.POSITIVE_INFINITY;
      for (const r of rows) {
        if (r.contractType !== type) continue;
        const g = legGreeks(r);
        if (g === null) continue;
        const err = Math.abs(Math.abs(g.delta) - 0.25);
        if (err < bestErr) {
          bestErr = err;
          best = r;
        }
      }
      return best;
    };
    const put = nearest("P");
    const call = nearest("C");
    expect(put).toBeDefined();
    expect(call).toBeDefined();
    if (put?.bsmIv == null || call?.bsmIv == null) return;
    expect(rr).toBeCloseTo(put.bsmIv - call.bsmIv, 12);
  });

  it("is positive when puts are bid over calls (the normal index smile)", () => {
    const rr = riskReversalForExpiry(ladder());
    expect(rr).not.toBeNull();
    if (rr === null) return;
    expect(rr).toBeGreaterThan(0);
  });

  it("is null when one wing is missing entirely", () => {
    const putsOnly = ladder().filter((r) => r.contractType === "P");
    expect(riskReversalForExpiry(putsOnly)).toBeNull();
  });

  it("is null when no strike lands within tolerance of 25 delta", () => {
    // Two deep-ITM strikes only — nothing near 25Δ.
    const rows = [
      row({ strike: 7200_000, contractType: "P", bsmIv: 0.15 }),
      row({ strike: 5000_000, contractType: "C", bsmIv: 0.15 }),
    ];
    expect(riskReversalForExpiry(rows)).toBeNull();
  });

  it("is null on an empty chain", () => {
    expect(riskReversalForExpiry([])).toBeNull();
  });

  it("ignores rows with no IV rather than treating them as 0", () => {
    const rows = ladder().map((r) => (r.strike === 6500_000 ? { ...r, bsmIv: null } : r));
    expect(riskReversalForExpiry(rows)).not.toBeNull();
  });

  it("exposes the delta tolerance it enforces", () => {
    expect(RR_DELTA_TOLERANCE).toBeGreaterThan(0);
    expect(RR_DELTA_TOLERANCE).toBeLessThan(0.25);
  });
});
