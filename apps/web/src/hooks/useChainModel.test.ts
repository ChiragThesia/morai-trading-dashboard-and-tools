/**
 * useChainModel.test.ts — state + wiring for the Analyzer's TWO chain surfaces.
 *
 * BROWSE (surface 1): row = one (root, expiration) cohort, ALL of them, nothing filtered away.
 * Expand a cohort and you get every strike it lists, each priced as a single LEG.
 *
 * PAIR (surface 2): the user picks a front leg and a back leg; only then does calendar math
 * happen — H-Skew, forward IV, edge, net greeks, haircut debit.
 *
 * WHAT THIS HOOK NO LONGER DOES. Grouping, per-leg greeks, the ATM reference and vertical skew
 * used to be computed here off the raw chain. They now arrive solved from GET /api/chain/priced,
 * so most of the tests below are PASSTHROUGH tests: they pin that the hook reports what the
 * server measured rather than re-deriving it, which is the only way a second implementation can
 * come back. The formulas themselves are pinned in `packages/core/src/calendar`.
 *
 * Two things are still computed in the browser and are tested as such: the 25Δ risk reversal
 * (it spans BOTH wings, and this endpoint serves one) and the three odd-pair flags.
 *
 * Still no ranking, no scoring, no "best" anything.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { PricedChainCohort, PricedChainResponse, PricedChainStrike } from "@morai/contracts";
import type { ChainRow } from "../lib/chain-contract.ts";

const { mockUsePricedChain, mockUseChain, mockUseGex } = vi.hoisted(() => ({
  mockUsePricedChain: vi.fn(),
  mockUseChain: vi.fn(),
  mockUseGex: vi.fn(),
}));
vi.mock("./usePricedChain.ts", () => ({ usePricedChain: mockUsePricedChain }));
// The RAW chain is read for ONE thing: the 25Δ risk reversal spans both wings and the priced
// endpoint serves one. Its absence must null that column and nothing else.
vi.mock("./useChain.ts", () => ({ useChain: mockUseChain }));
// GEX is read only for the risk reversal's carry. `resolveCarry` degrades to its flat defaults on
// an absent snapshot, so an undefined-data stub exercises the pre-first-response path.
vi.mock("./useGex.ts", () => ({ useGex: mockUseGex }));

import { useChainModel, legKey } from "./useChainModel.ts";

const SPOT = 6500.25;
const ASOF = "2026-07-26T18:00:00.000Z";

const FRONT = "2026-08-21";
const BACK = "2026-09-18";

/** Years to settlement, as the server sends them — NOT dte/365.25. See `t` below. */
const FRONT_T = 26.68 / 365.25;
const BACK_T = 54.7 / 365.25;

function strike(over: Partial<PricedChainStrike> = {}): PricedChainStrike {
  return {
    strike: 6500,
    iv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 100,
    delta: -0.5,
    gamma: 0.0004,
    theta: -2.9,
    vega: 5.1,
    vSkew: 0,
    ...over,
  };
}

/** One strike the chain quotes and the inversion never solved — greeks null, market intact. */
const GAP = strike({ strike: 6425, iv: null, bid: 58, ask: 60.5, openInterest: 66, delta: null, gamma: null, theta: null, vega: null, vSkew: null });

function cohort(over: Partial<PricedChainCohort> = {}): PricedChainCohort {
  return {
    root: "SPXW",
    expiration: FRONT,
    dte: 26,
    t: FRONT_T,
    atmStrike: 6500,
    atmIv: 0.15,
    strikes: [strike({ strike: 6400, iv: 0.152, vSkew: 0.002 }), GAP, strike()],
    ...over,
  };
}

function surface(over: Partial<PricedChainResponse> = {}): PricedChainResponse {
  return {
    asOf: ASOF,
    spot: SPOT,
    contractType: "P",
    cohorts: [
      cohort(),
      cohort({
        expiration: BACK,
        dte: 54,
        t: BACK_T,
        atmIv: 0.17,
        strikes: [
          strike({ strike: 6400, iv: 0.172, vSkew: 0.002 }),
          strike({ strike: 6425, iv: 0.171, vSkew: 0.001, bid: 58, ask: 60.5, openInterest: 66 }),
          strike({ iv: 0.17, delta: -0.48, gamma: 0.0002, theta: -1.8, vega: 9.4 }),
        ],
      }),
    ],
    ...over,
  };
}

function priced(body: PricedChainResponse | undefined, over: Record<string, unknown> = {}): void {
  mockUsePricedChain.mockReturnValue({
    data: body,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  });
}

/** The raw both-wings chain the risk reversal reads. Deliberately unlike the priced surface. */
function rawRow(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6500_000,
    expiration: FRONT,
    contractType: "P",
    root: "SPXW",
    dte: 26,
    bsmIv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 100,
    underlyingPrice: SPOT,
    source: "schwab",
    observedAt: ASOF,
    ...over,
  };
}

/** A ladder wide enough for both wings to bracket ±25Δ. */
function wideRawChain(): ReadonlyArray<ChainRow> {
  const out: ChainRow[] = [];
  for (let k = 5600; k <= 7400; k += 25) {
    const iv = 0.2 - (k - 5600) * 0.00003;
    out.push(rawRow({ strike: k * 1000, bsmIv: iv, contractType: "P" }));
    out.push(rawRow({ strike: k * 1000, bsmIv: iv - 0.02, contractType: "C" }));
  }
  return out;
}

function raw(rows: ReadonlyArray<ChainRow> | undefined): void {
  mockUseChain.mockReturnValue({ data: rows });
}

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
  it("reports the server's cohorts in the server's order, adding none and dropping none", () => {
    priced(surface());
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.cohorts.map((c) => [c.root, c.expiration])).toEqual([
      ["SPXW", FRONT],
      ["SPXW", BACK],
    ]);
    expect(result.current.cohorts[0]?.dte).toBe(26);
  });

  // The wire carries index points (6400); every other browser module — legKey, strikeLabel,
  // buildTosPairOrder, riskReversalForExpiry — is on the ×1000 integer the raw chain uses.
  // Converting once here is what keeps the two conventions from meeting anywhere else.
  it("scales the wire's index-point strikes back to the ×1000 integer the rest of the app keys on", () => {
    priced(surface());
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(cohortOf(result, FRONT)?.strikes.map((s) => s.strike)).toEqual([
      6400_000, 6425_000, 6500_000,
    ]);
    expect(legKey(cohortOf(result, FRONT)?.strikes[0] ?? { root: "SPXW", expiration: FRONT, contractType: "P", strike: 0 })).toContain("6400000");
  });

  // The strike rows carry no wing of their own — it is on the ENVELOPE, because the endpoint
  // prices one wing per call. Taking it from the toggle's state instead would mislabel every row
  // for the one round trip a wing switch is in flight, and legKey would key them wrong.
  it("stamps each leg with the wing the SERVER priced, not the one the toggle asked for", () => {
    priced(surface({ contractType: "C" }));
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.contractType).toBe("P");
    expect(cohortOf(result, FRONT)?.strikes.every((s) => s.contractType === "C")).toBe(true);
  });

  it("keeps a strike the chain quoted but never priced — greeks dashed, market intact", () => {
    priced(surface());
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    const gap = cohortOf(result, FRONT)?.strikes.find((s) => s.strike === 6425_000);
    expect([gap?.iv, gap?.delta, gap?.gamma, gap?.theta, gap?.vega, gap?.vSkew]).toEqual([
      null, null, null, null, null, null,
    ]);
    // A gap is not a deletion.
    expect([gap?.bid, gap?.ask, gap?.openInterest]).toEqual([58, 60.5, 66]);
  });

  // PASSTHROUGH, and the fixture proves it: this cohort's atmIv is 0.15 and the 6400 leg's IV is
  // 0.152, so a browser that re-derived `iv − atmIv` would report 0.002 — which is also what the
  // server sent, so that alone proves nothing. The 6425 gap row is the discriminator: it has no
  // IV, and its vSkew is null on both stories. So the real pin is the ATM IV, which is the
  // server's own quoted-ladder answer and is NOT recoverable from the rows on screen.
  it("reports the server's vertical skew and ATM reference rather than re-deriving them", () => {
    const s = surface();
    const front = s.cohorts[0];
    if (front === undefined) throw new Error("fixture");
    priced({
      ...s,
      // atmStrike 6425 never solved, so the ATM IV is null — and the server still names the
      // strike. A browser re-deriving `iv − atmIv` would have to null every vSkew in the cohort;
      // these rows keep theirs, because they are the server's numbers, not a local subtraction.
      cohorts: [{ ...front, atmStrike: 6425, atmIv: null }, ...s.cohorts.slice(1)],
    });
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(cohortOf(result, FRONT)?.atmIv).toBeNull();
    expect(cohortOf(result, FRONT)?.strikes.find((s2) => s2.strike === 6400_000)?.vSkew).toBe(0.002);
  });

  it("computes the 25Δ risk reversal in the browser, off the RAW both-wings chain", () => {
    priced(surface());
    raw(wideRawChain());
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    // The priced surface's own ladder is three strikes wide and could never bracket ±25Δ. This
    // number can only have come from the raw chain.
    expect(cohortOf(result, FRONT)?.riskReversal).not.toBeNull();
  });

  it("nulls the risk reversal when the raw chain has not arrived, and shows the table anyway", () => {
    priced(surface());
    raw(undefined);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.cohorts).toHaveLength(2);
    expect(cohortOf(result, FRONT)?.riskReversal).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // The header's spot and "observed" stamp must describe the SAME snapshot the greeks were priced
  // on. The raw rows here carry a different spot and a different instant on purpose: reading
  // rows[0] would report one number while every greek on screen came off another.
  it("reports the priced snapshot's own spot and instant, never the raw chain's first row", () => {
    priced(surface());
    raw([rawRow({ underlyingPrice: 1, observedAt: "2026-07-26T17:00:00.000Z" })]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.spot).toBe(SPOT);
    expect(result.current.observedAt).toBe(ASOF);
  });

  // The engine seeds its `asOf` reduce with `new Date(0)`, so an empty chain — a cold start, or a
  // snapshot with no usable spot — comes off the wire stamped 1970-01-01, and it is a valid
  // `z.string().datetime()`, so nothing upstream rejects it. `Analyzer.tsx` keys both the text and
  // the dash-vs-secondary colour off this being null, so passing it through would print a 1969 ET
  // timestamp in the header above the "Chain warming up" panel. A surface with no rows observed
  // nothing; zero and no-data are different facts here too.
  it("reports NO observation instant when the surface carries no cohorts", () => {
    priced({ asOf: "1970-01-01T00:00:00.000Z", spot: null, contractType: "P", cohorts: [] });
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainModel());
    expect(result.current.cohorts).toEqual([]);
    expect(result.current.observedAt).toBeNull();
    expect(result.current.spot).toBeNull();
  });

  it("takes its load and error states from the priced query", () => {
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    priced(undefined, { isPending: true });
    const loading = renderHook(() => useChainModel());
    expect(loading.result.current.isLoading).toBe(true);
    expect(loading.result.current.cohorts).toEqual([]);
    expect(loading.result.current.pair).toBeNull();

    cleanup();
    priced(undefined, { isError: true });
    const errored = renderHook(() => useChainModel());
    expect(errored.result.current.isError).toBe(true);
    expect(errored.result.current.spot).toBeNull();
  });
});

// ─── Surface 2: Pair ──────────────────────────────────────────────────────────

describe("useChainModel — the picked pair", () => {
  function setup(body: PricedChainResponse = surface()) {
    priced(body);
    raw([]);
    mockUseGex.mockReturnValue({ data: undefined });
    return renderHook(() => useChainModel());
  }

  /** Pick 6500 in the front expiry and 6500 in the back. */
  function pick(result: { current: ReturnType<typeof useChainModel> }): void {
    const front = cohortOf(result, FRONT)?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, BACK)?.strikes.find((s) => s.strike === 6500_000);
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
    const { result } = setup();
    expect(result.current.pair).toBeNull();
    expect(result.current.frontLeg).toBeNull();

    const front = cohortOf(result, FRONT)?.strikes[0];
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    expect(result.current.frontLeg).not.toBeNull();
    expect(result.current.pair).toBeNull();
  });

  it("computes the calendar math once both legs are picked", () => {
    const { result } = setup();
    pick(result);

    const pair = result.current.pair;
    expect(pair).not.toBeNull();
    // H-Skew is front − back: 0.15 − 0.17. NEGATIVE means the BACK month is the rich one, the
    // wrong way round for a calendar seller. Do not flip it to look friendlier.
    expect(pair?.hSkew).toBeCloseTo(-0.02, 12);
    // Net greeks are back − front: long the back, short the front.
    expect(pair?.netDelta).toBeCloseTo(0.02, 12);
    expect(pair?.netGamma).toBeCloseTo(-0.0002, 12);
    expect(pair?.netTheta).toBeCloseTo(1.1, 12);
    expect(pair?.netVega).toBeCloseTo(4.3, 12);
    // Both legs quote 40/42, so the MIDS cancel — the debit is not 0 because the ORATS haircut
    // crosses 66% of each width on the natural side: buy back at 40 + .66×2, sell front at
    // 42 − .66×2.
    expect(pair?.debit).toBeCloseTo(0.64, 12);
  });

  // THE CLOCK. The old browser copy fed `computeFwdIv` whole DTE days; the server sends `t`,
  // years to the settlement instant, and it is not a uniform rescale of dte — AM settlement lands
  // before the expiry day's UTC midnight and PM after it, so the forward vol genuinely moves.
  it("measures the forward vol on the settlement clock the server sent, not on whole DTE days", () => {
    const { result } = setup();
    pick(result);
    const expected = Math.sqrt(
      (BACK_T * 0.17 * 0.17 - FRONT_T * 0.15 * 0.15) / (BACK_T - FRONT_T),
    );
    expect(result.current.pair?.fwdIv ?? 0).toBeCloseTo(expected, 12);
    expect(result.current.pair?.edge ?? 0).toBeCloseTo(0.15 - expected, 12);
    // The whole-day answer differs — the fixture's t values are not dte/365.25, exactly as a
    // settlement clock is not.
    const wholeDay = Math.sqrt((54 * 0.17 * 0.17 - 26 * 0.15 * 0.15) / (54 - 26));
    expect(result.current.pair?.fwdIv).not.toBe(wholeDay);
  });

  // Two roots on ONE date: SPX settles 09:30 ET, SPXW 16:00 ET, so their DTE is identical and
  // their `t` is not. Flagging "no window between them" off dte would contradict the fwd IV and
  // edge printed directly above it.
  it("flags 'back not later' off the settlement clock, so a same-date AM/PM pair still measures", () => {
    const amFront = cohort({ root: "SPX", expiration: BACK, dte: 54, t: BACK_T - 0.0007, atmIv: 0.17, strikes: [strike({ iv: 0.16 })] });
    const pmBack = cohort({ root: "SPXW", expiration: BACK, dte: 54, t: BACK_T, atmIv: 0.17, strikes: [strike({ iv: 0.17 })] });
    const { result } = setup(surface({ cohorts: [amFront, pmBack] }));

    const front = cohortOf(result, BACK, "SPX")?.strikes[0];
    const back = cohortOf(result, BACK, "SPXW")?.strikes[0];
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
    expect(result.current.pair?.front.dte).toBe(result.current.pair?.back.dte);
    expect(result.current.pair?.backNotLater).toBe(false);
    expect(result.current.pair?.fwdIv).not.toBeNull();
  });

  it("flags a pair whose back leg is not strictly later, and refuses a TOS line for it", () => {
    const { result } = setup();
    // Deliberately inverted: the back expiry as the front.
    const later = cohortOf(result, BACK)?.strikes.find((s) => s.strike === 6500_000);
    const earlier = cohortOf(result, FRONT)?.strikes.find((s) => s.strike === 6500_000);
    act(() => {
      if (later !== undefined) result.current.pickFront(later);
    });
    act(() => {
      if (earlier !== undefined) result.current.pickBack(earlier);
    });

    expect(result.current.pair?.backNotLater).toBe(true);
    expect(result.current.pair?.fwdIv).toBeNull();
    expect(result.current.pair?.edge).toBeNull();
    // parseTosOrder SORTS the two dates, so emitting a line here would silently re-label the pair
    // as a valid calendar — a plausible wrong read of what the user picked.
    expect(result.current.pair?.tosOrder).toBeNull();
  });

  // A Front/Back button sits on every ladder row, gaps included — 24.4% of the live put wing on
  // 2026-07-28. Everything derived from an IV dashes; the DEBIT does not, because bid and ask are
  // real on a strike that never priced, and that is the number you would actually pay.
  it("dashes every derived field on an unpriced leg but still quotes the debit and the order", () => {
    const { result } = setup();
    const front = cohortOf(result, FRONT)?.strikes.find((s) => s.strike === 6425_000);
    const back = cohortOf(result, BACK)?.strikes.find((s) => s.strike === 6425_000);
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });

    const pair = result.current.pair;
    expect(pair).not.toBeNull();
    expect([pair?.hSkew, pair?.fwdIv, pair?.edge]).toEqual([null, null, null]);
    expect([pair?.netDelta, pair?.netGamma, pair?.netTheta, pair?.netVega]).toEqual([
      null, null, null, null,
    ]);
    // buy the back at 58 + .66×2.5 = 59.65; sell the front at 60.5 − .66×2.5 = 58.85.
    expect(pair?.debit).toBeCloseTo(0.8, 10);
    expect(pair?.tosOrder).toContain("@0.80");
  });

  it("emits a TOS order line for a well-formed pair", () => {
    const { result } = setup();
    pick(result);
    // Back expiry first, then the front — the long-calendar convention.
    expect(result.current.pair?.tosOrder).toContain("18 SEP 26");
    expect(result.current.pair?.tosOrder).toContain("6500 PUT");
    // The model must pass the ROOT through, not just the dates. Sep 18 2026 IS a third Friday, so
    // a root-blind builder tags it [AM] — wrong for SPXW, which is always PM-settled, and it
    // selects the wrong contract in TOS. Caught in live UAT.
    expect(result.current.pair?.tosOrder).not.toContain("[AM]");
    expect(result.current.pair?.tosOrder?.indexOf("18 SEP 26")).toBeLessThan(
      result.current.pair?.tosOrder?.indexOf("21 AUG 26") ?? -1,
    );
  });

  it("flags a cross-root pair — the math is real, but it spans two different books", () => {
    const spx = cohort({ root: "SPX", expiration: BACK, dte: 54, t: BACK_T, atmIv: 0.17, strikes: [strike({ iv: 0.17 })] });
    const { result } = setup(surface({ cohorts: [cohort(), spx] }));
    const front = cohortOf(result, FRONT, "SPXW")?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, BACK, "SPX")?.strikes[0];
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
    expect(result.current.pair?.rootMismatch).toBe(true);
    // Flagged, not suppressed: the user picked both legs by hand.
    expect(result.current.pair?.hSkew).toBeCloseTo(-0.02, 12);
    expect(result.current.pair?.tosOrder).toBeNull();
  });

  it("flags a different-strike pair as a diagonal, not a calendar", () => {
    const { result } = setup();
    const front = cohortOf(result, FRONT)?.strikes.find((s) => s.strike === 6500_000);
    const back = cohortOf(result, BACK)?.strikes.find((s) => s.strike === 6400_000);
    act(() => {
      if (front !== undefined) result.current.pickFront(front);
    });
    act(() => {
      if (back !== undefined) result.current.pickBack(back);
    });
    expect(result.current.pair?.diagonal).toBe(true);
    expect(result.current.pair?.rootMismatch).toBe(false);
  });

  // A put front against a call back is not a calendar at all. The picks are per-leg, so the wing
  // switch has to clear them; otherwise picking a put, toggling, and picking a call builds exactly
  // the mixed-wing pair the exit advisor shipped once.
  it("clears the pair when the wing switches, so a mixed-wing pair is unreachable", () => {
    const { result } = setup();
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
    const { result } = setup();
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
    const { result, rerender } = setup();
    pick(result);
    expect(result.current.pair?.front.iv).toBeCloseTo(0.15, 12);

    const s = surface();
    const front = s.cohorts[0];
    if (front === undefined) throw new Error("fixture");
    priced({
      ...s,
      cohorts: [
        { ...front, strikes: front.strikes.map((r) => (r.strike === 6500 ? { ...r, iv: 0.19 } : r)) },
        ...s.cohorts.slice(1),
      ],
    });
    rerender();
    expect(result.current.pair?.front.iv).toBeCloseTo(0.19, 12);
    // …and the derived math moved with it: 0.19 − 0.17 is now POSITIVE, front-rich.
    expect(result.current.pair?.hSkew).toBeCloseTo(0.02, 12);
  });

  it("drops a picked leg that left the chain entirely", () => {
    const { result, rerender } = setup();
    pick(result);
    expect(result.current.pair).not.toBeNull();

    const s = surface();
    const back = s.cohorts[1];
    if (back === undefined) throw new Error("fixture");
    priced({
      ...s,
      cohorts: [
        ...s.cohorts.slice(0, 1),
        { ...back, strikes: back.strikes.filter((r) => r.strike !== 6500) },
      ],
    });
    rerender();
    expect(result.current.backLeg).toBeNull();
    expect(result.current.pair).toBeNull();
    // The surviving front pick is untouched — one leg leaving is not a reason to forget both.
    expect(result.current.frontLeg).not.toBeNull();
  });
});

describe("legKey", () => {
  it("includes root, wing, expiration and strike — the full row identity", () => {
    const base = { root: "SPXW", expiration: FRONT, contractType: "P", strike: 6500_000 } as const;
    const key = legKey(base);
    expect(key).toContain("SPXW");
    expect(key).toContain(FRONT);
    expect(key).toContain("P");
    expect(key).toContain("6500000");
    // Each of the four fields alone must be enough to change the key. Dropping any one of them is
    // how 242 rows collided on one React key in production.
    expect(legKey({ ...base, root: "SPX" })).not.toBe(key);
    expect(legKey({ ...base, contractType: "C" })).not.toBe(key);
    expect(legKey({ ...base, expiration: BACK })).not.toBe(key);
    expect(legKey({ ...base, strike: 6400_000 })).not.toBe(key);
  });
});
