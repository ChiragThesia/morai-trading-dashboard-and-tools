/**
 * DataTable.test.tsx — TDD RED→GREEN for the generic, presentational table primitive
 * (Phase 42 Plan 01). Synthetic TestRow only — no @morai/contracts domain types in this
 * unit test (RESEARCH Open Question 2).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { DataTable, type DataTableColumn } from "./DataTable.tsx";

afterEach(() => cleanup());

interface TestRow {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

const ROWS: ReadonlyArray<TestRow> = [
  { id: "a1", label: "Alpha", value: 10 },
  { id: "b2", label: "Beta", value: 20 },
];

const COLUMNS: ReadonlyArray<DataTableColumn<TestRow>> = [
  { key: "label", header: "Label", align: "left", render: (r) => r.label },
  { key: "value", header: "Value", sortable: true, render: (r) => r.value },
];

describe("DataTable — generic presentational table primitive", () => {
  it("renders one <tr> per row with rowTestId-derived data-testid", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
      />,
    );
    expect(screen.getByTestId("row-a1")).toBeDefined();
    expect(screen.getByTestId("row-b2")).toBeDefined();
  });

  it("renders every column's render(row) output, in column order, inside <td> cells", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
      />,
    );
    const row = screen.getByTestId("row-a1");
    const cells = row.querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[0]?.textContent).toBe("Alpha");
    expect(cells[1]?.textContent).toBe("10");
  });

  it("align=left gets text-left on header + cell; default (omitted) gets text-right", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]?.className).toContain("text-left");
    expect(headers[1]?.className).toContain("text-right");

    const row = screen.getByTestId("row-a1");
    const cells = row.querySelectorAll("td");
    expect(cells[0]?.className).toContain("text-left");
    expect(cells[1]?.className).toContain("text-right");
  });

  it("reflects the sort prop as aria-sort + glyph on the active sortable column", () => {
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        sort={{ key: "value", dir: "desc" }}
      />,
    );
    const valueHeader = screen.getAllByRole("columnheader")[1];
    expect(valueHeader?.getAttribute("aria-sort")).toBe("descending");
    expect(valueHeader?.textContent).toContain("▼");

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        sort={{ key: "value", dir: "asc" }}
      />,
    );
    const valueHeaderAsc = screen.getAllByRole("columnheader")[1];
    expect(valueHeaderAsc?.getAttribute("aria-sort")).toBe("ascending");
    expect(valueHeaderAsc?.textContent).toContain("▲");
  });

  it("unsorted sortable column has aria-sort=none and no glyph", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
      />,
    );
    const valueHeader = screen.getAllByRole("columnheader")[1];
    expect(valueHeader?.getAttribute("aria-sort")).toBe("none");
    expect(valueHeader?.textContent).not.toContain("▲");
    expect(valueHeader?.textContent).not.toContain("▼");
  });

  it("clicking a sortable header calls onSortChange with that column's key", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        onSortChange={onSortChange}
      />,
    );
    const valueHeader = screen.getAllByRole("columnheader")[1];
    assertDefined(valueHeader, "value column header present");
    fireEvent.click(valueHeader);
    expect(onSortChange).toHaveBeenCalledWith("value");
  });

  it("clicking a non-sortable header does not call onSortChange and carries no aria-sort", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        onSortChange={onSortChange}
      />,
    );
    const labelHeader = screen.getAllByRole("columnheader")[0];
    assertDefined(labelHeader, "label column header present");
    expect(labelHeader.getAttribute("aria-sort")).toBeNull();
    fireEvent.click(labelHeader);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("clicking a row calls onRowClick(row)", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-a1"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("onRowMouseEnter/onRowMouseLeave fire on hover", () => {
    const onRowMouseEnter = vi.fn();
    const onRowMouseLeave = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        onRowMouseEnter={onRowMouseEnter}
        onRowMouseLeave={onRowMouseLeave}
      />,
    );
    const row = screen.getByTestId("row-a1");
    fireEvent.mouseEnter(row);
    expect(onRowMouseEnter).toHaveBeenCalledWith(ROWS[0]);
    fireEvent.mouseLeave(row);
    expect(onRowMouseLeave).toHaveBeenCalledWith(ROWS[0]);
  });

  it("rowClassName(row) is applied to the row's <tr> className", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        rowClassName={(r) => (r.id === "a1" ? "custom-highlight" : "")}
      />,
    );
    expect(screen.getByTestId("row-a1").className).toContain("custom-highlight");
    expect(screen.getByTestId("row-b2").className).not.toContain("custom-highlight");
  });

  it("renderRowDetail(row) emits an extra <tr> immediately after that row; null emits nothing extra", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        renderRowDetail={(r) =>
          r.id === "a1" ? (
            <tr data-testid="detail-row-a1">
              <td data-testid="detail-a1">detail</td>
            </tr>
          ) : null
        }
      />,
    );
    expect(screen.getByTestId("detail-a1")).toBeDefined();
    const rowA1 = screen.getByTestId("row-a1");
    const detailRow = rowA1.nextElementSibling;
    expect(detailRow?.querySelector('[data-testid="detail-a1"]')).toBeDefined();
  });

  it("footer node renders inside tbody after all mapped rows", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap"
        footer={
          <tr data-testid="footer-row">
            <td>footer</td>
          </tr>
        }
      />,
    );
    const footerRow = screen.getByTestId("footer-row");
    const tbody = footerRow.closest("tbody");
    expect(tbody).not.toBeNull();
    const rowB2 = screen.getByTestId("row-b2");
    expect(rowB2.compareDocumentPosition(footerRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("structural chrome: thead sticky classes, wrapper div classes/testid, table className", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowTestId={(r) => `row-${r.id}`}
        wrapperClassName="wrap-class"
        wrapperTestId="wrap-testid"
        tableClassName="table-class"
      />,
    );
    const wrapper = screen.getByTestId("wrap-testid");
    expect(wrapper.className).toContain("wrap-class");
    const table = wrapper.querySelector("table");
    expect(table?.className).toContain("table-class");
    const thead = wrapper.querySelector("thead");
    expect(thead?.className).toContain("sticky");
    expect(thead?.className).toContain("top-0");
    expect(thead?.className).toContain("z-10");
    expect(thead?.className).toContain("bg-panel");
  });
});
