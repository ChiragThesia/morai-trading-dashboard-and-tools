/**
 * chain-surface.routes.test.ts — GET /chain/priced.
 *
 * The last describe is the one that matters: it drives the REAL priceChain use-case through the
 * REAL route and parses the response with the REAL pricedChainResponse schema. The core surface
 * type and this contract are mirrored by hand across a package boundary, and this repo has
 * shipped that exact drift before. A fixture that agrees with the schema it is testing proves
 * nothing; a real engine result does — especially here, where the engine's whole point is that
 * some rows come back with null greeks.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import { makePriceChainUseCase } from "@morai/core";
import type { CalendarChainQuote, ChainSurface, ForPricingChain } from "@morai/core";
import { pricedChainResponse } from "@morai/contracts";
import { chainSurfaceRoutes } from "./chain-surface.routes.ts";

const NOW = new Date("2026-07-28T15:30:00.000Z");
const SPOT = 7401.89;

function app(priceChain: ForPricingChain): Hono {
  return new Hono().route("/", chainSurfaceRoutes(priceChain));
}

const EMPTY: ChainSurface = {
  asOf: NOW,
  spot: null,
  contractType: "P",
  cohorts: [],
};

describe("GET /chain/priced — transport", () => {
  it("returns 200 and an empty cohort list when the chain is empty — never a 404", async () => {
    // "Nothing quoted" is an answer. The 404-on-null rule is for a missing stored snapshot row;
    // nothing is stored here.
    const res = await app(() => Promise.resolve(ok(EMPTY))).request("/chain/priced");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asOf: NOW.toISOString(),
      spot: null,
      contractType: "P",
      cohorts: [],
    });
  });

  it("maps a read failure to a flat 500 that leaks no storage detail", async () => {
    const res = await app(() =>
      Promise.resolve(err({ kind: "storage-error" as const, message: 'relation "x" does not exist' })),
    ).request("/chain/priced");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.stringify(await app(() =>
      Promise.resolve(err({ kind: "storage-error" as const, message: "relation" })),
    ).request("/chain/priced").then((r) => r.json()))).not.toContain("relation");
  });

  it("rejects an invalid wing with a 400 BEFORE the engine is called", async () => {
    let called = false;
    const res = await app(() => {
      called = true;
      return Promise.resolve(ok(EMPTY));
    }).request("/chain/priced?contractType=X");
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("passes the requested wing through to the use-case", async () => {
    let seen: string | undefined;
    const res = await app((request) => {
      seen = request.contractType;
      return Promise.resolve(ok({ ...EMPTY, contractType: "C" }));
    }).request("/chain/priced?contractType=C");
    expect(res.status).toBe(200);
    expect(seen).toBe("C");
  });

  it("omits an absent wing so the use-case's own default stays the single source", async () => {
    let seen: unknown = "untouched";
    await app((request) => {
      seen = "contractType" in request ? request.contractType : "absent";
      return Promise.resolve(ok(EMPTY));
    }).request("/chain/priced");
    expect(seen).toBe("absent");
  });
});

describe("GET /chain/priced — the real engine through the real contract", () => {
  function quote(over: Partial<CalendarChainQuote> = {}): CalendarChainQuote {
    return {
      time: NOW,
      strike: 7_400_000,
      expiration: "2026-08-14",
      contractType: "P",
      underlyingPrice: SPOT,
      bsmIv: "0.1620",
      root: "SPXW",
      bid: 48.6,
      ask: 50.2,
      openInterest: 2417,
      source: "cboe",
      ...over,
    };
  }

  const rows = [
    quote(),
    quote({ strike: 7_350_000, bsmIv: "0.1724", bid: 33.1, ask: 34.9 }),
    // The row whose IV never solved. It is the reason this test exists: the contract must accept
    // a strike with a market and no greeks, and the engine must still emit it.
    quote({ strike: 7_425_000, bsmIv: null, bid: 58.0, ask: 60.5, openInterest: 66 }),
  ];

  const priceChain = makePriceChainUseCase({
    readChain: () => Promise.resolve(ok(rows)),
    now: () => NOW,
    carry: { rate: 0.045, divYield: 0.013 },
  });

  it("parses a real engine result through the published schema", async () => {
    const res = await app(priceChain).request("/chain/priced");
    expect(res.status).toBe(200);
    const parsed = pricedChainResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.spot).toBe(SPOT);
    expect(parsed.data.cohorts).toHaveLength(1);
    expect(parsed.data.cohorts[0]?.strikes.map((s) => s.strike)).toEqual([7350, 7400, 7425]);
  });

  it("carries a 0DTE cohort and an all-unpriced one through the schema", async () => {
    // The seam the engine's own tests cannot reach. `pricedChainCohort.dte` is `z.number().int()`
    // with no lower bound and `strikes` has no `.min()`, so neither shape is rejected — but that
    // is a property of a schema written before either shape could occur, and it has to be proved
    // rather than read. A 0DTE cohort reaches this route every trading day.
    const withBoth = makePriceChainUseCase({
      readChain: () =>
        Promise.resolve(
          ok([
            ...rows,
            // Expires on the observation date, PM-settled, 4.5 hours of life left.
            quote({ expiration: "2026-07-28", bsmIv: "0.2410", bid: 8.1, ask: 8.9 }),
            // An expiry the bounded IV drain has not reached: quoted, solved nowhere.
            quote({ expiration: "2026-09-18", bsmIv: null, bid: 108.5, ask: 111.9 }),
          ]),
        ),
      now: () => NOW,
      carry: { rate: 0.045, divYield: 0.013 },
    });

    const res = await app(withBoth).request("/chain/priced");
    expect(res.status).toBe(200);
    const parsed = pricedChainResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const zero = parsed.data.cohorts.find((c) => c.expiration === "2026-07-28");
    expect(zero?.dte).toBe(0);
    expect(zero?.t ?? 0).toBeGreaterThan(0);
    expect(zero?.strikes).toHaveLength(1);

    const unsolved = parsed.data.cohorts.find((c) => c.expiration === "2026-09-18");
    expect(unsolved?.strikes.map((s) => s.iv)).toEqual([null]);
    expect(unsolved?.atmIv).toBeNull();
    expect(unsolved?.strikes[0]?.bid).toBe(108.5);
  });

  it("carries the unpriceable strike to the wire with its market and null greeks", async () => {
    const res = await app(priceChain).request("/chain/priced");
    const parsed = pricedChainResponse.parse(await res.json());
    const gap = parsed.cohorts[0]?.strikes.find((s) => s.strike === 7425);
    expect(gap).toBeDefined();
    expect(gap?.iv).toBeNull();
    expect(gap?.delta).toBeNull();
    expect(gap?.vSkew).toBeNull();
    expect(gap?.bid).toBe(58.0);
    expect(gap?.openInterest).toBe(66);
  });
});
