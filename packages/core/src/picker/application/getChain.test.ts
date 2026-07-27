/**
 * getChain use-case — RED test (Analyzer chain data table).
 *
 * Locks the GREEN targets:
 * 1. makeGetChainUseCase is a factory returning a callable (ForRunningGetChain-shaped) use-case.
 * 2. Each ChainQuoteForPicker row maps to a ChainEntry: dte from the row's own `time` to its
 *    expiration, observedAt = time.toISOString(), the rest passed through unchanged.
 * 3. bsmIv parses numeric-string → number; null stays null; the stored "NaN" sentinel
 *    (unsolved inversion, leg-observations convention) becomes null — never 0, never NaN
 *    (a NaN would fail the route's Zod number check).
 * 4. Empty cohort → ok([]), never null.
 * 5. StorageError from ForReadingChainForPicker propagates unchanged.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetChainUseCase } from "./getChain.ts";
import type { ChainQuoteForPicker, ForReadingChainForPicker } from "./ports.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ROW: ChainQuoteForPicker = {
  time: new Date("2026-06-23T14:00:00Z"),
  strike: 7400000,
  expiration: "2026-06-27",
  contractType: "P",
  underlyingPrice: 7381.12,
  bsmIv: "0.1834",
  root: "SPXW",
  bid: 12.4,
  ask: 13.1,
  openInterest: 17071,
  source: "cboe",
};

describe("makeGetChainUseCase", () => {
  it("is a factory returning a callable use-case", () => {
    const readChain: ForReadingChainForPicker = async () => ok([]);
    const getChain = makeGetChainUseCase({ readChain });
    expect(typeof getChain).toBe("function");
  });

  it("maps a chain row to the contract entry shape", async () => {
    const readChain: ForReadingChainForPicker = async () => ok([ROW]);
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        strike: 7400000,
        expiration: "2026-06-27",
        contractType: "P",
        root: "SPXW",
        dte: 4,
        bsmIv: 0.1834,
        bid: 12.4,
        ask: 13.1,
        openInterest: 17071,
        underlyingPrice: 7381.12,
        source: "cboe",
        observedAt: "2026-06-23T14:00:00.000Z",
      },
    ]);
  });

  it("computes dte as calendar days from the row's own time (0 on expiry day)", async () => {
    const rows: ReadonlyArray<ChainQuoteForPicker> = [
      { ...ROW, expiration: "2026-06-23" },
      { ...ROW, expiration: "2026-07-17" },
    ];
    const readChain: ForReadingChainForPicker = async () => ok(rows);
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.dte)).toEqual([0, 24]);
  });

  it("keeps an unsolved bsmIv null — never 0, never NaN", async () => {
    const rows: ReadonlyArray<ChainQuoteForPicker> = [
      { ...ROW, bsmIv: null },
      { ...ROW, bsmIv: "NaN" },
    ];
    const readChain: ForReadingChainForPicker = async () => ok(rows);
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.bsmIv)).toEqual([null, null]);
  });

  it("keeps a genuine zero bsmIv as 0, not null", async () => {
    const readChain: ForReadingChainForPicker = async () => ok([{ ...ROW, bsmIv: "0" }]);
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.bsmIv).toBe(0);
  });

  it("returns ok([]) when the cohort is empty", async () => {
    const readChain: ForReadingChainForPicker = async () => ok([]);
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("propagates a StorageError from ForReadingChainForPicker", async () => {
    const readChain: ForReadingChainForPicker = async () =>
      err({ kind: "storage-error", message: "connection refused" });
    const getChain = makeGetChainUseCase({ readChain });

    const result = await getChain();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
    expect(result.error.message).toBe("connection refused");
  });
});

// REGRESSION (prod, 2026-07-26). SPX (AM-settled monthlies) and SPXW (PM-settled weeklies)
// quote the SAME strike on the SAME date — different OCC symbols, different books, different
// quotes. `root` was missing from the entry shape, so the two arrived indistinguishable: the
// Analyzer collided them onto one row key (242 duplicates live) and its strike join kept
// whichever it saw last, which was often the twin whose IV had never solved.
describe("getChain — SPX vs SPXW", () => {
  it("carries root, so the two roots at one strike stay distinguishable", async () => {
    const both: ReadonlyArray<ChainQuoteForPicker> = [
      { ...ROW, root: "SPX", bsmIv: "0.2510849", bid: 10.1, ask: 11.1, openInterest: 3461 },
      { ...ROW, root: "SPXW", bsmIv: null, bid: 10.7, ask: 11.2, openInterest: 264 },
    ];
    const getChain = makeGetChainUseCase({ readChain: async () => ok(both) });
    const result = await getChain();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.root)).toEqual(["SPX", "SPXW"]);
    // Same strike/expiration/wing — root is the ONLY thing telling them apart.
    expect(new Set(result.value.map((r) => r.strike)).size).toBe(1);
    expect(result.value[0]?.bsmIv).toBeCloseTo(0.2510849, 9);
    expect(result.value[1]?.bsmIv).toBeNull();
  });

  it("defaults an absent root to SPXW, matching the repo's own PM-settled fallback", async () => {
    const noRoot: ChainQuoteForPicker = { ...ROW };
    const getChain = makeGetChainUseCase({ readChain: async () => ok([noRoot]) });
    const result = await getChain();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.root).toBe("SPXW");
  });
});
