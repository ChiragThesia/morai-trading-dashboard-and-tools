import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { ok, err } from "@morai/shared";
import { makeGetChainUseCase } from "@morai/core";
import type { ChainQuoteForPicker, ForRunningGetChain } from "@morai/core";
import { chainResponse } from "@morai/contracts";
import { chainRoutes } from "./chain.routes.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

/** Solved-IV call leg. `strike` is the ×1000 int convention (7400000 = 7400). */
const CALL_ROW = {
  root: "SPXW",
  strike: 7400000,
  expiration: "2026-08-21",
  contractType: "C" as const,
  dte: 26,
  bsmIv: 0.1842,
  bid: 121.4,
  ask: 123.2,
  openInterest: 4210,
  // underlyingPrice is the OPPOSITE convention to strike — unscaled index points.
  underlyingPrice: 7381.12,
  source: "schwab" as const,
  observedAt: "2026-07-26T15:00:00.000Z",
};

/** Half-strike put leg with UNSOLVED IV — bsmIv is nullable but never optional, never 0. */
const PUT_ROW = {
  root: "SPXW",
  strike: 7412500, // 7412.5 strike — proves the ×1000 int convention survives the seam
  expiration: "2026-09-18",
  contractType: "P" as const,
  dte: 54,
  bsmIv: null,
  bid: 208.9,
  ask: 211.5,
  openInterest: 877,
  underlyingPrice: 7381.12,
  source: "cboe" as const,
  observedAt: "2026-07-26T15:00:00.000Z",
};

/** Returns a two-leg cohort */
const getChainOk: ForRunningGetChain = async () => ok([CALL_ROW, PUT_ROW]);

/**
 * Returns an EMPTY cohort — the cold-start / no-data case.
 * Array read, so this is 200 + [], never 404 (the GEX 404-on-null rule does NOT apply here).
 */
const getChainEmpty: ForRunningGetChain = async () => ok([]);

/**
 * Returns rows carrying internal repo fields the contract does not publish.
 * Structural widening — ReadonlyArray<ChainEntry> accepts the wider row, so this compiles
 * without a cast and proves the route strips rather than forwards.
 */
const LEAKY_ROW = { ...CALL_ROW, root: "SPXW", time: new Date("2026-07-26T15:00:00.000Z"), rowId: 99 };
const getChainLeaky: ForRunningGetChain = async () => ok([LEAKY_ROW]);

/** Returns a storage error */
const getChainErr: ForRunningGetChain = async () =>
  err({ kind: "storage-error" as const, message: "db connection failed" });

// ── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(getChain: ForRunningGetChain) {
  const app = new Hono();
  // Mounted at "/" matching the main.ts apiRouter chain — effective path is GET /api/chain.
  app.route("/", chainRoutes(getChain));
  return app;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("GET /chain", () => {
  it("returns 200 with a chainResponse-valid body for a stored cohort", async () => {
    const app = buildTestApp(getChainOk);
    const res = await app.request("/chain");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Must parse through the contract without throwing (MCP-02 contract parity)
    const parsed = chainResponse.parse(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.strike).toBe(7400000);
    expect(parsed[0]?.contractType).toBe("C");
    expect(parsed[0]?.bsmIv).toBe(0.1842);
    expect(parsed[0]?.source).toBe("schwab");
    expect(parsed[0]?.observedAt).toBe("2026-07-26T15:00:00.000Z");
    // Half-strike survives the seam as a ×1000 int, and unsolved IV stays explicitly null.
    expect(parsed[1]?.strike).toBe(7412500);
    expect(parsed[1]?.bsmIv).toBeNull();
    expect(parsed[1]?.source).toBe("cboe");
  });

  it("returns 200 + [] when the store is empty — an array read NEVER 404s", async () => {
    const app = buildTestApp(getChainEmpty);
    const res = await app.request("/chain");
    // The GEX 404-on-null pattern is for a single object; this endpoint is an array (COT rule).
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toStrictEqual([]);
    expect(chainResponse.parse(body)).toStrictEqual([]);
  });

  it("returns 500 {error:'internal'} when getChain returns a storage error", async () => {
    const app = buildTestApp(getChainErr);
    const res = await app.request("/chain");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    // Flat error — the DB message never reaches the wire.
    expect(body).toStrictEqual({ error: "internal" });
  });

  it("body passes chainResponse.parse (MCP-02 schema contract)", async () => {
    const app = buildTestApp(getChainOk);
    const res = await app.request("/chain");
    const body: unknown = await res.json();
    expect(() => chainResponse.parse(body)).not.toThrow();
  });

  it("does NOT leak internal repo fields (time/rowId) — the route Zod-parses on the way out", async () => {
    const app = buildTestApp(getChainLeaky);
    const res = await app.request("/chain");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Read the RAW body as open records — a bare c.json(rows) would forward the extra keys
    // and fail here. chainResponse.parse() would itself strip them, so it cannot be the probe.
    const rawRows = z.array(z.record(z.string(), z.unknown())).parse(body);
    const rawKeys = Object.keys(rawRows[0] ?? {}).sort();
    // root is now a PUBLISHED field, not an internal one: SPX and SPXW quote the same
    // strike, so it is the only thing separating the two books on the wire.
    expect(rawKeys).toContain("root");
    expect(rawKeys).not.toContain("time");
    expect(rawKeys).not.toContain("rowId");
    expect(rawKeys).toStrictEqual(
      [
        "ask",
        "bid",
        "bsmIv",
        "contractType",
        "dte",
        "expiration",
        "observedAt",
        "openInterest",
        "root",
        "source",
        "strike",
        "underlyingPrice",
      ].sort(),
    );
  });
});

/**
 * CROSS-SEAM: a REAL getChain result satisfies the REAL contract.
 *
 * Everything above stubs `ForRunningGetChain` and feeds a hand-written `ChainEntry[]`. That
 * proves the route wires up and strips internal fields; it proves nothing about whether the
 * USE-CASE's output matches the contract, because the fixture and the schema were written by the
 * same hand and agree by construction.
 *
 * This block builds the real `makeGetChainUseCase` from repo-shaped input, drives it through the
 * real route, and asserts on the JSON that actually comes back. It covers the drift the
 * `body: ChainResponse` annotation in chain.routes.ts CANNOT see, because these are properties of
 * the serialised VALUE rather than of the type:
 *
 *   - `observedAt` is `z.string()` in the contract, so Zod accepts ANY string. The Z suffix is a
 *     past production bug (chain observedAt Z-suffix, Phase 11) and only an assertion catches it.
 *   - `bsmIv` arrives from the column as `string | null` with a literal `'NaN'` sentinel for a
 *     permanently failed inversion. `JSON.stringify(NaN)` is `null`, so a core regression that
 *     let NaN through would be INVISIBLE on the wire and pass `.parse()`. The sentinel has to be
 *     driven end to end.
 *   - `dte` is derived in core from `observedAt.slice(0, 10)` against the expiration.
 */
describe("cross-seam: a REAL getChain result satisfies the REAL contract", () => {
  const OBSERVED = new Date("2026-07-27T15:30:00.000Z");

  /** One repo-shaped row — ChainQuoteForPicker, what picker-chain.ts actually returns. */
  function quote(over: Partial<ChainQuoteForPicker> = {}): ChainQuoteForPicker {
    return {
      time: OBSERVED,
      strike: 7_400_000,
      expiration: "2026-08-21",
      contractType: "P",
      underlyingPrice: 7401.89,
      bsmIv: "0.1712",
      root: "SPXW",
      bid: 61.2,
      ask: 62.4,
      openInterest: 39,
      source: "cboe",
      ...over,
    };
  }

  function realApp(rows: ReadonlyArray<ChainQuoteForPicker>) {
    return buildTestApp(makeGetChainUseCase({ readChain: () => Promise.resolve(ok(rows)) }));
  }

  it("emits a Z-suffixed UTC instant for observedAt, which the contract's z.string() cannot check", async () => {
    const res = await realApp([quote()]).request("/chain");
    const parsed = chainResponse.parse(await res.json());
    const row = parsed[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.observedAt).toBe("2026-07-27T15:30:00.000Z");
    expect(row.observedAt.endsWith("Z")).toBe(true);
    // And it round-trips to the same instant — a truncated or offset-shifted string would not.
    expect(new Date(row.observedAt).getTime()).toBe(OBSERVED.getTime());
  });

  it("turns the 'NaN' sentinel into a real null, not a NaN that JSON hides as null", async () => {
    // The trap: if core let NaN through, JSON.stringify writes `null` and chainResponse.parse
    // accepts it, so the wire looks correct while the in-process value is NaN. Asserting on the
    // parsed body alone cannot distinguish those, so this also checks the use-case's own output.
    const useCase = makeGetChainUseCase({
      readChain: () => Promise.resolve(ok([quote({ bsmIv: "NaN" }), quote({ bsmIv: null }), quote({ bsmIv: "" })])),
    });
    const direct = await useCase();
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    for (const entry of direct.value) {
      expect(entry.bsmIv).toBeNull();
      expect(Number.isNaN(entry.bsmIv)).toBe(false);
    }

    const parsed = chainResponse.parse(await (await realApp([quote({ bsmIv: "NaN" })]).request("/chain")).json());
    expect(parsed[0]?.bsmIv).toBeNull();
  });

  it("keeps a solved IV as a decimal, never a percent", async () => {
    const parsed = chainResponse.parse(await (await realApp([quote({ bsmIv: "0.1712" })]).request("/chain")).json());
    expect(parsed[0]?.bsmIv).toBeCloseTo(0.1712, 9);
  });

  it("derives dte in core as calendar days from the observation day to the expiration", async () => {
    // 2026-07-27 → 2026-08-21 is 25 calendar days.
    const parsed = chainResponse.parse(await (await realApp([quote()]).request("/chain")).json());
    expect(parsed[0]?.dte).toBe(25);
  });

  it("keeps strike as the ×1000 integer convention across the seam", async () => {
    // 7412.5 is a real SPX half-point strike; the ×1000 form keeps it exact.
    const parsed = chainResponse.parse(await (await realApp([quote({ strike: 7_412_500 })]).request("/chain")).json());
    expect(parsed[0]?.strike).toBe(7_412_500);
    expect(Number.isInteger(parsed[0]?.strike)).toBe(true);
  });

  it("degrades an absent root to SPXW, the PM-settled case, and still satisfies the enum", async () => {
    const bare: ChainQuoteForPicker = {
      time: OBSERVED,
      strike: 7_400_000,
      expiration: "2026-08-21",
      contractType: "P",
      underlyingPrice: 7401.89,
      bsmIv: "0.17",
      bid: 61.2,
      ask: 62.4,
      openInterest: 39,
      source: "cboe",
    };
    const parsed = chainResponse.parse(await (await realApp([bare]).request("/chain")).json());
    expect(parsed[0]?.root).toBe("SPXW");
  });

  it("keeps SPX and SPXW as separate rows at the same strike and expiration", async () => {
    // (strike, expiration, contractType) is NOT unique — root is the only separator, and the two
    // books collapsing into one row is a bug this repo has already shipped once.
    const parsed = chainResponse.parse(
      await (
        await realApp([
          quote({ root: "SPX", bsmIv: "0.2469" }),
          quote({ root: "SPXW", bsmIv: "0.1712" }),
        ]).request("/chain")
      ).json(),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed.map((r) => r.root).sort()).toStrictEqual(["SPX", "SPXW"]);
  });

  it("returns a contract-valid empty array for an empty cohort", async () => {
    const parsed = chainResponse.parse(await (await realApp([]).request("/chain")).json());
    expect(parsed).toStrictEqual([]);
  });
});
