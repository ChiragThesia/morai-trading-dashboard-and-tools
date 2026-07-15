/**
 * DataTable<T> — the one generic, presentational table primitive (Phase 42 Plan 01).
 *
 * Sort state, selection state, and hover state are all CALLER-owned — DataTable never holds
 * a useState; it only renders the given `sort` prop as `aria-sort` and emits `onSortChange`/
 * `onRowClick`/`onRowMouseEnter`/`onRowMouseLeave`. Chrome (sticky header, row hover, dense
 * cell padding, sort glyph) is reused verbatim from `components/picker/CandidateTable.tsx`
 * (PATTERNS.md "generalize these class strings verbatim") — do not restyle.
 *
 * First generic component in the codebase (RESEARCH Pitfall 7) — uses the `<T,>` trailing-comma
 * disambiguator required by the .tsx parser. No any/as/!.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: React.ReactNode;
  readonly align?: "left" | "right";
  readonly mono?: boolean;
  readonly sortable?: boolean;
  readonly width?: string;
  readonly render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  readonly columns: ReadonlyArray<DataTableColumn<T>>;
  readonly rows: ReadonlyArray<T>;
  readonly rowTestId: (row: T) => string;
  readonly rowClassName?: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  readonly onRowMouseEnter?: (row: T) => void;
  readonly onRowMouseLeave?: (row: T) => void;
  readonly sort?: { key: string; dir: "asc" | "desc" };
  readonly onSortChange?: (key: string) => void;
  readonly wrapperClassName: string;
  readonly wrapperTestId?: string;
  readonly tableClassName?: string;
  readonly renderRowDetail?: (row: T) => React.ReactNode;
  readonly footer?: React.ReactNode;
}

const HEADER_BASE =
  "border-b border-line px-2 py-1.5 font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase";

export function DataTable<T,>({
  columns,
  rows,
  rowTestId,
  rowClassName,
  onRowClick,
  onRowMouseEnter,
  onRowMouseLeave,
  sort,
  onSortChange,
  wrapperClassName,
  wrapperTestId,
  tableClassName,
  renderRowDetail,
  footer,
}: DataTableProps<T>): React.ReactElement {
  return (
    <div className={wrapperClassName} data-testid={wrapperTestId}>
      <table className={cn("w-full border-collapse font-mono text-[11px] tabular-nums", tableClassName)}>
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            {columns.map((col) => {
              const active = col.sortable === true && sort?.key === col.key;
              const ariaSort = active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none";
              const headerClassName = cn(
                HEADER_BASE,
                col.align === "left" ? "text-left" : "text-right",
                col.sortable === true && "cursor-pointer hover:text-txt",
                col.width,
              );
              if (col.sortable === true) {
                return (
                  <th
                    key={col.key}
                    className={headerClassName}
                    aria-sort={ariaSort}
                    onClick={() => { onSortChange?.(col.key); }}
                  >
                    {col.header}
                    {active && <span className="ml-0.5">{sort?.dir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                );
              }
              return (
                <th key={col.key} className={headerClassName}>
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const testId = rowTestId(row);
            const detail = renderRowDetail?.(row);
            return (
              <React.Fragment key={testId}>
                <tr
                  data-testid={testId}
                  onClick={() => { onRowClick?.(row); }}
                  onMouseEnter={() => { onRowMouseEnter?.(row); }}
                  onMouseLeave={() => { onRowMouseLeave?.(row); }}
                  className={cn(
                    "cursor-pointer border-b border-line/60 text-txt hover:bg-line/40",
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-2 py-1.5",
                        col.align === "left" ? "text-left" : "text-right",
                        col.mono === false && "font-sans",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {detail !== null && detail !== undefined && detail}
              </React.Fragment>
            );
          })}
          {footer}
        </tbody>
      </table>
    </div>
  );
}
