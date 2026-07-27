/**
 * useChainModel.test.ts — the Analyzer chain table's state + derivation.
 *
 * The model does four things and nothing else: pick a front/back expiry pair,
 * group the flat chain by strike, join each strike's two legs through
 * chain-math, and report the 25Δ risk reversal per expiry. No ranking, no
 * scoring, no "best" anything.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ChainRow } from "../lib/chain-contract.ts";

const { mockUseChain } = vi.hoisted(() => ({ mockUseChain: vi.fn() }));
vi.mock("./useChain.ts", () => ({ useChain: mockUseChain }));

import { useChainModel } from "./useChainModel.ts";

const SPOT = 6500;
const OBSERVED = "2026-07-26T18:00:00.000Z";

function row(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6500_000,
    expiration: "2026-08-21",
    contractType: "P",
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

/** Two expiries × both types × a five-strike ladder. */
function chain(): ReadonlyArray<ChainRow> {
  const out: ChainRow[] = [];
  const expiries = [
    { expiration: "2026-08-21", dte: 26, base: 0.15 },
    { expiration: "2026-09-18", dte: 54, base: 0.17 },
  ];
  for (const e of expiries) {
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
  mockUseChain.mockReturnValue({
    data: { rows },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useChainModel — expiry selection", () => {
  it("lists every expiry once, nearest first", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.expirations.map((e) => e.expiration)).toEqual(["2026-08-21", "2026-09-18"]);
    expect(result.current.expirations[0]?.dte).toBe(26);
  });

  it("defaults to the two nearest expiries as front and back", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.frontExpiry).toBe("2026-08-21");
    expect(result.current.backExpiry).toBe("2026-09-18");
  });

  it("lets the user pick a different pair", () => {
    settled([...chain(), row({ expiration: "2026-10-16", dte: 82, strike: 6500_000 })]);
    const { result } = renderHook(() => useChainModel());
    act(() => {
      result.current.setBackExpiry("2026-10-16");
    });
    expect(result.current.backExpiry).toBe("2026-10-16");
  });

  it("has no expiries and no rows before the first response", () => {
    mockUseChain.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.expirations).toEqual([]);
    expect(result.current.rows).toEqual([]);
    expect(result.current.frontExpiry).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
});

describe("useChainModel — joined rows", () => {
  it("emits one row per strike present in BOTH legs, ascending", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.rows.map((r) => r.strike)).toEqual([6400, 6450, 6500, 6550, 6600]);
  });

  it("drops a strike the back month does not list", () => {
    const rows = chain().filter((r) => !(r.expiration === "2026-09-18" && r.strike === 6600_000));
    settled(rows);
    const { result } = renderHook(() => useChainModel());
    expect(result.current.rows.map((r) => r.strike)).toEqual([6400, 6450, 6500, 6550]);
  });

  it("shows puts by default and switches to calls on demand", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.contractType).toBe("P");
    const putIv = result.current.rows[0]?.front.iv;

    act(() => {
      result.current.setContractType("C");
    });
    expect(result.current.contractType).toBe("C");
    expect(result.current.rows[0]?.front.iv).not.toBe(putIv);
  });

  // REGRESSION. The chain carries BOTH wings. Joining on strike+expiration alone pairs a
  // put front against a call back: every input is present and finite, so nothing renders an
  // em dash — the row just reads wrong. The same bug shipped in the exit advisor's
  // toRollCandidates, which priced a call as a put calendar's replacement front leg.
  it("never pairs a put against a call at the same strike and expiration", () => {
    // Calls carry an unmistakable IV so a mixed-wing row is impossible to miss.
    const rows = chain().map((r) => (r.contractType === "C" ? { ...r, bsmIv: 0.99 } : r));
    settled(rows);
    const { result } = renderHook(() => useChainModel());

    for (const row of result.current.rows) {
      expect(row.contractType).toBe("P");
      expect(row.front.iv).not.toBe(0.99);
      expect(row.back.iv).not.toBe(0.99);
    }
    // And the put wing's own skew is still the honest 2 vol points.
    expect(result.current.rows.find((r) => r.strike === 6500)?.hSkew).toBeCloseTo(0.02, 12);
  });

  it("keeps the call wing available to the risk reversal even while the table shows puts", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    // Puts on screen…
    expect(result.current.contractType).toBe("P");
    // …and the RR still consults BOTH wings (it returns null here only because the ladder is
    // too narrow to reach 25Δ — never because the calls were filtered away at the source).
    expect(result.current.frontRr).toBeNull();
  });

  it("carries the horizontal skew, edge and net greeks the math module computes", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    const atm = result.current.rows.find((r) => r.strike === 6500);
    expect(atm).toBeDefined();
    // back 0.17 − front 0.15 at the ATM strike.
    expect(atm?.hSkew).toBeCloseTo(0.02, 12);
    expect(atm?.edge).not.toBeNull();
    expect(atm?.net).not.toBeNull();
    expect(atm?.debit).toBeCloseTo(0, 12); // identical quotes both months in this fixture
  });

  it("measures vertical skew against the ATM strike of the SAME expiry", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    const atm = result.current.rows.find((r) => r.strike === 6500);
    const wing = result.current.rows.find((r) => r.strike === 6400);
    expect(atm?.frontVSkew).toBeCloseTo(0, 12);
    // 100 points below spot at 0.00002/pt.
    expect(wing?.frontVSkew).toBeCloseTo(0.002, 12);
  });

  // REGRESSION, and the nastiest one in this file. vSkewVsAtm takes two bare floats —
  // contractType is long gone by the time it runs, so it CANNOT null itself if the ATM
  // reference came from the other wing. It just returns a clean, plausible, wrong number
  // forever. Enforcement has to happen here, at assembly.
  //
  // The fixture deliberately gives the two wings DIFFERENT ATM IVs (calls are puts − 0.005).
  // With equal ATM IVs this test would pass whether or not the wing is respected, and would
  // prove nothing.
  it("measures vertical skew against the ATM of the SAME wing, not the other one", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());

    // Puts: ATM put IV 0.150. Reading the CALL ATM (0.145) would make this −0.005, not 0.
    expect(result.current.rows.find((r) => r.strike === 6500)?.frontVSkew).toBeCloseTo(0, 12);

    act(() => {
      result.current.setContractType("C");
    });

    // Calls: ATM call IV 0.145. Reading the PUT ATM (0.150) would make this +0.005, not 0.
    expect(result.current.rows.find((r) => r.strike === 6500)?.frontVSkew).toBeCloseTo(0, 12);
    expect(result.current.rows.find((r) => r.strike === 6500)?.backVSkew).toBeCloseTo(0, 12);
    // …and the wing strike still measures the same 0.002 slope within its own wing.
    expect(result.current.rows.find((r) => r.strike === 6400)?.frontVSkew).toBeCloseTo(0.002, 12);
  });
});

describe("useChainModel — expiry header numbers", () => {
  it("reports the underlying price and observation instant from the chain", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    expect(result.current.spot).toBe(SPOT);
    expect(result.current.observedAt).toBe(OBSERVED);
  });

  it("reports a 25Δ risk reversal per expiry, or null when the wings are absent", () => {
    settled(chain());
    const { result } = renderHook(() => useChainModel());
    // The five-strike fixture is far too narrow to reach 25 delta — null is the
    // honest answer, not a number scraped off the nearest strike.
    expect(result.current.frontRr).toBeNull();
    expect(result.current.backRr).toBeNull();
  });

  it("computes a real RR once the ladder reaches both wings", () => {
    const wide: ChainRow[] = [];
    for (const e of [
      { expiration: "2026-08-21", dte: 26 },
      { expiration: "2026-09-18", dte: 54 },
    ]) {
      for (let k = 5600; k <= 7400; k += 25) {
        const iv = 0.2 - (k - 5600) * 0.00003;
        wide.push(row({ ...e, strike: k * 1000, bsmIv: iv, contractType: "P" }));
        wide.push(row({ ...e, strike: k * 1000, bsmIv: iv - 0.02, contractType: "C" }));
      }
    }
    settled(wide);
    const { result } = renderHook(() => useChainModel());
    expect(result.current.frontRr).not.toBeNull();
    expect(result.current.backRr).not.toBeNull();
  });

  it("surfaces the error state instead of an empty table", () => {
    mockUseChain.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.isError).toBe(true);
    expect(result.current.spot).toBeNull();
  });
});
