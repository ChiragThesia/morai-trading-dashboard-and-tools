/**
 * CotCard.test.tsx — TDD suite for the COT positioning card (Phase 13 FE wiring).
 *
 * Behaviors under test:
 *   1. Renders latest-week net positioning per trader class (sign-formatted, K/M compact).
 *   2. Shows the "as of" report date from the newest entry.
 *   3. Renders week-over-week delta arrows against the previous entry.
 *   4. Empty state when useCot has no data.
 *   5. Each class renders as a neutral, sign-tinted bullet gauge (39-03, GAUGE-03).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assertDefined } from "@morai/shared";

const { mockUseCot } = vi.hoisted(() => ({ mockUseCot: vi.fn() }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: mockUseCot }));

import { CotCard } from "./CotCard.tsx";

const WEEK_LATEST = {
  asOf: "2026-06-23",
  publishedAt: "2026-07-01T16:48:14.548Z",
  contractCode: "13874A",
  openInterest: 1980254,
  dealerLong: 112578, dealerShort: 868478, netDealer: -755900,
  assetMgrLong: 1171421, assetMgrShort: 178692, netAssetManager: 992729,
  levMoneyLong: 185058, levMoneyShort: 558526, netLeveraged: -373468,
  otherReptLong: 62151, otherReptShort: 48090, netOther: 14061,
  nonreptLong: 260145, nonreptShort: 137567, netNonreportable: 122578,
};

const WEEK_PREV = {
  ...WEEK_LATEST,
  asOf: "2026-06-16",
  netDealer: -625169,
  netAssetManager: 984009,
  netLeveraged: -515520,
};

function setData(data: unknown): void {
  mockUseCot.mockReturnValue({ data });
}

describe("CotCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the empty state when there is no COT data", () => {
    setData(undefined);
    render(<CotCard />);
    expect(screen.getByTestId("cot-empty")).toBeDefined();
  });

  it("renders latest-week net positioning per class, sign + K-compact", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    expect(screen.getByTestId("cot-card")).toBeDefined();
    // Dealer net short −755,900 → −756K
    expect(screen.getByTestId("cot-net-netDealer").textContent).toBe("−756K");
    // Asset manager net long +992,729 → +993K
    expect(screen.getByTestId("cot-net-netAssetManager").textContent).toBe("+993K");
    // Leveraged (headline) net short −373,468 → −373K
    expect(screen.getByTestId("cot-net-netLeveraged").textContent).toBe("−373K");
  });

  it("shows the report date of the newest entry", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    expect(screen.getByText(/2026-06-23/)).toBeDefined();
  });

  it("renders week-over-week delta arrows vs the previous entry", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    // Leveraged went from −515,520 → −373,468: net +142,052 ⇒ ▲ 142K
    const wow = screen.getByTestId("cot-wow-netLeveraged").textContent ?? "";
    expect(wow).toContain("▲");
    expect(wow).toContain("142K");
  });

  it("renders each COT row as a neutral bullet gauge, marker tinted by sign, never amber, no band segments", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);

    // netDealer short (−756K) → bg-down; netAssetManager long (+993K) → bg-up
    expect(screen.getByTestId("cot-gauge-marker-netDealer").className).toContain("bg-down");
    expect(screen.getByTestId("cot-gauge-marker-netDealer").className).not.toContain("bg-amber");
    expect(screen.getByTestId("cot-gauge-marker-netAssetManager").className).toContain("bg-up");
    expect(screen.getByTestId("cot-gauge-marker-netAssetManager").className).not.toContain("bg-amber");
    // netLeveraged short, netOther/netNonreportable long — never amber on any of them
    expect(screen.getByTestId("cot-gauge-marker-netLeveraged").className).toContain("bg-down");
    expect(screen.getByTestId("cot-gauge-marker-netOther").className).toContain("bg-up");
    expect(screen.getByTestId("cot-gauge-marker-netNonreportable").className).toContain("bg-up");
    for (const c of [
      "netDealer",
      "netAssetManager",
      "netLeveraged",
      "netOther",
      "netNonreportable",
    ]) {
      expect(screen.getByTestId(`cot-gauge-marker-${c}`).className).not.toContain("bg-amber");
      const gauge = screen.getByTestId(`cot-gauge-${c}`);
      expect(gauge.getAttribute("role")).toBe("meter");
      // neutral variant: no band-segment children, marker only
      expect(gauge.querySelectorAll(":scope > div").length).toBe(1);
    }
  });

  it("cot-net unchanged; cot-wow carries the WoW % of last week's |net| (2026-07-16 trend ask)", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    expect(screen.getByTestId("cot-net-netDealer").textContent).toBe("−756K");
    expect(screen.getByTestId("cot-net-netAssetManager").textContent).toBe("+993K");
    // ▲ 142K on a 515K prior |net| = 27.6% — the % says how big the move is vs the position.
    expect(screen.getByTestId("cot-wow-netLeveraged").textContent).toBe("▲ 142K · 27.6%");
  });

  it("cot-wow omits the % when last week's net is 0 (never Infinity)", () => {
    setData([WEEK_LATEST, { ...WEEK_PREV, netOther: 0 }]);
    render(<CotCard />);
    const text = screen.getByTestId("cot-wow-netOther").textContent ?? "";
    expect(text).not.toContain("%");
    expect(text).toMatch(/^[▲▼] /u);
  });

  it("moves net/WoW spans to 11px while the label span stays 10px (no row-level cascade)", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);

    expect(screen.getByTestId("cot-net-netDealer").className).toContain("text-[11px]");
    expect(screen.getByTestId("cot-wow-netDealer").className).toContain("text-[11px]");

    const row = screen.getByTestId("cot-row-netDealer");
    const label = row.querySelector("span");
    assertDefined(label, "COT row label span present");
    expect(label.className).toContain("text-[10px]");
    expect(label.className).not.toContain("text-[11px]");
  });

  it("gives every COT gauge a full meter aria contract (a11y parity with regime/rate gauges)", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);

    const gauge = screen.getByTestId("cot-gauge-netLeveraged");
    expect(gauge.getAttribute("aria-valuemin")).toBe("-800000");
    expect(gauge.getAttribute("aria-valuemax")).toBe("800000");
    expect(gauge.getAttribute("aria-valuenow")).toBe("-373468");
    // net −373K short, but WoW moved up (less short) +142K — direction is WoW's, not the sign's.
    expect(gauge.getAttribute("aria-valuetext")).toContain("−373K");
    expect(gauge.getAttribute("aria-valuetext")).toContain("up 142K");
    expect(gauge.getAttribute("aria-label")).toBe("Leveraged net position");
  });

  it("renders a cot-why-{key} tooltip trigger with a verbatim 3-line WHAT/WHY/META payload", async () => {
    const user = userEvent.setup();
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);

    await user.hover(screen.getByTestId("cot-why-netLeveraged"));

    expect(
      await screen.findByText("Leveraged Funds net position — hedge funds & CTAs"),
    ).toBeDefined();
    expect(
      await screen.findByText("Most tactical class; often leads price action"),
    ).toBeDefined();
    expect(await screen.findByText("±800K axis · CFTC TFF, weekly")).toBeDefined();
  });

  it("renders the legend footnote at 10px", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    const footnote = screen.getByText(/Net = long − short contracts/);
    expect(footnote.className).toContain("text-[10px]");
    expect(footnote.className).not.toContain("text-[9px]");
  });
});
