/**
 * ChainPair.test.tsx — surface 2, the calendar math for the two legs the user picked.
 *
 * Behaviors under test:
 *   1. Nothing picked → a prompt, not an empty grid of dashes.
 *   2. Both legs' own IVs and markets are shown — they are the reason to trade off this screen.
 *   3. H-Skew, Fwd IV, Edge, net Δ/Γ/Θ/vega and the haircut debit all render; nulls em-dash.
 *   4. The three odd-pair flags are VISIBLE, not silent: cross-root, inverted, diagonal.
 *   5. The TOS hand-off button appears only when the pair can be one calendar order.
 *   6. The Edge legend states the formula the code actually computes (front IV − forward IV).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ChainPair } from "./ChainPair.tsx";
import type { ChainLegRow, ChainPair as ChainPairModel } from "../../hooks/useChainModel.ts";

function leg(over: Partial<ChainLegRow>): ChainLegRow {
  return {
    root: "SPXW",
    expiration: "2026-08-21",
    contractType: "P",
    strike: 6_675_000,
    dte: 25,
    iv: 0.2511,
    bid: 10.1,
    ask: 11.1,
    openInterest: 3461,
    delta: -0.2412,
    gamma: 0.0031,
    theta: -12.4,
    vega: 88.1,
    vSkew: 0.0945,
    ...over,
  };
}

const FRONT = leg({});
const BACK = leg({ expiration: "2026-09-18", dte: 53, iv: 0.2285, bid: 18.2, ask: 19.4, openInterest: 902 });

function pair(over: Partial<ChainPairModel> = {}): ChainPairModel {
  return {
    front: FRONT,
    back: BACK,
    hSkew: 0.0226,
    fwdIv: 0.2172,
    edge: 0.0339,
    debit: 8.63,
    netDelta: 0.018,
    netGamma: -0.0009,
    netTheta: 4.2,
    netVega: 112.34,
    rootMismatch: false,
    backNotLater: false,
    diagonal: false,
    tosOrder: "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/21 AUG 26 6675 PUT @8.63 LMT GTC",
    ...over,
  };
}

function renderPair(p: ChainPairModel | null, over: Partial<React.ComponentProps<typeof ChainPair>> = {}) {
  const onSendToPayoff = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <ChainPair pair={p} onSendToPayoff={onSendToPayoff} onClear={onClear} {...over} />,
  );
  return { ...utils, onSendToPayoff, onClear };
}

afterEach(cleanup);

describe("ChainPair — nothing picked", () => {
  it("prompts for two legs instead of showing a grid of dashes", () => {
    renderPair(null);
    expect(screen.getByTestId("chain-pair-empty")).toBeTruthy();
    expect(screen.queryByTestId("chain-pair-hskew")).toBeNull();
  });
});

describe("ChainPair — the picked calendar", () => {
  it("shows each leg's expiry, DTE, strike and its OWN implied vol", () => {
    renderPair(pair());
    const front = screen.getByTestId("chain-pair-front");
    const back = screen.getByTestId("chain-pair-back");
    expect(within(front).getByText("Aug 21")).toBeTruthy();
    expect(within(front).getByText("25 DTE")).toBeTruthy();
    expect(within(front).getByText("25.11%")).toBeTruthy();
    expect(within(back).getByText("Sep 18")).toBeTruthy();
    expect(within(back).getByText("22.85%")).toBeTruthy();
    // The strike, and the wing, on both legs.
    expect(within(front).getByText("6675 P")).toBeTruthy();
  });

  it("renders the three term-structure numbers in vol points and percent", () => {
    renderPair(pair());
    expect(screen.getByTestId("chain-pair-hskew").textContent).toContain("+2.26");
    expect(screen.getByTestId("chain-pair-fwdiv").textContent).toContain("21.72%");
    expect(screen.getByTestId("chain-pair-edge").textContent).toContain("+3.39");
  });

  it("renders the calendar's net greeks and its haircut debit", () => {
    renderPair(pair());
    expect(screen.getByTestId("chain-pair-netdelta").textContent).toContain("+0.018");
    expect(screen.getByTestId("chain-pair-netgamma").textContent).toContain("−0.0009");
    expect(screen.getByTestId("chain-pair-nettheta").textContent).toContain("4.20");
    expect(screen.getByTestId("chain-pair-netvega").textContent).toContain("112.34");
    expect(screen.getByTestId("chain-pair-debit").textContent).toContain("8.63");
  });

  it("em-dashes an inverted structure's forward vol and edge, never zeroes them", () => {
    // computeFwdIv guards a negative radicand: an inverted term structure prices no forward vol,
    // so there is no edge to quote. The dash is the honest answer, not a missing value.
    renderPair(pair({ fwdIv: null, edge: null }));
    expect(screen.getByTestId("chain-pair-fwdiv").textContent).toContain("—");
    expect(screen.getByTestId("chain-pair-edge").textContent).toContain("—");
  });
});

describe("ChainPair — the odd-pair flags", () => {
  it("warns when the two legs are different OCC roots", () => {
    renderPair(pair({ rootMismatch: true, tosOrder: null }));
    expect(screen.getByTestId("chain-pair-flag-root")).toBeTruthy();
  });

  it("warns when the back leg is not strictly later than the front", () => {
    renderPair(pair({ backNotLater: true, fwdIv: null, edge: null, tosOrder: null }));
    expect(screen.getByTestId("chain-pair-flag-order")).toBeTruthy();
  });

  it("warns when the legs sit at different strikes — a diagonal, not a calendar", () => {
    renderPair(pair({ diagonal: true, tosOrder: null }));
    expect(screen.getByTestId("chain-pair-flag-diagonal")).toBeTruthy();
  });

  it("shows no flags on a well-formed calendar", () => {
    renderPair(pair());
    expect(screen.queryByTestId("chain-pair-flag-root")).toBeNull();
    expect(screen.queryByTestId("chain-pair-flag-order")).toBeNull();
    expect(screen.queryByTestId("chain-pair-flag-diagonal")).toBeNull();
  });
});

describe("ChainPair — handing the pair to the payoff panel", () => {
  it("sends the TOS order line on click", () => {
    const { onSendToPayoff } = renderPair(pair());
    fireEvent.click(screen.getByTestId("chain-pair-send"));
    expect(onSendToPayoff).toHaveBeenCalledWith(
      "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/21 AUG 26 6675 PUT @8.63 LMT GTC",
    );
  });

  // A pair that cannot be written as ONE calendar order has no button. parseTosOrder sorts the
  // two dates, so an inverted pair would come back re-labelled as a valid calendar — a plausible
  // wrong read of what the user picked.
  it("offers no button when the pair cannot be one calendar order", () => {
    renderPair(pair({ backNotLater: true, tosOrder: null }));
    expect(screen.queryByTestId("chain-pair-send")).toBeNull();
  });

  it("clears the pair on demand", () => {
    const { onClear } = renderPair(pair());
    fireEvent.click(screen.getByTestId("chain-pair-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("ChainPair — the legend", () => {
  // P2 from the UAT: the shipped legend read "Edge = forward IV − front IV" while chain-math
  // computes `ivFront - fwdIv`. The caption was backwards, not the math — positive Edge means the
  // FRONT is rich, which is the setup you want, and it matches H-Skew's direction.
  it("states Edge as front IV minus forward IV, matching what the code computes", () => {
    renderPair(pair());
    const legend = screen.getByTestId("chain-pair-legend").textContent ?? "";
    expect(legend).toContain("front IV − forward IV");
    expect(legend).not.toContain("forward IV − front IV");
  });

  it("states H-Skew in the same direction as Edge", () => {
    renderPair(pair());
    const legend = screen.getByTestId("chain-pair-legend").textContent ?? "";
    expect(legend).toContain("front IV − back IV");
  });
});
