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

// The chain fetch — mocked at the hook, so no QueryClientProvider is needed.
const { mockUseChain } = vi.hoisted(() => ({ mockUseChain: vi.fn() }));
vi.mock("../hooks/useChain.ts", () => ({ useChain: mockUseChain }));

// useChainModel reads GEX only for per-expiry carry (r, q). `resolveCarry` falls back to its
// flat defaults on an absent snapshot, so an undefined-data stub exercises the same path the
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

function mockChainReturn(
  overrides: Partial<{
    data: ReadonlyArray<ChainRow> | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: () => void;
  }> = {},
): void {
  mockUseChain.mockReturnValue({
    data: chainFixture(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
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
  mockChainReturn();
  mockUsePickerReturn();
  mockAnalyzePending.value = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Chain table ──────────────────────────────────────────────────────────────

describe("Analyzer — chain table", () => {
  it("renders one row per strike quoted in both expiries, in strike order", () => {
    render(<Analyzer />);
    const rows = screen.getAllByTestId(/^chain-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(
      // Row identity is wing + strike ×1000. Keying on strike alone would collide the call
      // and the put at each strike into one row and one expansion slot.
      STRIKES.map((k) => `chain-row-SPXW-P-${k * 1000}`),
    );
  });

  // CELL RENDERING IS NOT TESTED HERE. Six assertions that lived at this spot — per-cell IV
  // and skew values, expand-into-two-legs, sort + aria-sort, header direction flip, and the
  // em-dash-never-zero rule — moved to `components/chain/ChainTable.test.tsx`, which owns the
  // component that renders them. They were written against a stub table that tagged every
  // cell; the shipped one tags only rows and detail rows, and duplicating its formatting
  // assertions in a screen test means two places to update for one change.
  //
  // This suite's job is WIRING: does the model reach the table, and does the screen react to
  // the model. The V-Skew wing constraint — the one defect that renders a plausible wrong
  // number rather than a gap — is covered on the model side in `useChainModel.test.ts`.

  it("only one row is expanded at a time", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7500000"));
    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7400000"));
    expect(screen.getByTestId("chain-detail-SPXW-P-7400000")).toBeTruthy();
    expect(screen.queryByTestId("chain-detail-SPXW-P-7500000")).toBeNull();
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

// ─── Expiry-pair header ───────────────────────────────────────────────────────

describe("Analyzer — expiry pair header", () => {
  it("defaults the selects to the two nearest expiries", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("chain-front-select")).toHaveProperty("value", FRONT.expiration);
    expect(screen.getByTestId("chain-back-select")).toHaveProperty("value", BACK.expiration);
  });

  it("choosing a different back expiry re-joins the table against it", () => {
    const extra = STRIKES.flatMap((k) => [
      chainRow({ strike: k * 1000, expiration: "2026-10-16", dte: 82, bsmIv: 0.19, contractType: "P" }),
      chainRow({ strike: k * 1000, expiration: "2026-10-16", dte: 82, bsmIv: 0.185, contractType: "C" }),
    ]);
    mockChainReturn({ data: [...chainFixture(), ...extra] });
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("chain-back-select"), { target: { value: "2026-10-16" } });

    expect(screen.getByTestId("chain-back-select")).toHaveProperty("value", "2026-10-16");
    // The back leg is re-read from the newly chosen expiry: 19%, not the 17% of the old one.
    // Asserted on the row's text rather than a cell testid — cell-level rendering belongs to
    // ChainTable's own suite; what matters here is that the model re-joined.
    expect(screen.getByTestId("chain-row-SPXW-P-7500000").textContent).toContain("19.00%");
    expect(screen.getByTestId("chain-row-SPXW-P-7500000").textContent).not.toContain("17.00%");
  });

  it("switches the table between puts and calls", () => {
    render(<Analyzer />);
    // Puts by default, and the wing is part of the row's identity — so switching does not
    // mutate a row in place, it replaces the put rows with call rows entirely. That is what
    // stops the two wings colliding into one row and one expansion slot.
    expect(screen.getByTestId("chain-row-SPXW-P-7500000").textContent).toContain("15.00%");
    expect(screen.queryByTestId("chain-row-SPXW-C-7500000")).toBeNull();

    fireEvent.click(screen.getByTestId("chain-type-call"));

    expect(screen.queryByTestId("chain-row-SPXW-P-7500000")).toBeNull();
    expect(screen.getByTestId("chain-row-SPXW-C-7500000").textContent).toContain("14.50%");
  });

  it("reports spot and the observation instant from the chain itself", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("chain-spot").textContent).toBe(SPOT.toFixed(2));
    expect(screen.getByTestId("chain-observed").textContent).toContain("ET");
  });

  it("shows an em dash for the 25Δ RR when the chain is too narrow to reach either wing", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("chain-rr-front").textContent).toBe("—");
    expect(screen.getByTestId("chain-rr-back").textContent).toBe("—");
  });

  it("shows a real 25Δ RR once the ladder reaches both wings", () => {
    const wide: ChainRow[] = [];
    for (const e of [FRONT, BACK]) {
      for (let k = 6600; k <= 8400; k += 25) {
        const iv = 0.2 - (k - 6600) * 0.00003;
        wide.push(chainRow({ ...e, strike: k * 1000, bsmIv: iv, contractType: "P" }));
        wide.push(chainRow({ ...e, strike: k * 1000, bsmIv: iv - 0.02, contractType: "C" }));
      }
    }
    mockChainReturn({ data: wide });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-rr-front").textContent).not.toBe("—");
    expect(screen.getByTestId("chain-rr-back").textContent).toMatch(/^[+-]/);
  });
});

// ─── Five load states ─────────────────────────────────────────────────────────

describe("Analyzer — chain load states", () => {
  it("loading: text-only 'Loading chain…' when isPending && data === undefined", () => {
    mockChainReturn({ data: undefined, isPending: true });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-loading").textContent).toBe("Loading chain…");
    expect(screen.queryByTestId("chain-error")).toBeNull();
    expect(screen.queryByTestId("chain-cold-start")).toBeNull();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("error: shows the failure copy and a Retry that calls refetch()", () => {
    const refetch = vi.fn();
    mockChainReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-error").textContent).toContain("Couldn't load the chain.");
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("cold start: settled with no expiries shows 'Chain warming up'", () => {
    mockChainReturn({ data: [] });
    render(<Analyzer />);

    const cold = screen.getByTestId("chain-cold-start");
    expect(cold.textContent).toContain("Chain warming up");
    expect(screen.queryByTestId("chain-empty")).toBeNull();
  });

  it("empty: a settled chain with no strike in BOTH expiries says so", () => {
    // Front-month strikes only exist below 7500, back-month only above — no overlap.
    const rows = chainFixture().filter(
      (r) =>
        (r.expiration === FRONT.expiration && r.strike < 7500_000) ||
        (r.expiration === BACK.expiration && r.strike > 7500_000),
    );
    mockChainReturn({ data: rows });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-empty").textContent).toContain(
      "No strike is quoted in both of the selected expiries.",
    );
    expect(screen.queryAllByTestId(/^chain-row-/)).toEqual([]);
  });

  it("populated: the table renders and no other state does", () => {
    render(<Analyzer />);
    expect(screen.getAllByTestId(/^chain-row-/).length).toBe(STRIKES.length);
    expect(screen.queryByTestId("chain-loading")).toBeNull();
    expect(screen.queryByTestId("chain-error")).toBeNull();
    expect(screen.queryByTestId("chain-cold-start")).toBeNull();
    expect(screen.queryByTestId("chain-empty")).toBeNull();
  });

  it("state precedence: loading wins over isError being simultaneously true", () => {
    mockChainReturn({ data: undefined, isPending: true, isError: true });
    render(<Analyzer />);

    expect(screen.getByTestId("chain-loading")).toBeTruthy();
    expect(screen.queryByTestId("chain-error")).toBeNull();
  });

  it("the Re-pull control stays usable in every state", () => {
    mockChainReturn({ data: undefined, isPending: true });
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
    mockChainReturn({ data: [] });
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
    expect(screen.getAllByTestId(/^chain-row-/).length).toBe(STRIKES.length);
  });

  it("keeps every column at every viewport — the table scrolls sideways instead", () => {
    render(<Analyzer />);
    const wrapper = screen.getByTestId("chain-table-scroll");
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(wrapper.querySelector("table")?.className).toContain("min-w-[");
  });
});
