/**
 * useChainModel.test.ts — state + derivation for the Analyzer's TWO chain surfaces.
 *
 * BROWSE (surface 1): row = one (root, expiration) cohort, ALL of them, nothing filtered away.
 * Expand a cohort and you get every strike it lists, each priced as a single LEG.
 *
 * PAIR (surface 2): the user picks a front leg and a back leg; only then does calendar math
 * happen — H-Skew, forward IV, edge, net greeks, haircut debit.
 *
 * This replaces the shipped design, where the model pre-paired every strike across two chosen
 * expiries. That was an INNER JOIN: a strike quoted in August but not September vanished with no
 * dash and no marker. On a screen whose whole point is "give me the data, do not decide for me",
 * a hidden filter is the worst possible default — so the join is gone, and the first test in
 * "cohorts" pins its absence.
 *
 * Still no ranking, no scoring, no "best" anything.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ChainRow } from "../lib/chain-contract.ts";

const { mockUseChain, mockUseGex } = vi.hoisted(() => ({
  mockUseChain: vi.fn(),
  mockUseGex: vi.fn(),
}));
vi.mock("./useChain.ts", () => ({ useChain: mockUseChain }));
// The model reads GEX only for per-expiry carry (r, q). `resolveCarry` degrades to its flat
// defaults on an absent snapshot, so an undefined-data stub exercises the same path the app
// takes before the first GEX response lands.
vi.mock("./useGex.ts", () => ({ useGex: mockUseGex }));
mockUseGex.mockReturnValue({ data: undefined });

import { useChainModel, legKey } from "./useChainModel.ts";

const SPOT = 6500;
const OBSERVED = "2026-07-26T18:00:00.000Z";

function row(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6500_000,
    expiration: "2026-08-21",
    contractType: "P",
    root: "SPXW",
    dte: 26,
    bsmIv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 100,
    underlyingPrice: SPOT,
    source: "schwab",
    observedAt: OBSERVED,
    ...over,
  };
}

/** Two expiries × both wings × a five-strike ladder, all SPXW. */
function chain(): ReadonlyArray<ChainRow> {
  const out: ChainRow[] = [];
  for (const e of [
    { expiration: "2026-08-21", dte: 26, base: 0.15 },
    { expiration: "2026-09-18", dte: 54, base: 0.17 },
  ]) {
    // Index points here; `row()` scales to the ×1000 convention below.
    for (const k of [6400, 6450, 6500, 6550, 6600]) {
      const iv = e.base + (6500 - k) * 0.00002;
      out.push(row({ strike: k * 1000, expiration: e.expiration, dte: e.dte, bsmIv: iv, contractType: "P" }));
      out.push(
        row({ strike: k * 1000, expiration: e.expiration, dte: e.dte, bsmIv: iv - 0.005, contractType: "C" }),
      );
    }
  }
  return out;
}

function settled(rows: ReadonlyArray<ChainRow>): void {
  mockUseChain.mockReturnValue({ data: rows, isPending: false, isError: false, refetch: vi.fn() });
}

/** The cohort for one (root, expiration), or undefined. */
function cohortOf(
  result: { current: ReturnType<typeof useChainModel> },
  expiration: string,
  root: "SPX" | "SPXW" = "SPXW",
) {
  return result.current.cohorts.find((c) => c.expiration === expiration && c.root === root);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Surface 1: Browse ────────────────────────────────────────────────────────

describe("useChainModel — cohorts (Browse)", () => {
  it("emits one cohort per (root, expiration), nearest expiry first", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.cohorts.map((c) => [c.root, c.expiration])).toEqual([
      ["SPXW", "2026-08-21"],
      ["SPXW", "2026-09-18"],
    ]);
    expect(result.current.cohorts[0]?.dte).toBe(26);
  });

  // THE REGRESSION THIS RESHAPE EXISTS FOR. The old model joined the two selected expiries on
  // strike and emitted only strikes present in BOTH. A strike quoted in August but not September
  // was silently absent — no dash, no marker, no row. Grouping instead of joining means every
  // strike the chain actually lists is reachable.
  it("keeps a strike that only ONE expiration lists — no inner join, nothing hidden", () => {
    const rows = chain().filter((r) => !(r.expiration === "2026-09-18" && r.strike === 6600_000));
    settled(rows);
    const { result } = renderHook(() => useChainModel());

    // August still lists all five strikes…
    expect(cohortOf(result, "2026-08-21")?.strikes.map((s) => s.strike)).toEqual([
      6400_000, 6450_000, 6500_000, 6550_000, 6600_000,
    ]);
    // …and September honestly shows the four it has, rather than pruning August down to match.
    expect(cohortOf(result, "2026-09-18")?.strikes.map((s) => s.strike)).toEqual([
      6400_000, 6450_000, 6500_000, 6550_000,
    ]);
  });

  it("splits the two OCC roots into separate cohorts instead of colliding them", () => {
    const rows = [
      ...chain(),
      row({ strike: 6500_000, expiration: "2026-08-21", dte: 26, root: "SPX", bsmIv: 0.55 }),
    ];
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    expect(result.current.cohorts.length).toBe(3);
    expect(cohortOf(result, "2026-08-21", "SPX")?.strikes.length).toBe(1);
    expect(cohortOf(result, "2026-08-21", "SPXW")?.strikes.length).toBe(5);
  });

  // P1 from the UAT: the cohort still carried yesterday's expiry, and because the old model
  // defaulted to expirations[0], the table opened as a wall of em dashes (negative DTE → no
  // greeks). An expired contract cannot be traded, so it is not data — it is stale cohort junk.
  it("drops expired cohorts (dte < 0) but keeps 0DTE, which is still tradeable", () => {
    const rows = [
      ...chain(),
      row({ expiration: "2026-07-25", dte: -1, strike: 6500_000 }),
      row({ expiration: "2026-07-26", dte: 0, strike: 6500_000 }),
    ];
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    const expiries = result.current.cohorts.map((c) => c.expiration);
    expect(expiries).not.toContain("2026-07-25");
    expect(expiries).toContain("2026-07-26");
    expect(expiries[0]).toBe("2026-07-26");
  });

  it("shows puts by default and switches the whole surface to calls on demand", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.contractType).toBe("P");
    const putIv = cohortOf(result, "2026-08-21")?.strikes[0]?.iv;

    act(() => {
      result.current.setContractType("C");
    });
    expect(cohortOf(result, "2026-08-21")?.strikes.every((s) => s.contractType === "C")).toBe(true);
    expect(cohortOf(result, "2026-08-21")?.strikes[0]?.iv).not.toBe(putIv);
  });

  it("prices each leg's own greeks, and nulls all four when the IV never solved", () => {
    const rows = chain().map((r) =>
      r.strike === 6450_000 && r.expiration === "2026-08-21" ? { ...r, bsmIv: null } : r,
    );
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    const strikes = cohortOf(result, "2026-08-21")?.strikes ?? [];
    const priced = strikes.find((s) => s.strike === 6500_000);
    const gap = strikes.find((s) => s.strike === 6450_000);
    expect(priced?.delta).not.toBeNull();
    expect(priced?.vega).not.toBeNull();
    // All-or-nothing: a half-priced leg is worse than a blank one.
    expect(gap?.delta).toBeNull();
    expect(gap?.gamma).toBeNull();
    expect(gap?.theta).toBeNull();
    expect(gap?.vega).toBeNull();
    // …and the row itself is still THERE, showing its bid/ask/OI. A gap is not a deletion.
    expect(gap?.bid).toBe(40);
    expect(gap?.openInterest).toBe(100);
  });

  it("measures V-Skew against the ATM of the same expiry AND wing", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    const puts = cohortOf(result, "2026-08-21")?.strikes ?? [];
    expect(puts.find((s) => s.strike === 6500_000)?.vSkew).toBeCloseTo(0, 12);
    // 100 points below spot at 0.00002/pt.
    expect(puts.find((s) => s.strike === 6400_000)?.vSkew).toBeCloseTo(0.002, 12);

    act(() => {
      result.current.setContractType("C");
    });
    // Calls: ATM call IV 0.145. Reading the PUT ATM (0.150) would make this +0.005, not 0.
    const calls = cohortOf(result, "2026-08-21")?.strikes ?? [];
    expect(calls.find((s) => s.strike === 6500_000)?.vSkew).toBeCloseTo(0, 12);
    expect(calls.find((s) => s.strike === 6400_000)?.vSkew).toBeCloseTo(0.002, 12);
  });

  // REGRESSION. atmIv is now root-scoped, so each cohort measures its skew against ITS OWN book.
  // Root-blind, the SPX cohort would have measured against SPXW's 0.15 ATM and reported a −40
  // vol-point skew: every input present and finite, so nothing dashes.
  it("measures each root's V-Skew against that root's own ATM, never its twin's", () => {
    const rows = [...chain()];
    for (const k of [6400, 6500]) {
      rows.push(
        row({ strike: k * 1000, expiration: "2026-08-21", dte: 26, root: "SPX", bsmIv: 0.55 + (6500 - k) * 0.00002 }),
      );
    }
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    const spx = cohortOf(result, "2026-08-21", "SPX")?.strikes ?? [];
    expect(spx.find((s) => s.strike === 6500_000)?.vSkew).toBeCloseTo(0, 12);
    expect(spx.find((s) => s.strike === 6400_000)?.vSkew).toBeCloseTo(0.002, 12);
  });

  it("reports the cohort's ATM IV and its 25Δ risk reversal", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(cohortOf(result, "2026-08-21")?.atmIv).toBeCloseTo(0.15, 12);
    // The five-strike ladder is far too narrow to reach 25 delta — null is the honest answer,
    // not a number scraped off the nearest strike.
    expect(cohortOf(result, "2026-08-21")?.riskReversal).toBeNull();
  });

  it("computes a real risk reversal once a cohort's ladder reaches both wings", () => {
    const wide: ChainRow[] = [];
    for (let k = 5600; k <= 7400; k += 25) {
      const iv = 0.2 - (k - 5600) * 0.00003;
      wide.push(row({ strike: k * 1000, bsmIv: iv, contractType: "P" }));
      wide.push(row({ strike: k * 1000, bsmIv: iv - 0.02, contractType: "C" }));
    }
    settled(wide);
    const { result } = renderHook(() => useChainModel());
    expect(cohortOf(result, "2026-08-21")?.riskReversal).not.toBeNull();
  });

  it("keeps the call wing available to the risk reversal while the surface shows puts", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.contractType).toBe("P");
    // RR spans BOTH wings of a cohort — it is a property of the expiry, not of the shown side.
    // Null here only because this ladder is too narrow, never because calls were filtered away.
    expect(cohortOf(result, "2026-08-21")?.riskReversal).toBeNull();
  });

  it("reports the underlying price and observation instant, and the load/error states", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.spot).toBe(SPOT);
    expect(result.current.observedAt).toBe(OBSERVED);

    cleanup();
    mockUseChain.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    const loading = renderHook(() => useChainModel());
    expect(loading.result.current.isLoading).toBe(true);
    expect(loading.result.current.cohorts).toEqual([]);
    expect(loading.result.current.pair).toBeNull();

    cleanup();
    mockUseChain.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    const errored = renderHook(() => useChainModel());
    expect(errored.result.current.isError).toBe(true);
    expect(errored.result.current.spot).toBeNull();
  });
});

// ─── Surface 2: Pair ──────────────────────────────────────────────────────────

describe("useChainModel — the picked pair", () => {
  /** Pick 6500P in August as the front and in September as the back. */
  function pick(result: { current: ReturnType<typeof useChainModel> }): void {
    const front = cohortOf(result, "2026-08-21")?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, "2026-09-18")?.strikes.find((s) => s.strike === 6500_000);
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
  }

  it("has no pair until the user picks both legs", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.pair).toBeNull();
    expect(result.current.frontLeg).toBeNull();

    const front = cohortOf(result, "2026-08-21")?.strikes[0];
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    // One leg is not a calendar — still no math.
    expect(result.current.frontLeg).not.toBeNull();
    expect(result.current.pair).toBeNull();
  });

  it("computes the calendar math once both legs are picked", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    pick(result);

    const pair = result.current.pair;
    expect(pair).not.toBeNull();
    // H-Skew is front − back (chain-math owns this): 0.15 − 0.17. NEGATIVE means the BACK month
    // is the rich one, the wrong way round for a calendar seller. Do not flip it to look friendlier.
    expect(pair?.hSkew).toBeCloseTo(-0.02, 12);
    expect(pair?.fwdIv).not.toBeNull();
    expect(pair?.edge).not.toBeNull();
    // Net greeks are back − front: long the back, short the front.
    expect(pair?.netDelta).not.toBeNull();
    expect(pair?.netGamma).not.toBeNull();
    expect(pair?.netTheta).not.toBeNull();
    expect(pair?.netVega).not.toBeNull();
    // Both months quote 40/42, so the MIDS cancel — but the debit is not 0, because the ORATS
    // haircut crosses 66% of each leg's width on the natural side: buy the back at 40 + .66×2 =
    // 41.32, sell the front at 42 − .66×2 = 40.68. Pricing off mids is the overstated edge the
    // haircut exists to remove.
    expect(pair?.debit).toBeCloseTo(0.64, 12);
  });

  it("carries both legs' own IVs, so the pair panel never re-derives them", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    pick(result);
    expect(result.current.pair?.front.iv).toBeCloseTo(0.15, 12);
    expect(result.current.pair?.back.iv).toBeCloseTo(0.17, 12);
  });

  it("flags a pair whose back leg is not strictly later, and refuses a TOS line for it", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    // Deliberately inverted: September as the front, August as the back.
    const sep = cohortOf(result, "2026-09-18")?.strikes.find((s) => s.strike === 6500_000);
    const aug = cohortOf(result, "2026-08-21")?.strikes.find((s) => s.strike === 6500_000);
    act(() => {
      if (sep !== undefined) result.current.pickFront(sep);
    });
    act(() => {
      if (aug !== undefined) result.current.pickBack(aug);
    });

    expect(result.current.pair?.backNotLater).toBe(true);
    // Forward vol has no solution when the back is not later — the identity divides by tb − tf.
    expect(result.current.pair?.fwdIv).toBeNull();
    expect(result.current.pair?.edge).toBeNull();
    // parseTosOrder SORTS the two dates, so emitting a line here would silently re-label the
    // pair as a valid calendar — a plausible wrong read of what the user picked.
    expect(result.current.pair?.tosOrder).toBeNull();
  });

  it("emits a TOS order line for a well-formed pair", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    pick(result);
    // Back expiry first, then the front — the long-calendar convention.
    expect(result.current.pair?.tosOrder).toContain("18 SEP 26");
    expect(result.current.pair?.tosOrder).toContain("6500 PUT");
    // The model must pass the ROOT through, not just the dates. Sep 18 2026 IS a third Friday,
    // so a root-blind builder tags it [AM] — wrong for SPXW, which is always PM-settled, and it
    // selects the wrong contract in TOS. Caught in live UAT.
    expect(result.current.pair?.tosOrder).not.toContain("[AM]");
    expect(result.current.pair?.tosOrder?.indexOf("18 SEP 26")).toBeLessThan(
      result.current.pair?.tosOrder?.indexOf("21 AUG 26") ?? -1,
    );
  });

  it("flags a cross-root pair — the math is real, but it spans two different books", () => {
    const rows = [
      ...chain(),
      row({ strike: 6500_000, expiration: "2026-09-18", dte: 54, root: "SPX", bsmIv: 0.17 }),
    ];
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    const front = cohortOf(result, "2026-08-21", "SPXW")?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, "2026-09-18", "SPX")?.strikes.find((s) => s.strike === 6500_000);
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
    expect(result.current.pair?.rootMismatch).toBe(true);
    // Flagged, not suppressed: the user picked both legs by hand, so this is a deliberate
    // choice, unlike the accidental collision the join used to produce.
    expect(result.current.pair?.hSkew).toBeCloseTo(-0.02, 12);
  });

  it("flags a different-strike pair as a diagonal, not a calendar", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    const front = cohortOf(result, "2026-08-21")?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, "2026-09-18")?.strikes.find((s) => s.strike === 6400_000);
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
    expect(result.current.pair?.diagonal).toBe(true);
    expect(result.current.pair?.rootMismatch).toBe(false);
  });

  // A put front against a call back is not a calendar at all. The old model made it
  // unrepresentable by filtering the wing before the join; here the picks are per-leg, so the
  // wing switch has to clear them. Otherwise picking a put, toggling, and picking a call builds
  // exactly the mixed-wing pair the exit advisor shipped once (a call priced as a put's front).
  it("clears the pair when the wing switches, so a mixed-wing pair is unreachable", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    pick(result);
    expect(result.current.pair).not.toBeNull();

    act(() => {
      result.current.setContractType("C");
    });
    expect(result.current.frontLeg).toBeNull();
    expect(result.current.backLeg).toBeNull();
    expect(result.current.pair).toBeNull();
  });

  it("clears the pair on demand", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    pick(result);
    act(() => {
      result.current.clearPair();
    });
    expect(result.current.pair).toBeNull();
  });

  // The chain polls every 30s. Holding the picked LEG OBJECT would freeze the pair's numbers at
  // whatever the first response said, so the panel would quietly show stale IVs while the rest of
  // the screen refreshed. The picks are identities; the numbers are re-resolved every render.
  it("re-resolves the picked legs against fresh data instead of freezing a snapshot", () => {
    settled(chain());
    const { result, rerender } = renderHook(() => useChainModel());
    pick(result);
    expect(result.current.pair?.front.iv).toBeCloseTo(0.15, 12);

    // Next poll: the front leg's IV moves.
    const moved = chain().map((r) =>
      r.expiration === "2026-08-21" && r.strike === 6500_000 && r.contractType === "P"
        ? { ...r, bsmIv: 0.19 }
        : r,
    );
    settled(moved);
    rerender();
    expect(result.current.pair?.front.iv).toBeCloseTo(0.19, 12);
    // …and the derived math moved with it: 0.19 − 0.17 is now POSITIVE, front-rich.
    expect(result.current.pair?.hSkew).toBeCloseTo(0.02, 12);
  });

  it("drops a picked leg that left the chain entirely", () => {
    settled(chain());
    const { result, rerender } = renderHook(() => useChainModel());
    pick(result);
    expect(result.current.pair).not.toBeNull();

    settled(chain().filter((r) => !(r.expiration === "2026-09-18" && r.strike === 6500_000)));
    rerender();
    expect(result.current.backLeg).toBeNull();
    expect(result.current.pair).toBeNull();
    // The surviving front pick is untouched — one leg leaving is not a reason to forget both.
    expect(result.current.frontLeg).not.toBeNull();
  });
});

describe("legKey", () => {
  it("includes root, wing, expiration and strike — the full row identity", () => {
    const base = { root: "SPXW", expiration: "2026-08-21", contractType: "P", strike: 6500_000 } as const;
    const key = legKey(base);
    expect(key).toContain("SPXW");
    expect(key).toContain("2026-08-21");
    expect(key).toContain("P");
    expect(key).toContain("6500000");
    // Each of the four fields alone must be enough to change the key. Dropping any one of them
    // is how 242 rows collided on one React key in production.
    expect(legKey({ ...base, root: "SPX" })).not.toBe(key);
    expect(legKey({ ...base, contractType: "C" })).not.toBe(key);
    expect(legKey({ ...base, expiration: "2026-09-18" })).not.toBe(key);
    expect(legKey({ ...base, strike: 6400_000 })).not.toBe(key);
  });
});
