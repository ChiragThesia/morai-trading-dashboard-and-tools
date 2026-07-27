/**
 * ChainTable.test.tsx — the calendar chain DATA table (one row per strike).
 *
 * Behaviors under test:
 *   1. Exactly 13 columns, in the user's order — and NO score/verdict/rank column.
 *   2. One row per strike; strike is the ×1000 integer divided down for display.
 *   3. Null derived fields render "—", never 0 and never NaN.
 *   4. Clicking a row expands both legs + net greeks in place; re-click collapses;
 *      only one row is ever expanded.
 *   5. Sorting by a data column works, toggles direction, and keeps nulls last.
 *   6. The mobile recipe: horizontal-scroll wrapper + min-width table, one tree.
 *   7. Both wings at one strike stay separate rows — the chain read returns calls AND
 *      puts, so a strike-only identity would collide them.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ChainTable } from "./ChainTable.tsx";
import type { ChainTableRow, ChainTableLeg } from "./ChainTable.tsx";

const ROWS: ReadonlyArray<ChainTableRow> = [
  {
    strike: 7400000,
    contractType: "P",
    root: "SPXW",
    deltaFront: -0.412,
    ivFront: 0.1452,
    ivBack: 0.1391,
    hSkew: -0.0061,
    fwdIv: 0.133,
    edge: 0.004,
    vSkew: -0.0125,
    theta: 38.52,
    vega: 112.34,
    netDelta: 0.018,
    netGamma: -0.0009,
    debit: 40.08,
    front: {
      expiry: "2026-08-11",
      dte: 16,
      iv: 0.1452,
      bid: 102.9,
      ask: 103.8,
      openInterest: 1240,
      delta: -0.412,
      gamma: 0.0031,
      theta: -12.4,
      vega: 88.1,
    },
    back: {
      expiry: "2026-08-31",
      dte: 36,
      iv: 0.1391,
      bid: 142.8,
      ask: 143.9,
      openInterest: 860,
      delta: -0.394,
      gamma: 0.0022,
      theta: -8.2,
      vega: 200.4,
    },
  },
  {
    // Every derived field null — the "no data" row. Must never show 0 or NaN.
    strike: 7450000,
    contractType: "P",
    root: "SPXW",
    deltaFront: null,
    ivFront: null,
    ivBack: null,
    hSkew: null,
    fwdIv: null,
    edge: null,
    vSkew: null,
    theta: null,
    vega: null,
    netDelta: null,
    netGamma: null,
    debit: null,
    front: {
      expiry: "2026-08-11",
      dte: 16,
      iv: null,
      bid: null,
      ask: null,
      openInterest: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
    },
    back: {
      expiry: "2026-08-31",
      dte: 36,
      iv: null,
      bid: null,
      ask: null,
      openInterest: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
    },
  },
  {
    strike: 7500000,
    contractType: "P",
    root: "SPXW",
    deltaFront: -0.508,
    ivFront: 0.1521,
    ivBack: 0.1444,
    hSkew: -0.0077,
    fwdIv: 0.1372,
    edge: 0.012,
    vSkew: 0.0091,
    theta: 41.15,
    vega: 120.6,
    netDelta: -0.021,
    netGamma: -0.0012,
    debit: 43.25,
    front: {
      expiry: "2026-08-11",
      dte: 16,
      iv: 0.1521,
      bid: 150.1,
      ask: 151.4,
      openInterest: 2200,
      delta: -0.508,
      gamma: 0.0034,
      theta: -14.1,
      vega: 91.7,
    },
    back: {
      expiry: "2026-08-31",
      dte: 36,
      iv: 0.1444,
      bid: 193.2,
      ask: 194.8,
      openInterest: 1150,
      delta: -0.487,
      gamma: 0.0024,
      theta: -9.0,
      vega: 212.3,
    },
  },
];

const EXPECTED_COLUMNS = [
  "Strike",
  "Front Delta (Δ)",
  "Front IV",
  "Back IV",
  "H-Skew",
  "Fwd IV",
  "Edge",
  "V-Skew",
  "Theta (Θ)",
  "Vega",
  "Net Delta (Δ)",
  "Net Gamma (Γ)",
  "Debit",
];

/** Every derived field rounds to zero — none of them may render a signed zero. */
const TINY_LEG: ChainTableLeg = {
  expiry: "2026-08-11",
  dte: 16,
  iv: 0.1452,
  bid: 102.9,
  ask: 103.8,
  openInterest: 1240,
  delta: -0.412,
  gamma: 0.0031,
  theta: -12.4,
  vega: 88.1,
};

const TINY_ROW: ChainTableRow = {
  strike: 7600000,
  contractType: "P",
  root: "SPXW",
  deltaFront: -0.412,
  ivFront: 0.1452,
  ivBack: 0.1391,
  hSkew: -0.000004,
  fwdIv: 0.133,
  edge: -0.0000009,
  vSkew: -0.0000002,
  theta: -0.001,
  vega: -0.004,
  netDelta: -0.0000004,
  netGamma: -0.00000001,
  debit: 40.08,
  front: TINY_LEG,
  back: TINY_LEG,
};

/** Header text with the active-sort glyph stripped. */
function headerTexts(): ReadonlyArray<string> {
  return Array.from(document.querySelectorAll("th")).map((th) =>
    (th.textContent ?? "").replace(/[▲▼]/g, "").trim(),
  );
}

/** The <th> whose label is `label` (glyph-tolerant). */
function headerCell(label: string): HTMLElement {
  const th = Array.from(document.querySelectorAll("th")).find(
    (el) => (el.textContent ?? "").replace(/[▲▼]/g, "").trim() === label,
  );
  if (th === undefined) throw new Error(`no column header "${label}"`);
  return th;
}

/** Numeric strike labels of the rendered body rows, in DOM order (wing tag stripped). */
function strikeOrder(): ReadonlyArray<string> {
  return Array.from(document.querySelectorAll('tr[data-testid^="chain-row-"]')).map(
    (tr) => (/^[\d.]+/.exec((tr.querySelector("td")?.textContent ?? "").trim()) ?? [""])[0],
  );
}

afterEach(() => {
  cleanup();
});

describe("ChainTable — chain data surface", () => {
  it("renders exactly the 13 data columns in order, with no score/verdict/rank column", () => {
    render(<ChainTable rows={ROWS} />);

    expect(headerTexts()).toEqual(EXPECTED_COLUMNS);
    for (const banned of ["Score", "Verdict", "Rank", "Grade"]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
  });

  it("renders one row per strike with the ×1000 strike divided down and IVs as percents", () => {
    render(<ChainTable rows={ROWS} />);

    expect(strikeOrder()).toEqual(["7400", "7450", "7500"]);

    const row = screen.getByTestId("chain-row-SPXW-P-7400000");
    expect(row.textContent).toContain("7400");
    expect(row.textContent).toContain("−0.412"); // front delta
    expect(row.textContent).toContain("14.52%"); // front IV
    expect(row.textContent).toContain("13.91%"); // back IV
    expect(row.textContent).toContain("−0.61"); // H-skew, vol points
    expect(row.textContent).toContain("13.30%"); // forward IV
    expect(row.textContent).toContain("+0.40"); // edge, vol points
    expect(row.textContent).toContain("−1.25"); // V-skew, vol points
    expect(row.textContent).toContain("38.52"); // theta
    expect(row.textContent).toContain("112.34"); // vega
    expect(row.textContent).toContain("+0.018"); // net delta
    expect(row.textContent).toContain("−0.0009"); // net gamma — short gamma is the live risk
    expect(row.textContent).toContain("40.08"); // debit
  });

  it("never renders a signed zero: a value that rounds to zero drops its sign", () => {
    render(<ChainTable rows={[TINY_ROW]} />);

    const row = screen.getByTestId("chain-row-SPXW-P-7600000");
    // "−0.00" reads as "slightly negative" but prints as zero — the same
    // zero-vs-no-data ambiguity the em-dash rule exists to prevent.
    expect(row.textContent).not.toContain("−0.00");
    expect(row.textContent).not.toContain("−0.000");
    expect(row.textContent).not.toContain("NaN");
  });

  it("renders every null derived field as an em dash — never 0, never NaN", () => {
    render(<ChainTable rows={ROWS} />);

    const nullRow = screen.getByTestId("chain-row-SPXW-P-7450000");
    const cells = Array.from(nullRow.querySelectorAll("td")).map((td) =>
      (td.textContent ?? "").trim(),
    );

    // First cell is the strike + wing (real data); the other 12 are all null.
    expect(cells[0]).toBe("7450P");
    expect(cells.slice(1)).toEqual(Array.from({ length: 12 }, () => "—"));
    expect(nullRow.textContent).not.toContain("NaN");
    expect(nullRow.textContent).not.toMatch(/\b0(\.0+)?%/);
  });

  it("expands a row into both legs plus the calendar net greeks; re-click collapses", () => {
    render(<ChainTable rows={ROWS} />);

    expect(screen.queryByTestId("chain-detail-SPXW-P-7400000")).toBeNull();
    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7400000"));

    const detail = screen.getByTestId("chain-detail-SPXW-P-7400000");
    const text = detail.textContent ?? "";

    // Both legs, side by side, each with the full per-leg record.
    expect(text).toContain("Front");
    expect(text).toContain("Back");
    expect(text).toContain("Aug 11");
    expect(text).toContain("Aug 31");
    expect(text).toContain("16"); // front DTE
    expect(text).toContain("36"); // back DTE
    expect(text).toContain("102.90"); // front bid
    expect(text).toContain("103.80"); // front ask
    expect(text).toContain("1,240"); // front open interest
    expect(text).toContain("0.0031"); // front gamma
    expect(text).toContain("−12.40"); // front theta
    expect(text).toContain("88.10"); // front vega
    expect(text).toContain("200.40"); // back vega

    // Calendar net greeks — all four, gamma included (short gamma is the live risk).
    expect(text).toContain("Net Delta");
    expect(text).toContain("Net Gamma");
    expect(text).toContain("Net Theta");
    expect(text).toContain("Net Vega");
    expect(text).toContain("−0.0009"); // net gamma

    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7400000"));
    expect(screen.queryByTestId("chain-detail-SPXW-P-7400000")).toBeNull();
  });

  it("keeps only one row expanded at a time", () => {
    render(<ChainTable rows={ROWS} />);

    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7400000"));
    expect(screen.getByTestId("chain-detail-SPXW-P-7400000")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7500000"));
    expect(screen.getByTestId("chain-detail-SPXW-P-7500000")).toBeTruthy();
    expect(screen.queryByTestId("chain-detail-SPXW-P-7400000")).toBeNull();
  });

  it("expanded legs show em dashes when the leg has no quote", () => {
    render(<ChainTable rows={ROWS} />);

    fireEvent.click(screen.getByTestId("chain-row-SPXW-P-7450000"));
    const detail = screen.getByTestId("chain-detail-SPXW-P-7450000");
    expect(detail.textContent).toContain("—");
    expect(detail.textContent).not.toContain("NaN");
  });

  it("sorts by a data column, toggles direction, and keeps nulls last", () => {
    render(<ChainTable rows={ROWS} />);

    // A metric opens DESCENDING — biggest first is what you want on a trading table.
    fireEvent.click(headerCell("Edge"));
    expect(strikeOrder()).toEqual(["7500", "7400", "7450"]); // desc, null last

    fireEvent.click(headerCell("Edge"));
    expect(strikeOrder()).toEqual(["7400", "7500", "7450"]); // asc, null still last

    // Strike is the axis: back to it and it reads low-to-high again.
    fireEvent.click(headerCell("Strike"));
    expect(strikeOrder()).toEqual(["7400", "7450", "7500"]);
  });

  it("marks the sorted column with aria-sort", () => {
    render(<ChainTable rows={ROWS} />);

    expect(headerCell("Strike").getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(headerCell("Edge"));
    expect(headerCell("Edge").getAttribute("aria-sort")).toBe("descending");
    expect(headerCell("Strike").getAttribute("aria-sort")).toBe("none");
  });

  it("keeps both wings at the same strike as separate, independent rows", () => {
    // The chain read returns calls AND puts. Identity is strike + contractType: keying
    // on strike alone collides the wings — duplicate React keys, and expanding the put
    // would open the call. A row is one wing by construction, so the props type cannot
    // express a mixed-wing pair at all; the caller owns pairing each leg to its wing.
    //
    // The two wings MUST carry different IVs here. Give them the same IV and this test
    // passes even if the rows are crossed, which is exactly the bug it exists to catch.
    const put: ChainTableRow = { ...TINY_ROW, strike: 7400000, contractType: "P" };
    const call: ChainTableRow = {
      ...TINY_ROW,
      strike: 7400000,
      contractType: "C",
    root: "SPXW",
      ivFront: 0.1103,
      debit: 31.5,
    };
    render(<ChainTable rows={[put, call]} />);

    const putRow = screen.getByTestId("chain-row-SPXW-P-7400000");
    const callRow = screen.getByTestId("chain-row-SPXW-C-7400000");
    expect(putRow).not.toBe(callRow);
    expect(putRow.textContent).toContain("14.52%"); // the put's own front IV
    expect(callRow.textContent).toContain("11.03%"); // the call's own front IV
    expect(callRow.textContent).toContain("31.50"); // the call's own debit

    // Expanding one wing must not expand the other.
    fireEvent.click(putRow);
    expect(screen.getByTestId("chain-detail-SPXW-P-7400000")).toBeTruthy();
    expect(screen.queryByTestId("chain-detail-SPXW-C-7400000")).toBeNull();
  });

  it("uses the one-tree mobile recipe: horizontal-scroll wrapper + min-width table", () => {
    render(<ChainTable rows={ROWS} />);

    const wrapper = screen.getByTestId("chain-table-scroll");
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(wrapper.className).toContain("-mx-2");

    const table = wrapper.querySelector("table");
    expect(table?.className).toMatch(/min-w-\[\d+px\]/);
  });
});

// REGRESSION (prod, 2026-07-26). Same class as the wing collision above, one level deeper:
// SPX (AM-settled monthlies) and SPXW (PM-settled weeklies) quote the SAME strike on the SAME
// date. Keying on strike + wing alone collided them — 242 duplicate keys live, so one React
// key and one expansion slot served two different books, and after sorting the detail panel
// opened nowhere near the row that was clicked.
//
// The two roots MUST carry different IVs here, or this passes even when they are crossed.
describe("ChainTable — SPX vs SPXW at one strike", () => {
  it("keeps the two roots as separate, independently expandable rows", () => {
    const spxw: ChainTableRow = { ...TINY_ROW, strike: 7400000, root: "SPXW", ivFront: 0.1452 };
    const spx: ChainTableRow = { ...TINY_ROW, strike: 7400000, root: "SPX", ivFront: 0.2103 };
    render(<ChainTable rows={[spxw, spx]} />);

    const a = screen.getByTestId("chain-row-SPXW-P-7400000");
    const b = screen.getByTestId("chain-row-SPX-P-7400000");
    expect(a).not.toBe(b);
    expect(a.textContent).toContain("14.52%");
    expect(b.textContent).toContain("21.03%");

    // Expanding one must not expand the other — the collision's most visible symptom.
    fireEvent.click(a);
    expect(screen.getByTestId("chain-detail-SPXW-P-7400000")).toBeTruthy();
    expect(screen.queryByTestId("chain-detail-SPX-P-7400000")).toBeNull();
  });
});

// A metric's FIRST click must land descending — biggest first. Ascending-first shows the
// worst edge, the thinnest theta and the smallest debit on top, which reads as "the sort did
// not work" even though it did. Strike is the exception: it is an axis, not a metric, so it
// reads low-to-high like a chain always does.
describe("ChainTable — first-click sort direction", () => {
  it("sorts a metric descending on first click, and toggles on the second", () => {
    render(<ChainTable rows={ROWS} />);

    fireEvent.click(headerCell("Edge"));
    // ROWS carry edge 0.004, null, 0.012 → 1.20 on top, null last.
    expect(strikeOrder()).toEqual(["7500", "7400", "7450"]);
    expect(headerCell("Edge").getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(headerCell("Edge"));
    expect(strikeOrder()).toEqual(["7400", "7500", "7450"]);
    expect(headerCell("Edge").getAttribute("aria-sort")).toBe("ascending");
  });

  it("opens on strike ascending — the axis reads low-to-high, like any chain", () => {
    render(<ChainTable rows={ROWS} />);
    // Strike is already the active sort at mount, so this is the mount state, not a click.
    expect(strikeOrder()).toEqual(["7400", "7450", "7500"]);
    expect(headerCell("Strike").getAttribute("aria-sort")).toBe("ascending");
  });

  it("returns to strike ascending after sorting by a metric", () => {
    render(<ChainTable rows={ROWS} />);
    fireEvent.click(headerCell("Debit"));
    fireEvent.click(headerCell("Strike"));
    expect(strikeOrder()).toEqual(["7400", "7450", "7500"]);
    expect(headerCell("Strike").getAttribute("aria-sort")).toBe("ascending");
  });

  it("keeps nulls last whichever direction a metric is sorted", () => {
    render(<ChainTable rows={ROWS} />);
    fireEvent.click(headerCell("Theta (Θ)"));
    expect(strikeOrder()[2]).toBe("7450"); // the all-null row
    fireEvent.click(headerCell("Theta (Θ)"));
    expect(strikeOrder()[2]).toBe("7450");
  });
});
