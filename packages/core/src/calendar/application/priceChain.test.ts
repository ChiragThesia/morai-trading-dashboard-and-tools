/**
 * priceChain.test.ts — the per-strike chain surface's read, its wing and its degradations.
 *
 * The FORMULAS are not asserted here. They are asserted against the browser implementation this
 * surface replaces, at `apps/server/src/adapters/chain-surface-differential.test.ts` — that is the
 * only place both sides can be imported, and a second set of hand-written expectations here would
 * be a second thing to keep in step. What this file pins is everything the differential test
 * cannot see: what happens when the read fails, when the chain is empty, and when spot is gone.
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
