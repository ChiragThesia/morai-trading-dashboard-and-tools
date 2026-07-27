/**
 * ChainBrowse.test.tsx — surface 1, the TOS Trade tab shape.
 *
 * Row = one (root, expiration) cohort. Expand it and you get that cohort's whole strike ladder,
 * each strike a single LEG. Nothing is joined, nothing is filtered, nothing is ranked.
 *
 * Behaviors under test:
 *   1. One row per cohort, with root visible — SPX and SPXW are different books, not decoration.
 *   2. Null cohort stats render "—", never 0.
 *   3. Clicking a cohort expands its ladder; re-click collapses; only one is ever open.
 *   4. The ladder shows per-leg IV, V-Skew, greeks, bid/ask, OI — and em-dashes a null.
 *   5. The Front/Back pick buttons report the leg they belong to, and show which is picked.
 *   6. Sorting the ladder: metrics open descending, strike opens ascending, nulls last.
 *   7. The mobile recipe: horizontal-scroll wrapper + min-width table, one tree.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ChainBrowse } from "./ChainBrowse.tsx";
import { legKey } from "../../hooks/useChainModel.ts";
import type { ChainCohort, ChainLegRow } from "../../hooks/useChainModel.ts";
import { strikeLabel } from "./chain-format.tsx";

function leg(over: Partial<ChainLegRow>): ChainLegRow {
  return {
    root: "SPXW",
    expiration: "2026-08-21",
    contractType: "P",
    strike: 7_400_000,
    dte: 25,
    iv: 0.1452,
    bid: 102.9,
    ask: 103.8,
    openInterest: 1240,
    delta: -0.412,
    gamma: 0.0031,
    theta: -12.4,
    vega: 88.1,
    vSkew: -0.0125,
    ...over,
  };
}

/** A solved strike, a strike whose IV never solved, and a half-point strike. */
const AUG: ChainCohort = {
  root: "SPXW",
  expiration: "2026-08-21",
  dte: 25,
  atmIv: 0.1452,
  riskReversal: 0.0184,
  strikes: [
    leg({ strike: 7_400_000 }),
    leg({
      strike: 7_412_500,
      iv: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      vSkew: null,
      bid: 0,
      ask: 0,
      openInterest: 0,
    }),
    leg({ strike: 7_450_000, iv: 0.1391, vSkew: 0.0061, delta: -0.38, theta: -11.1, vega: 90.2 }),
  ],
};

/** A cohort whose ladder is too narrow to bracket 25Δ and whose ATM IV never solved. */
const SEP: ChainCohort = {
  root: "SPX",
  expiration: "2026-09-18",
  dte: 53,
  atmIv: null,
  riskReversal: null,
  strikes: [leg({ root: "SPX", expiration: "2026-09-18", dte: 53, iv: 0.2285, vSkew: null })],
};

const COHORTS: ReadonlyArray<ChainCohort> = [AUG, SEP];

function renderBrowse(over: Partial<React.ComponentProps<typeof ChainBrowse>> = {}) {
  const onPickFront = vi.fn();
  const onPickBack = vi.fn();
  const utils = render(
    <ChainBrowse
      cohorts={COHORTS}
      frontLeg={null}
      backLeg={null}
      onPickFront={onPickFront}
      onPickBack={onPickBack}
      {...over}
    />,
  );
  return { ...utils, onPickFront, onPickBack };
}

const AUG_ROW = "chain-cohort-SPXW-2026-08-21";
const SEP_ROW = "chain-cohort-SPX-2026-09-18";

afterEach(cleanup);

describe("ChainBrowse — the cohort list", () => {
  it("renders one row per cohort with its root, expiry, DTE and strike count", () => {
    renderBrowse();
    const aug = screen.getByTestId(AUG_ROW);
    expect(within(aug).getByText("Aug 21")).toBeTruthy();
    expect(within(aug).getByText("SPXW")).toBeTruthy();
    expect(within(aug).getByText("25")).toBeTruthy();
    expect(within(aug).getByText("3")).toBeTruthy();
    // Root is on the row because SPX and SPXW quote the SAME strikes on the SAME date out of
    // different books — without it the two cohorts are indistinguishable on screen.
    expect(within(screen.getByTestId(SEP_ROW)).getByText("SPX")).toBeTruthy();
  });

  it("shows the cohort's ATM IV and 25Δ risk reversal, em-dashing a null", () => {
    renderBrowse();
    expect(within(screen.getByTestId(AUG_ROW)).getByText("14.52%")).toBeTruthy();
    expect(within(screen.getByTestId(AUG_ROW)).getByText("+1.84")).toBeTruthy();
    // A ladder too narrow to bracket ±25Δ has no risk reversal. Two dashes, not two zeros.
    expect(within(screen.getByTestId(SEP_ROW)).getAllByText("—").length).toBe(2);
  });

  it("has no expanded ladder until a cohort is clicked", () => {
    renderBrowse();
    expect(screen.queryByTestId("chain-strikes-SPXW-2026-08-21")).toBeNull();
  });
});

describe("ChainBrowse — expanding a cohort", () => {
  it("opens that cohort's strike ladder, and closes it on a second click", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    expect(screen.getByTestId("chain-strikes-SPXW-2026-08-21")).toBeTruthy();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    expect(screen.queryByTestId("chain-strikes-SPXW-2026-08-21")).toBeNull();
  });

  it("keeps only one cohort open at a time", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    fireEvent.click(screen.getByTestId(SEP_ROW));
    expect(screen.queryByTestId("chain-strikes-SPXW-2026-08-21")).toBeNull();
    expect(screen.getByTestId("chain-strikes-SPX-2026-09-18")).toBeTruthy();
  });

  it("lists every strike the cohort quotes — the ladder is not filtered", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    const ladder = screen.getByTestId("chain-strikes-SPXW-2026-08-21");
    expect(within(ladder).getByText("7400")).toBeTruthy();
    // A half-point strike survives the ×1000 divide exactly.
    expect(within(ladder).getByText("7412.5")).toBeTruthy();
    expect(within(ladder).getByText("7450")).toBeTruthy();
  });

  it("renders per-leg IV, V-Skew, greeks, bid/ask and OI", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    const row = screen.getByTestId(`chain-leg-${legKey(leg({ strike: 7_400_000 }))}`);
    expect(within(row).getByText("14.52%")).toBeTruthy();
    expect(within(row).getByText("−1.25")).toBeTruthy(); // V-Skew, U+2212
    expect(within(row).getByText("−0.412")).toBeTruthy(); // delta
    expect(within(row).getByText("0.0031")).toBeTruthy(); // gamma
    expect(within(row).getByText("−12.40")).toBeTruthy(); // theta
    expect(within(row).getByText("88.10")).toBeTruthy(); // vega
    expect(within(row).getByText("102.90")).toBeTruthy(); // bid
    expect(within(row).getByText("103.80")).toBeTruthy(); // ask
    expect(within(row).getByText("1,240")).toBeTruthy(); // OI
  });

  it("em-dashes an unsolved leg's IV, V-Skew and every greek — and still shows the row", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    const row = screen.getByTestId(`chain-leg-${legKey(leg({ strike: 7_412_500 }))}`);
    // IV, V-Skew, Δ, Γ, Θ, vega = six dashes. Never 0 — a strike with no solved IV does not
    // have a zero delta, it has an unknown one.
    expect(within(row).getAllByText("—").length).toBe(6);
    // The row is still there, with the quotes that ARE real. A gap is not a deletion.
    expect(within(row).getByText("7412.5")).toBeTruthy();
  });
});

describe("ChainBrowse — picking the two legs", () => {
  it("reports the leg behind each Front and Back button", () => {
    const { onPickFront, onPickBack } = renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    const key = legKey(leg({ strike: 7_450_000 }));
    fireEvent.click(screen.getByTestId(`pick-front-${key}`));
    fireEvent.click(screen.getByTestId(`pick-back-${key}`));
    expect(onPickFront).toHaveBeenCalledTimes(1);
    expect(onPickFront.mock.calls[0]?.[0]).toMatchObject({ strike: 7_450_000, root: "SPXW" });
    expect(onPickBack.mock.calls[0]?.[0]).toMatchObject({ strike: 7_450_000, root: "SPXW" });
  });

  it("marks which leg is currently the front and which is the back", () => {
    const front = leg({ strike: 7_400_000 });
    const back = leg({ strike: 7_450_000 });
    renderBrowse({ frontLeg: front, backLeg: back });
    fireEvent.click(screen.getByTestId(AUG_ROW));
    expect(
      screen.getByTestId(`pick-front-${legKey(front)}`).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId(`pick-back-${legKey(front)}`).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByTestId(`pick-back-${legKey(back)}`).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // The pick buttons live inside a table row. If the row itself also handled clicks, picking a
  // leg would toggle something else at the same time.
  it("does not collapse the cohort when a pick button is clicked", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    fireEvent.click(screen.getByTestId(`pick-front-${legKey(leg({ strike: 7_400_000 }))}`));
    expect(screen.getByTestId("chain-strikes-SPXW-2026-08-21")).toBeTruthy();
  });
});

describe("ChainBrowse — sorting the ladder", () => {
  /**
   * The rendered strike order. Read off each leg row's testid rather than its first cell: the
   * strike cell also carries the wing letter ("7450P"), and the ladder is nested inside the
   * cohort table, so a bare `tbody tr` query would also match the wrapping detail row.
   */
  function ladderStrikes(): ReadonlyArray<string> {
    const rows = screen
      .getByTestId("chain-strikes-SPXW-2026-08-21")
      .querySelectorAll("tr[data-testid^='chain-leg-']");
    return [...rows].map((tr) => {
      const key = tr.getAttribute("data-testid") ?? "";
      return strikeLabel(Number(key.split("|").at(-1) ?? "0"));
    });
  }

  it("opens a metric column DESCENDING — the biggest number belongs on top", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    fireEvent.click(screen.getByText("V-Skew"));
    // +0.61 above −1.25, and the null last.
    expect(ladderStrikes()).toEqual(["7450", "7400", "7412.5"]);
  });

  it("toggles direction on a second click, keeping nulls last in BOTH directions", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    fireEvent.click(screen.getByText("V-Skew"));
    fireEvent.click(screen.getByText("V-Skew"));
    // "No data" is never the best row and never the worst — it is not a row you rank.
    expect(ladderStrikes()).toEqual(["7400", "7450", "7412.5"]);
  });

  it("opens strike ASCENDING — a chain is an axis, and reads low to high", () => {
    renderBrowse();
    fireEvent.click(screen.getByTestId(AUG_ROW));
    fireEvent.click(screen.getByText("V-Skew"));
    fireEvent.click(screen.getByText("Strike"));
    expect(ladderStrikes()).toEqual(["7400", "7412.5", "7450"]);
  });
});

describe("ChainBrowse — one tree for all viewports", () => {
  it("wraps both tables in a horizontal-scroll container with a min-width", () => {
    renderBrowse();
    const outer = screen.getByTestId("chain-cohorts-scroll");
    expect(outer.className).toContain("overflow-x-auto");
    fireEvent.click(screen.getByTestId(AUG_ROW));
    const ladder = screen.getByTestId("chain-ladder-scroll");
    expect(ladder.className).toContain("overflow-x-auto");
    expect(ladder.querySelector("table")?.className).toContain("min-w-[");
  });
});
