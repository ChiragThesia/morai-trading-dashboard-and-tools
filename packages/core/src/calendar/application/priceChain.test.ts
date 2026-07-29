/**
 * priceChain.test.ts — the per-strike chain surface's read, its LADDER, its wing and its
 * degradations.
 *
 * The greeks, the ATM reference and the forward-vol identity are pinned in `domain/` — this file
 * does not restate them. What it owns is `toView`: the shape the use-case assembles out of a
 * cohort, which is the only thing between the domain and the wire.
 *
 * That ladder block was previously covered by a differential test against the browser copy of
 * these formulas (`apps/server/src/adapters/chain-surface-differential.test.ts`). The browser copy
 * is gone — `useChainModel` reads this surface — so the differential test went with it and its
 * ladder assertions moved here.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makePriceChainUseCase } from "./priceChain.ts";
import type { PriceChainDeps } from "./priceChain.ts";
import type { CalendarChainQuote, Carry } from "../domain/types.ts";

const NOW = new Date("2026-07-28T15:30:00.000Z");
const FLAT: Carry = { rate: 0.045, divYield: 0.013 };

function quote(over: Partial<CalendarChainQuote> = {}): CalendarChainQuote {
  return {
    time: NOW,
    strike: 7_400_000,
    expiration: "2026-08-14",
    contractType: "P",
    underlyingPrice: 7401.89,
    bsmIv: "0.1620",
    root: "SPXW",
    bid: 48.6,
    ask: 50.2,
    openInterest: 2417,
    source: "cboe",
    ...over,
  };
}

function deps(over: Partial<PriceChainDeps> = {}): PriceChainDeps {
  return {
    readChain: () => Promise.resolve(ok([quote()])),
    now: () => NOW,
    carry: FLAT,
    ...over,
  };
}

describe("priceChain — the chain read is critical", () => {
  it("propagates a read failure instead of returning an empty chain", async () => {
    // An empty surface and a broken read look identical on screen, and one of them means the
    // reader is looking at a chain that exists. The failure has to reach the adapter.
    const result = await makePriceChainUseCase(
      deps({ readChain: () => Promise.resolve(err({ kind: "storage-error", message: "down" })) }),
    )({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("down");
  });

  it("turns a throwing repo into a Result, never an exception", async () => {
    const result = await makePriceChainUseCase(
      deps({ readChain: () => Promise.reject(new Error("socket hang up")) }),
    )({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
    expect(result.error.message).toBe("socket hang up");
  });
});

describe("priceChain — the wing", () => {
  it("prices puts when the caller does not ask", async () => {
    const result = await makePriceChainUseCase(deps())({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contractType).toBe("P");
    expect(result.value.cohorts[0]?.strikes).toHaveLength(1);
  });

  it("prices the wing it was asked for, and only that wing", async () => {
    const rows = [quote(), quote({ contractType: "C", strike: 7_350_000, bsmIv: "0.1412" })];
    const result = await makePriceChainUseCase(deps({ readChain: () => Promise.resolve(ok(rows)) }))(
      { contractType: "C" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contractType).toBe("C");
    expect(result.value.cohorts[0]?.strikes.map((r) => r.strike)).toEqual([7350]);
  });
});

describe("priceChain — the strike ladder", () => {
  /** 7350 and 7400 solve; 7425 is quoted and never solved. Spot 7401.89 puts the ATM at 7400. */
  const LADDER = [
    quote({ strike: 7_425_000, bsmIv: null, bid: 58.0, ask: 60.5, openInterest: 66 }),
    quote({ strike: 7_350_000, bsmIv: "0.1724", bid: 33.1, ask: 34.9, openInterest: 1290 }),
    quote(),
  ];

  async function ladder(rows: ReadonlyArray<CalendarChainQuote> = LADDER) {
    const result = await makePriceChainUseCase(deps({ readChain: () => Promise.resolve(ok(rows)) }))(
      {},
    );
    if (!result.ok) throw new Error(result.error.message);
    const cohort = result.value.cohorts[0];
    if (cohort === undefined) throw new Error("no cohort");
    return cohort;
  }

  it("unions the priced legs with the quoted-but-unpriced ones, ascending by strike", async () => {
    // The union IS the surface's contract. Dropping the unpriced strike would be a hidden filter
    // on a screen whose whole purpose is to hide nothing — and it was silent on 24.4% of the live
    // put wing (the null + 'NaN' share measured 2026-07-28).
    const cohort = await ladder();
    expect(cohort.strikes.map((r) => r.strike)).toEqual([7350, 7400, 7425]);
  });

  it("leaves an unpriced strike's greeks null and keeps its market — a gap is not a deletion", async () => {
    const cohort = await ladder();
    const gap = cohort.strikes.find((r) => r.strike === 7425);
    expect([gap?.iv, gap?.delta, gap?.gamma, gap?.theta, gap?.vega, gap?.vSkew]).toEqual([
      null, null, null, null, null, null,
    ]);
    expect([gap?.bid, gap?.ask, gap?.openInterest]).toEqual([58.0, 60.5, 66]);
  });

  it("measures vertical skew against the ATM strike's OWN IV", async () => {
    const cohort = await ladder();
    expect(cohort.atmStrike).toBe(7400);
    expect(cohort.atmIv).toBeCloseTo(0.162, 12);
    expect(cohort.strikes.find((r) => r.strike === 7400)?.vSkew).toBeCloseTo(0, 12);
    expect(cohort.strikes.find((r) => r.strike === 7350)?.vSkew).toBeCloseTo(0.1724 - 0.162, 12);
  });

  it("nulls EVERY vertical skew when the ATM strike itself never solved", async () => {
    // A neighbour's IV is not a substitute reference. V-Skew renders as a sortable column, so a
    // row silently re-based on 7350 is not merely slightly off — it is on a different scale from
    // every row it gets ranked against, and the ranking is what tells the reader they compare.
    const cohort = await ladder(LADDER.map((q) => (q.strike === 7_400_000 ? { ...q, bsmIv: null } : q)));
    expect(cohort.atmStrike).toBe(7400);
    expect(cohort.atmIv).toBeNull();
    expect(cohort.strikes.every((r) => r.vSkew === null)).toBe(true);
    // The 7350 leg still prices — a missing reference kills the skew column, not the greeks.
    expect(cohort.strikes.find((r) => r.strike === 7350)?.delta).not.toBeNull();
  });
});

describe("priceChain — degradations", () => {
  it("returns an empty surface on an empty chain, never an error", async () => {
    const result = await makePriceChainUseCase(deps({ readChain: () => Promise.resolve(ok([])) }))(
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cohorts).toEqual([]);
    expect(result.value.spot).toBeNull();
  });

  it("reports a NULL spot rather than fabricating a zero the index never traded at", async () => {
    const result = await makePriceChainUseCase(
      deps({ readChain: () => Promise.resolve(ok([quote({ underlyingPrice: 0 })])) }),
    )({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBeNull();
    // No spot means no ATM reference, no greeks and no honest "nearest strike" — so no rows,
    // rather than rows measured against nothing.
    expect(result.value.cohorts).toEqual([]);
  });

  it("stamps asOf with the newest observation the chain carries, not the clock", async () => {
    const rows = [
      quote({ time: new Date("2026-07-28T15:29:00.000Z") }),
      quote({ strike: 7_350_000, time: new Date("2026-07-28T15:31:00.000Z") }),
    ];
    const result = await makePriceChainUseCase(deps({ readChain: () => Promise.resolve(ok(rows)) }))(
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.asOf.toISOString()).toBe("2026-07-28T15:31:00.000Z");
  });
});
