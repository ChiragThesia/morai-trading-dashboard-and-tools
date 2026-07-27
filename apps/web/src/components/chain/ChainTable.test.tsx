/**
 * ChainTable.test.tsx — the chain data table.
 *
 * One row per strike; clicking it expands the per-leg detail in place (the
 * Journal trade-ledger idiom). Every number is reported as-is; a value that
 * could not be computed renders an em dash, never a 0.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ChainTable, DEFAULT_CHAIN_SORT, cycleSort, sortChainRows } from "./ChainTable.tsx";
import { buildCalendarRow } from "../../lib/chain-math.ts";
import type { ChainCalendarRow } from "../../lib/chain-math.ts";
import type { ChainRow } from "../../lib/chain-contract.ts";

function leg(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6500_000,
    expiration: "2026-08-21",
    contractType: "P",
    dte: 26,
    bsmIv: 0.15,
    bid: 40,
    ask: 42,
    openInterest: 100,
    underlyingPrice: 6500,
    source: "schwab",
    observedAt: "2026-07-26T18:00:00.000Z",
    ...over,
  };
}

function calendarRow(strike: number, over: Partial<ChainRow> = {}): ChainCalendarRow {
  return buildCalendarRow(
    leg({ strike: strike * 1000, ...over }),
    leg({ strike: strike * 1000, expiration: "2026-09-18", dte: 54, bsmIv: 0.17, bid: 66, ask: 70 }),
    0.15,
    0.17,
  );
}

const ROWS = [calendarRow(6400), calendarRow(6500), calendarRow(6600)];

function renderTable(
  props: Partial<React.ComponentProps<typeof ChainTable>> = {},
): ReturnType<typeof render> {
  return render(
    <ChainTable
      rows={ROWS}
      expandedStrike={null}
      onToggleExpand={() => undefined}
      sort={DEFAULT_CHAIN_SORT}
      onSortChange={() => undefined}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("ChainTable — rows", () => {
  it("renders one row per strike", () => {
    renderTable();
    expect(screen.getByTestId("chain-row-6400")).toBeTruthy();
    expect(screen.getByTestId("chain-row-6500")).toBeTruthy();
    expect(screen.getByTestId("chain-row-6600")).toBeTruthy();
  });

  it("shows both legs' IV as percentages on the row", () => {
    renderTable();
    const row = screen.getByTestId("chain-row-6500");
    expect(within(row).getByTestId("chain-front-iv").textContent).toBe("15.00%");
    expect(within(row).getByTestId("chain-back-iv").textContent).toBe("17.00%");
  });

  it("shows horizontal skew and edge in vol points", () => {
    renderTable();
    const row = screen.getByTestId("chain-row-6500");
    expect(within(row).getByTestId("chain-hskew").textContent).toBe("+2.00");
    // front 15% vs the forward implied by 15/17 over 26/54 days → negative edge.
    expect(within(row).getByTestId("chain-edge").textContent?.startsWith("-")).toBe(true);
  });

  it("shows the calendar's net greeks", () => {
    renderTable();
    const row = screen.getByTestId("chain-row-6500");
    expect(within(row).getByTestId("chain-net-theta").textContent).not.toBe("—");
    expect(within(row).getByTestId("chain-net-vega").textContent).not.toBe("—");
  });

  it("renders an em dash — never a 0 — where the IV is missing", () => {
    render(
      <ChainTable
        rows={[calendarRow(6500, { bsmIv: null })]}
        expandedStrike={null}
        onToggleExpand={() => undefined}
        sort={DEFAULT_CHAIN_SORT}
        onSortChange={() => undefined}
      />,
    );
    const row = screen.getByTestId("chain-row-6500");
    expect(within(row).getByTestId("chain-front-iv").textContent).toBe("—");
    expect(within(row).getByTestId("chain-hskew").textContent).toBe("—");
    expect(within(row).getByTestId("chain-edge").textContent).toBe("—");
    expect(within(row).getByTestId("chain-net-theta").textContent).toBe("—");
  });

  it("renders an empty-state line instead of a headerless table when there are no rows", () => {
    renderTable({ rows: [] });
    expect(screen.getByTestId("chain-empty")).toBeTruthy();
    expect(screen.queryByTestId("chain-row-6500")).toBeNull();
  });
});

describe("ChainTable — expansion", () => {
  it("clicking a row asks the caller to expand it", () => {
    const seen: number[] = [];
    renderTable({ onToggleExpand: (r) => seen.push(r.strike) });
    fireEvent.click(screen.getByTestId("chain-row-6500"));
    expect(seen).toEqual([6500]);
  });

  it("renders the per-leg detail only for the expanded strike", () => {
    renderTable({ expandedStrike: 6500 });
    expect(screen.getByTestId("chain-detail-6500")).toBeTruthy();
    expect(screen.queryByTestId("chain-detail-6400")).toBeNull();
  });

  it("the detail carries each leg's expiry, quote, IV and greeks", () => {
    renderTable({ expandedStrike: 6500 });
    const detail = screen.getByTestId("chain-detail-6500");
    expect(within(detail).getByTestId("chain-leg-front")).toBeTruthy();
    expect(within(detail).getByTestId("chain-leg-back")).toBeTruthy();
    expect(detail.textContent).toContain("2026-08-21");
    expect(detail.textContent).toContain("2026-09-18");
    // bid/ask and the mid the debit is built from.
    expect(detail.textContent).toContain("40.00");
    expect(detail.textContent).toContain("42.00");
    // provenance
    expect(detail.textContent).toContain("schwab");
  });
});

describe("ChainTable — sorting", () => {
  it("defaults to ascending strike", () => {
    expect(DEFAULT_CHAIN_SORT).toEqual({ key: "strike", dir: "asc" });
  });

  it("cycleSort opens a new column descending and flips on re-click", () => {
    expect(cycleSort(DEFAULT_CHAIN_SORT, "edge")).toEqual({ key: "edge", dir: "desc" });
    expect(cycleSort({ key: "edge", dir: "desc" }, "edge")).toEqual({ key: "edge", dir: "asc" });
  });

  it("sortChainRows orders by the chosen key and direction", () => {
    const asc = sortChainRows(ROWS, { key: "strike", dir: "asc" });
    expect(asc.map((r) => r.strike)).toEqual([6400, 6500, 6600]);
    const desc = sortChainRows(ROWS, { key: "strike", dir: "desc" });
    expect(desc.map((r) => r.strike)).toEqual([6600, 6500, 6400]);
  });

  it("sortChainRows pushes null values to the bottom in both directions", () => {
    const rows = [calendarRow(6400, { bsmIv: null }), calendarRow(6500), calendarRow(6600)];
    expect(sortChainRows(rows, { key: "edge", dir: "desc" }).at(-1)?.strike).toBe(6400);
    expect(sortChainRows(rows, { key: "edge", dir: "asc" }).at(-1)?.strike).toBe(6400);
  });

  it("clicking a sortable header emits its key", () => {
    const seen: string[] = [];
    renderTable({ onSortChange: (k) => seen.push(k) });
    fireEvent.click(screen.getByTestId("chain-sort-edge"));
    expect(seen).toEqual(["edge"]);
  });
});

describe("ChainTable — one tree for all viewports", () => {
  it("puts the table in a horizontal-scroll wrapper with a min width", () => {
    renderTable();
    const wrapper = screen.getByTestId("chain-table-scroll");
    expect(wrapper.className).toContain("overflow-x-auto");
    const table = wrapper.querySelector("table");
    expect(table?.className).toContain("min-w-[");
  });

  it("renders the same column count at every viewport — no dropped columns", () => {
    renderTable();
    const headers = screen.getByTestId("chain-table-scroll").querySelectorAll("thead th");
    expect(headers.length).toBeGreaterThanOrEqual(12);
  });
});
