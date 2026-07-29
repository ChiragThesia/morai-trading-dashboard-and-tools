/**
 * Analyzer.test.tsx — the option-chain DATA TABLE screen.
 *
 * Adapted from the picker suite. The scoring-specific blocks (verdict hero, the
 * rule-registry checklist, the ranked CandidateRail, the WHY column, the
 * desktop-grid and desktop/mobile-branch suites) are DELETED with the UI they
 * covered. Everything that was really about rendering and interaction — the
 * table, the paste flow, the payoff wiring, copy-TOS, the five load states and
 * the live badge — survives here, re-pointed at the chain.
 *
 * apps/web does not use msw: the RPC layer is mocked instead.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { AnalyzeAdHocCalendarResponse } from "@morai/contracts";
import type { UseLiveStreamResult } from "../hooks/useLiveStream.ts";
import type { PricedChainCohort, PricedChainResponse } from "@morai/contracts";
import type { ChainRow } from "../lib/chain-contract.ts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

// useAnalyzerModel calls useLiveStream — without this mock every render would open a
// real EventSource (green-suite protection).
const { mockUseLiveStream } = vi.hoisted(() => ({
  mockUseLiveStream: vi.fn((): UseLiveStreamResult => ({
    greeks: new Map(),
    status: "quiet",
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot: null,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../hooks/useLiveStream.ts", () => ({
  useLiveStream: mockUseLiveStream,
  // LiveStatusBadge.tsx imports this const at module-load time — must be mocked alongside
  // the hook or the tree crashes as soon as it mounts the badge.
  STALL_THRESHOLD_MS: 20_000,
}));

// The PRICED chain — the surface the table renders. Mocked at the hook, so no
// QueryClientProvider is needed. Every load state on this screen comes off this query.
const { mockUsePricedChain } = vi.hoisted(() => ({ mockUsePricedChain: vi.fn() }));
vi.mock("../hooks/usePricedChain.ts", () => ({ usePricedChain: mockUsePricedChain }));

// The RAW chain — read for the 25Δ risk reversal alone (it spans both wings; the priced endpoint
// serves one). It must never gate the table, which is why it has no load state here.
const { mockUseChain } = vi.hoisted(() => ({ mockUseChain: vi.fn() }));
vi.mock("../hooks/useChain.ts", () => ({ useChain: mockUseChain }));

// useChainModel reads GEX only for the risk reversal's carry (r, q). `resolveCarry` falls back to
// its flat defaults on an absent snapshot, so an undefined-data stub exercises the same path the
// app takes before the first GEX response lands — and keeps this suite off a QueryClient.
const { mockUseGex } = vi.hoisted(() => ({ mockUseGex: vi.fn() }));
vi.mock("../hooks/useGex.ts", () => ({ useGex: mockUseGex }));
mockUseGex.mockReturnValue({ data: undefined });

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockRepull } = vi.hoisted(() => ({
  mockRepull: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false })),
}));
vi.mock("../hooks/useRepullChains.ts", () => ({ useRepullChains: mockRepull }));

const { mockAnalyzeCalendarMutateAsync } = vi.hoisted(() => ({
  mockAnalyzeCalendarMutateAsync: vi.fn(
    (): Promise<AnalyzeAdHocCalendarResponse> =>
      Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
  ),
}));
const { mockAnalyzePending } = vi.hoisted(() => ({ mockAnalyzePending: { value: false } }));
vi.mock("../hooks/useAnalyzeCalendar.ts", () => ({
  useAnalyzeCalendar: () => ({
    mutateAsync: mockAnalyzeCalendarMutateAsync,
    isPending: mockAnalyzePending.value,
  }),
}));

import { Analyzer } from "./Analyzer.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import type { PayoffChartProps } from "../components/charts/PayoffChart.tsx";
import { buildTosCalendarOrder } from "../lib/tos-order.ts";
import { candidateToAnalyzerPosition } from "../lib/candidate-to-position.ts";
import { repriceScenario } from "../lib/scenario-engine.ts";
import type { ScenarioParams } from "../lib/scenario-engine.ts";
import { computePayoffDomain } from "../lib/payoff-domain.ts";
import { parseTosOrder } from "../lib/tos-parser.ts";
import { parsedCalendarToPickerCandidate } from "../lib/parsed-calendar-to-candidate.ts";

const mockPayoffChart = vi.mocked(PayoffChart);

function latestPayoffChartProps(): PayoffChartProps {
  const call = mockPayoffChart.mock.calls.at(-1);
  assertDefined(call, "PayoffChart rendered at least once");
  return call[0];
}

// ─── Chain fixture ────────────────────────────────────────────────────────────

const SPOT = 7498.85;
const OBSERVED = "2026-07-26T18:00:00.000Z";
const FRONT = { expiration: "2026-08-21", dte: 26 };
const BACK = { expiration: "2026-09-18", dte: 54 };

function chainRow(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 7500_000,
    expiration: FRONT.expiration,
    contractType: "P",
    root: "SPXW",
    dte: FRONT.dte,
    bsmIv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 500,
    underlyingPrice: SPOT,
    source: "schwab",
    observedAt: OBSERVED,
    ...over,
  };
}

const STRIKES = [7400, 7450, 7500, 7550, 7600];

function chainFixture(): ReadonlyArray<ChainRow> {
  const out: ChainRow[] = [];
  for (const e of [
    { ...FRONT, base: 0.15 },
    { ...BACK, base: 0.17 },
  ]) {
    for (const k of STRIKES) {
      const iv = e.base + (7500 - k) * 0.00002;
      out.push(
        chainRow({ strike: k * 1000, expiration: e.expiration, dte: e.dte, bsmIv: iv, contractType: "P" }),
      );
      out.push(
        chainRow({
          strike: k * 1000,
          expiration: e.expiration,
          dte: e.dte,
          bsmIv: iv - 0.005,
          contractType: "C",
          root: "SPXW",
        }),
      );
    }
  }
  return out;
}

/** The raw chain, for the risk-reversal column only. No load state — it never gates the table. */
function mockChainReturn(rows: ReadonlyArray<ChainRow> | undefined = chainFixture()): void {
  mockUseChain.mockReturnValue({ data: rows });
}

// ─── Priced-surface fixture ───────────────────────────────────────────────────
//
// The same book as `chainFixture`, in the shape GET /api/chain/priced returns it: grouped into
// cohorts, greeks and vertical skew already solved, strikes in INDEX POINTS rather than ×1000.
// `t` is deliberately NOT `dte / 365.25` — it is years to the settlement instant, which is the
// clock the pair math runs on.

const PRICED_FRONT = { ...FRONT, t: 26.68 / 365.25, base: 0.15 };
const PRICED_BACK = { ...BACK, t: 54.7 / 365.25, base: 0.17 };

function pricedCohort(
  e: { expiration: string; dte: number; t: number; base: number },
  wing: "C" | "P",
  strikes: ReadonlyArray<number>,
): PricedChainCohort {
  const ivAt = (k: number): number => e.base + (7500 - k) * 0.00002 - (wing === "C" ? 0.005 : 0);
  const atmStrike = strikes.includes(7500) ? 7500 : (strikes[0] ?? null);
  const atmIv = atmStrike === null ? null : ivAt(atmStrike);
  return {
    root: "SPXW",
    expiration: e.expiration,
    dte: e.dte,
    t: e.t,
    atmStrike,
    atmIv,
    strikes: strikes.map((k) => ({
      strike: k,
      iv: ivAt(k),
      bid: 40,
      ask: 42,
      openInterest: 500,
      delta: -0.5,
      gamma: 0.0004,
      theta: -2.9,
      vega: 5.1,
      vSkew: atmIv === null ? null : ivAt(k) - atmIv,
    })),
  };
}

function pricedFixture(
  wing: "C" | "P" = "P",
  frontStrikes: ReadonlyArray<number> = STRIKES,
  backStrikes: ReadonlyArray<number> = STRIKES,
): PricedChainResponse {
  return {
    asOf: OBSERVED,
    spot: SPOT,
    contractType: wing,
    cohorts: [
      pricedCohort(PRICED_FRONT, wing, frontStrikes),
      pricedCohort(PRICED_BACK, wing, backStrikes),
    ],
  };
}

/**
 * The priced query's return. Keyed on the WING the hook was called with, because the endpoint
 * serves one wing per call and the put/call toggle is a refetch — a fixed return value would make
 * the toggle look like it changed nothing.
 */
function mockPricedReturn(
  overrides: Partial<{
    data: PricedChainResponse | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: () => void;
  }> = {},
  build: (wing: "C" | "P") => PricedChainResponse | undefined = (wing) => pricedFixture(wing),
): void {
  mockUsePricedChain.mockImplementation((wing: "C" | "P") => ({
    data: build(wing),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }));
}

function mockUsePickerReturn(overrides: Record<string, unknown> = {}): void {
  mockUsePicker.mockReturnValue({
    data: pickerSnapshotFixture,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

/** The Analyzer's fixed scenario params — spot comes from the picker snapshot when quiet. */
const PARAMS: ScenarioParams = {
  spot: pickerSnapshotFixture.spot,
  daysForward: 0,
  ivShift: 0,
  rate: 0.045,
  divYield: 0.013,
};

beforeEach(() => {
  mockPricedReturn();
  mockChainReturn();
  mockUsePickerReturn();
  mockAnalyzePending.value = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Chain table ──────────────────────────────────────────────────────────────

describe("Analyzer — chain browse", () => {
  it("renders one row per (root, expiration) cohort, nearest expiry first", () => {
    render(<Analyzer />);
    const rows = screen.getAllByTestId(/^chain-cohort-/);
    // Cohort identity is root + expiration, never expiration alone: SPX and SPXW quote the same
    // strikes on the same dates out of different books.
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      `chain-cohort-SPXW-${FRONT.expiration}`,
      `chain-cohort-SPXW-${BACK.expiration}`,
    ]);
  });

  // CELL RENDERING IS NOT TESTED HERE. Per-cell IV/skew/greek values, the em-dash-never-zero
  // rule, sort direction and the pick buttons all live in `components/chain/ChainBrowse.test.tsx`
  // and `ChainPair.test.tsx`, which own the components that render them. Duplicating their
  // formatting assertions in a screen test means two places to update for one change.
  //
  // This suite's job is WIRING: does the model reach the surfaces, and does the screen react to
  // the model. The V-Skew wing/root constraint — the defect class that renders a plausible wrong
  // number rather than a gap — is covered on the model side in `useChainModel.test.ts`.

  it("only one cohort's strike ladder is open at a time", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`));
    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${BACK.expiration}`));
    expect(screen.getByTestId(`chain-strikes-SPXW-${BACK.expiration}`)).toBeTruthy();
    expect(screen.queryByTestId(`chain-strikes-SPXW-${FRONT.expiration}`)).toBeNull();
  });

  it("shows every strike the cohort quotes, with no join to hide one", () => {
    // The old table joined two expiries and emitted only the overlap. Front-month strikes below
    // 7500 and back-month strikes above it means ZERO overlap — the old shape rendered nothing.
    mockPricedReturn({}, (wing) =>
      pricedFixture(wing, [7400, 7450], [7550, 7600]),
    );
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`));
    const ladder = screen.getByTestId(`chain-strikes-SPXW-${FRONT.expiration}`);
    // 7400 and 7450 are quoted in August and NOT in September. They have rows.
    expect(ladder.querySelectorAll("tr[data-testid^='chain-leg-']").length).toBe(2);
  });

  it("proposes nothing — no verdict, no score, no ranked rail", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("verdict-hero")).toBeNull();
    expect(screen.queryByTestId("verdict-word")).toBeNull();
    expect(screen.queryByTestId("verdict-score")).toBeNull();
    expect(screen.queryByText("Suggested calendars")).toBeNull();
    expect(screen.queryByText("Why this calendar")).toBeNull();
    expect(screen.queryAllByTestId(/^candidate-row-/)).toEqual([]);
  });
});

// ─── Chain header + the pair hand-off ─────────────────────────────────────────

describe("Analyzer — chain header and the picked pair", () => {
  /** Open a cohort and pick its 7500 strike into the given slot. */
  function pickLeg(expiration: string, slot: "front" | "back"): void {
    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${expiration}`));
    fireEvent.click(screen.getByTestId(`pick-${slot}-SPXW|${expiration}|P|7500000`));
  }

  it("reports spot, the observation instant, and how many expiries are on offer", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("chain-spot").textContent).toBe(SPOT.toFixed(2));
    expect(screen.getByTestId("chain-observed").textContent).toContain("ET");
    expect(screen.getByTestId("chain-expiry-count").textContent).toBe("2");
  });

  it("switches the browse surface between puts and calls", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`));
    expect(screen.getByTestId(`chain-leg-SPXW|${FRONT.expiration}|P|7500000`).textContent).toContain(
      "15.00%",
    );
    expect(screen.queryByTestId(`chain-leg-SPXW|${FRONT.expiration}|C|7500000`)).toBeNull();

    fireEvent.click(screen.getByTestId("chain-type-call"));

    // The open cohort STAYS open across a wing switch — you were looking at this expiry, and you
    // still are. Only the legs inside it change side.
    expect(screen.queryByTestId(`chain-leg-SPXW|${FRONT.expiration}|P|7500000`)).toBeNull();
    expect(screen.getByTestId(`chain-leg-SPXW|${FRONT.expiration}|C|7500000`).textContent).toContain(
      "14.50%",
    );
  });

  it("shows the pair prompt until both legs are picked, then the calendar math", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("chain-pair-empty")).toBeTruthy();

    pickLeg(FRONT.expiration, "front");
    // One leg is not a calendar.
    expect(screen.getByTestId("chain-pair-empty")).toBeTruthy();

    pickLeg(BACK.expiration, "back");
    expect(screen.queryByTestId("chain-pair-empty")).toBeNull();
    // H-Skew = front − back = 0.15 − 0.17 = −2.00 vol points. Negative means the BACK month is
    // the rich one, which is the wrong way round for a calendar seller — and that is the honest
    // reading of this fixture, not a bug.
    expect(screen.getByTestId("chain-pair-hskew").textContent).toContain("−2.00");
  });

  it("hands the picked pair's TOS order into the Risk profile paste box", () => {
    render(<Analyzer />);
    pickLeg(FRONT.expiration, "front");
    pickLeg(BACK.expiration, "back");

    fireEvent.click(screen.getByTestId("chain-pair-send"));

    // Filled, not auto-analyzed: the order line is what gets priced, so it stays visible and
    // editable (qty, limit) before Analyze runs.
    const input = screen.getByTestId("picker-paste-input");
    expect(input).toHaveProperty("value", expect.stringContaining("7500 PUT"));
    expect(input).toHaveProperty("value", expect.stringContaining("18 SEP 26"));
  });

  it("clears the picked pair when the wing switches — no mixed-wing calendar", () => {
    render(<Analyzer />);
    pickLeg(FRONT.expiration, "front");
    pickLeg(BACK.expiration, "back");
    expect(screen.queryByTestId("chain-pair-empty")).toBeNull();

    fireEvent.click(screen.getByTestId("chain-type-call"));

    // A put front against a call back is not a calendar at all — the picks cannot survive.
    expect(screen.getByTestId("chain-pair-empty")).toBeTruthy();
  });

  it("shows each cohort's own 25Δ RR, em-dashing a ladder too narrow to reach either wing", () => {
    render(<Analyzer />);
    const aug = screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`);
    // The five-strike fixture cannot bracket ±25Δ. A dash, not a zero.
    expect(aug.textContent).toContain("—");
  });

  it("shows a real 25Δ RR once a cohort's ladder reaches both wings", () => {
    const wide: ChainRow[] = [];
    for (const e of [FRONT, BACK]) {
      for (let k = 6600; k <= 8400; k += 25) {
        const iv = 0.2 - (k - 6600) * 0.00003;
        wide.push(chainRow({ ...e, strike: k * 1000, bsmIv: iv, contractType: "P" }));
        wide.push(chainRow({ ...e, strike: k * 1000, bsmIv: iv - 0.02, contractType: "C" }));
      }
    }
    mockChainReturn(wide);
    render(<Analyzer />);

    expect(screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`).textContent).toMatch(/[+−]\d/);
  });
});

// ─── Five load states ─────────────────────────────────────────────────────────

describe("Analyzer — chain load states", () => {
  it("loading: text-only 'Loading chain…' when isPending && data === undefined", () => {
    mockPricedReturn({ data: undefined, isPending: true });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-loading").textContent).toBe("Loading chain…");
    expect(screen.queryByTestId("chain-error")).toBeNull();
    expect(screen.queryByTestId("chain-cold-start")).toBeNull();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("error: shows the failure copy and a Retry that calls refetch()", () => {
    const refetch = vi.fn();
    mockPricedReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-error").textContent).toContain("Couldn't load the chain.");
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("cold start: settled with no expiries shows 'Chain warming up'", () => {
    // Also the shape the engine returns when the snapshot carried no usable spot: it refuses to
    // price a cohort against a price the index never traded at, so `cohorts` is empty and this
    // panel is what the reader gets — not a table of dashes.
    mockPricedReturn({ data: { asOf: OBSERVED, spot: null, contractType: "P", cohorts: [] } });
    render(<Analyzer />);

    const cold = screen.getByTestId("chain-cold-start");
    expect(cold.textContent).toContain("Chain warming up");
    expect(screen.queryAllByTestId(/^chain-cohort-/)).toEqual([]);
  });

  // There is no "no overlapping strikes" state any more. That state existed only because the old
  // table joined two expiries; nothing is joined now, so a chain with expiries always has rows.
  it("populated: the cohort list renders and no other state does", () => {
    render(<Analyzer />);
    expect(screen.getAllByTestId(/^chain-cohort-/).length).toBe(2);
    expect(screen.queryByTestId("chain-loading")).toBeNull();
    expect(screen.queryByTestId("chain-error")).toBeNull();
    expect(screen.queryByTestId("chain-cold-start")).toBeNull();
  });

  // WHO DROPS AN EXPIRED COHORT MOVED. The browser used to filter `dte < 0` itself; the engine
  // does it now, against the settlement instant rather than a calendar day, and it is pinned in
  // `packages/core/src/calendar/domain/cohort.test.ts`. What this screen must guarantee instead
  // is that it adds no filter of its OWN — every cohort the server sends gets a row, because a
  // hidden filter is the defect the whole surface exists to remove.
  it("renders every cohort the server sends and filters none of them itself", () => {
    const third = pricedCohort({ expiration: "2026-10-16", dte: 82, t: 82.7 / 365.25, base: 0.18 }, "P", STRIKES);
    mockPricedReturn({}, (wing) => ({ ...pricedFixture(wing), cohorts: [...pricedFixture(wing).cohorts, third] }));
    render(<Analyzer />);
    expect(screen.getAllByTestId(/^chain-cohort-/).map((r) => r.getAttribute("data-testid"))).toEqual([
      `chain-cohort-SPXW-${FRONT.expiration}`,
      `chain-cohort-SPXW-${BACK.expiration}`,
      "chain-cohort-SPXW-2026-10-16",
    ]);
  });

  it("state precedence: loading wins over isError being simultaneously true", () => {
    mockPricedReturn({ data: undefined, isPending: true, isError: true });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-loading")).toBeTruthy();
    expect(screen.queryByTestId("chain-error")).toBeNull();
  });

  it("the Re-pull control stays usable in every state", () => {
    mockPricedReturn({ data: undefined, isPending: true });
    render(<Analyzer />);
    expect(screen.getByTestId("repull-chains-button")).toBeTruthy();
  });
});

// ─── Pasted calendars ─────────────────────────────────────────────────────────

describe("Analyzer — pasted calendars (multi-paste)", () => {
  afterEach(() => {
    mockAnalyzeCalendarMutateAsync.mockImplementation(() =>
      Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
    );
  });

  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";
  const PASTE_EXAMPLE_2 =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7500 PUT @52.10 LMT GTC";
  const PASTE_EXAMPLE_CALL =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7600 CALL @38.20 LMT GTC";

  async function paste(text: string): Promise<void> {
    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("picker-paste-analyze"));
      await Promise.resolve();
    });
  }

  it("mounts the paste input in the Risk profile panel", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("picker-paste-input")).toBeTruthy();
    expect(screen.getByTestId("picker-paste-analyze")).toBeTruthy();
  });

  it("with nothing pasted the payoff panel says so instead of charting a fabricated calendar", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("payoff-empty")).toBeTruthy();
    expect(screen.queryByTestId("risk-profile-selected-name")).toBeNull();
  });

  it("Analyze on a valid paste adds a calendar, auto-selects it, and clears the input", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    expect(screen.getByTestId("pasted-row-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    expect(screen.getByTestId("picker-paste-input")).toHaveProperty("value", "");
    expect(mockAnalyzeCalendarMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ putCall: "P", strike: 7450 }),
    );
  });

  it("a second Analyze adds a second calendar and auto-selects the new one", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    expect(screen.getByTestId("pasted-row-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("pasted-row-pasted-2")).toBeTruthy();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7500P · pasted");
  });

  it("the pasted calendar drives the payoff chart through candidate→position→repriceScenario", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const positions = [candidateToAnalyzerPosition(parsedCalendarToPickerCandidate(parsed, "pasted-1"))];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);

    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
    expect(props.todayCurveColor).toBe("#5b9cf6");
    expect(props.expirationCurveColor).toBe("#a78bfa");
    expect(props.rollCurve).toBeNull();
  });

  it("selecting a different pasted calendar re-prices against it", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    fireEvent.click(screen.getByTestId("pasted-row-pasted-1"));

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const positions = [candidateToAnalyzerPosition(parsedCalendarToPickerCandidate(parsed, "pasted-1"))];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);
    expect(latestPayoffChartProps().todayCurve).toEqual(expected.payoffCurve);
  });

  it("shows the parse-error copy on unreadable text without disturbing existing calendars", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste("not an order");

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    expect(screen.getByTestId("pasted-row-pasted-1")).toBeTruthy();
    expect(screen.queryByTestId("pasted-row-pasted-2")).toBeNull();
  });

  it("× removes just that calendar, clears its combine state, and falls back to the first remaining", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    fireEvent.click(screen.getByTestId("pasted-combine-pasted-2"));

    fireEvent.click(screen.getByTestId("pasted-remove-pasted-2"));

    expect(screen.queryByTestId("pasted-row-pasted-2")).toBeNull();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    expect(screen.queryByTestId("combined-book-summary")).toBeNull();
  });

  it("removing a calendar that is NOT selected leaves the selection untouched", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    fireEvent.click(screen.getByTestId("pasted-row-pasted-1"));

    fireEvent.click(screen.getByTestId("pasted-remove-pasted-2"));

    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
  });

  it("⊕ Combine sums both debits into one book payoff and summary", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    fireEvent.click(screen.getByTestId("pasted-combine-pasted-1"));

    const parsed1 = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    const parsed2 = parseTosOrder(PASTE_EXAMPLE_2, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed1 === null || parsed2 === null) throw new Error("expected both examples to parse");
    const c1 = parsedCalendarToPickerCandidate(parsed1, "pasted-1");
    const c2 = parsedCalendarToPickerCandidate(parsed2, "pasted-2");

    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toContain("+ 1 more");
    expect(summary.textContent).toContain(`$${Math.round(c1.debit + c2.debit)}`);

    // The chart itself is the SUM, through the one engine.
    const positions = [candidateToAnalyzerPosition(c2), candidateToAnalyzerPosition(c1)];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);
    expect(latestPayoffChartProps().todayCurve).toEqual(expected.payoffCurve);
  });

  it("toggling ⊕ Combine off returns to the selected-only curve", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    const combine = screen.getByTestId("pasted-combine-pasted-1");
    fireEvent.click(combine);
    fireEvent.click(combine);

    expect(screen.queryByTestId("combined-book-summary")).toBeNull();
  });

  it("Clear all removes every pasted calendar and returns to the empty payoff prompt", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    fireEvent.click(screen.getByTestId("picker-paste-clear-all"));

    expect(screen.queryByTestId("pasted-row-pasted-1")).toBeNull();
    expect(screen.queryByTestId("pasted-row-pasted-2")).toBeNull();
    expect(screen.getByTestId("payoff-empty")).toBeTruthy();
  });

  it("the Clear all button only renders once something has been pasted", async () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("picker-paste-clear-all")).toBeNull();

    await paste(PASTE_EXAMPLE);
    expect(screen.getByTestId("picker-paste-clear-all")).toBeTruthy();
  });

  it("a pasted CALL never reaches the analyze endpoint (puts-only) but still charts", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE_CALL);

    expect(mockAnalyzeCalendarMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("pasted-row-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7600C · pasted");
  });

  it("a network error surfaces the paste-error copy, not a crash, and adds no calendar", async () => {
    mockAnalyzeCalendarMutateAsync.mockImplementationOnce(() =>
      Promise.reject(new Error("POST /api/picker/analyze failed: 500")),
    );

    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    expect(screen.queryByTestId("pasted-row-pasted-1")).toBeNull();
  });

  it("while the analyze request is pending the button reads Analyzing… and is disabled", () => {
    mockAnalyzePending.value = true;
    render(<Analyzer />);

    const button = screen.getByTestId("picker-paste-analyze");
    expect(button.textContent).toBe("Analyzing…");
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

// ─── Copy TOS order ───────────────────────────────────────────────────────────

describe("Analyzer — copy TOS order (copy-out)", () => {
  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";

  async function paste(text: string): Promise<void> {
    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("picker-paste-analyze"));
      await Promise.resolve();
    });
  }

  it("copies the selected calendar's TOS order to the clipboard", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);
    fireEvent.click(screen.getByTestId("copy-tos-order"));

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const candidate = parsedCalendarToPickerCandidate(parsed, "pasted-1");
    expect(writeText).toHaveBeenCalledWith(
      buildTosCalendarOrder(candidate, pickerSnapshotFixture.asOf),
    );
    expect(screen.getByTestId("copy-tos-order").textContent).toContain("Copied");
  });

  it("offers no Copy button while nothing is selected", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("copy-tos-order")).toBeNull();
  });
});

// ─── Payoff controls ──────────────────────────────────────────────────────────

describe("Analyzer — payoff controls (shared date projection + series toggles)", () => {
  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";

  async function renderWithCalendar(): Promise<void> {
    render(<Analyzer />);
    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: PASTE_EXAMPLE } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("picker-paste-analyze"));
      await Promise.resolve();
    });
  }

  it("renders the shared date-projection picker", async () => {
    await renderWithCalendar();
    expect(screen.getByTestId("date-picker-input")).not.toBeNull();
  });

  it("stepping the date forward moves the T+0 curve but leaves @exp fixed", async () => {
    await renderWithCalendar();
    const before = latestPayoffChartProps();

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    const after = latestPayoffChartProps();
    expect(after.todayCurve).not.toEqual(before.todayCurve);
    expect(after.expirationCurve).toEqual(before.expirationCurve);
  });

  it("clicking the @ exp toggle flips showExpiration off, leaving the others alone", async () => {
    await renderWithCalendar();
    expect(latestPayoffChartProps().toggles.showExpiration).toBe(true);

    fireEvent.click(screen.getByTestId("toggle-showExpiration"));

    expect(latestPayoffChartProps().toggles.showExpiration).toBe(false);
    expect(latestPayoffChartProps().toggles.showWalls).toBe(true);
  });

  it("renders the event/leg ribbon against the pasted calendar's legs", async () => {
    await renderWithCalendar();
    expect(screen.getByTestId("event-leg-ribbon")).toBeTruthy();
  });
});

// ─── Live badge ───────────────────────────────────────────────────────────────

function setLiveStream(status: "live" | "quiet" | "stalled"): void {
  mockUseLiveStream.mockReturnValue({
    greeks: new Map(),
    status,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot: null,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

describe("Analyzer — LiveStatusBadge", () => {
  it("renders LIVE in the chain header when the stream is live", () => {
    setLiveStream("live");
    render(<Analyzer />);

    expect(screen.getByText("Option chain")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
  });

  it("renders STALLED when the stream is stalled", () => {
    setLiveStream("stalled");
    render(<Analyzer />);
    expect(screen.getByText("STALLED")).toBeTruthy();
  });

  it("renders the badge even with no chain and nothing pasted", () => {
    setLiveStream("live");
    mockPricedReturn({ data: { asOf: OBSERVED, spot: null, contractType: "P", cohorts: [] } });
    mockChainReturn([]);
    render(<Analyzer />);

    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.queryByTestId("copy-tos-order")).toBeNull();
  });
});

// ─── One tree for all viewports ───────────────────────────────────────────────

describe("Analyzer — one tree for all viewports", () => {
  it("mounts a single tree with no desktop/mobile branch (jsdom has no matchMedia)", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("analyzer-root")).toBeTruthy();
    expect(screen.queryByTestId("analyzer-mobile-root")).toBeNull();
    expect(screen.getAllByTestId(/^chain-cohort-/).length).toBe(2);
  });

  it("keeps every column at every viewport — both tables scroll sideways instead", () => {
    render(<Analyzer />);
    const cohorts = screen.getByTestId("chain-cohorts-scroll");
    expect(cohorts.className).toContain("overflow-x-auto");
    expect(cohorts.querySelector("table")?.className).toContain("min-w-[");

    fireEvent.click(screen.getByTestId(`chain-cohort-SPXW-${FRONT.expiration}`));
    const ladder = screen.getByTestId("chain-ladder-scroll");
    expect(ladder.className).toContain("overflow-x-auto");
    expect(ladder.querySelector("table")?.className).toContain("min-w-[");
  });
});
