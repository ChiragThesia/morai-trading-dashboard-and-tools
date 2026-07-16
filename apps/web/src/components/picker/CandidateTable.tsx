/**
 * CandidateTable — the ranked candidate table (UI-SPEC "Table Contract"), shared by the
 * desktop rail (Analyzer.tsx CandidateRail, vertical scroll inside its Panel) and the mobile
 * tree (AnalyzerMobile.tsx, horizontal scroll wrapper — user-locked 2026-07-14: the table
 * replaces the phase-36 card stack on mobile, h-scroll explicitly OK).
 *
 * Phase 42 Plan 02: thin wrapper over the shared `DataTable<T>` primitive (Plan 01) — column
 * defs + rows built here, chrome/sort/selection rendering delegated to DataTable. Public API
 * and every module-level export stay byte-stable so Analyzer.tsx/AnalyzerMobile.tsx need zero
 * changes (Migration Manifest step 2).
 *
 * No any/as/!.
 */
import type { PickerCandidate } from "@morai/contracts";
import { cn } from "@/lib/utils";
import { Button, DataTable } from "../system/index.tsx";
import type { DataTableColumn } from "../system/index.tsx";
import { scoreStatus } from "../../screens/analyzer-mobile/useAnalyzerModel.ts";

export type CandidateSortKey = "score" | "debit" | "theta";

export interface CandidateSortState {
  readonly key: CandidateSortKey;
  readonly dir: "asc" | "desc";
}

export const DEFAULT_CANDIDATE_SORT: CandidateSortState = { key: "score", dir: "desc" };

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Shortens ISO dates inside a candidate name ("7525P 2026-08-06 / 2026-08-10" →
 *  "7525P Aug 6 / Aug 10") so table rows stay one line. Pure string transform — no Date
 *  construction (local-vs-UTC shift risk); non-date text passes through untouched. */
export function compactCalendarName(name: string): string {
  return name.replace(/\b\d{4}-(\d{2})-(\d{2})\b/g, (match, month: string, day: string) => {
    const abbrev = MONTH_ABBREV[Number(month) - 1];
    return abbrev === undefined ? match : `${abbrev} ${Number(day)}`;
  });
}

function sortValue(candidate: PickerCandidate, key: CandidateSortKey): number {
  if (key === "score") return candidate.score;
  if (key === "debit") return candidate.debit;
  return candidate.theta;
}

/** Sorts a COPY of `candidates` by the active column/direction — never mutates the input;
 *  pasted rows are never passed through this (they stay pinned above, unsorted). */
export function sortCandidates(
  candidates: ReadonlyArray<PickerCandidate>,
  sort: CandidateSortState,
): ReadonlyArray<PickerCandidate> {
  return [...candidates].sort((a, b) => {
    const diff = sortValue(b, sort.key) - sortValue(a, sort.key);
    return sort.dir === "desc" ? diff : -diff;
  });
}

/** Cycles a sortable header's state: clicking a new column starts it at desc; clicking the
 *  already-active column flips desc<->asc (UI-SPEC Sort affordance — 2 states + "not active"). */
export function cycleSort(current: CandidateSortState, clicked: CandidateSortKey): CandidateSortState {
  if (current.key !== clicked) return { key: clicked, dir: "desc" };
  return { key: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
}

/** Type guard narrowing DataTable's generic string sort key to CandidateSortKey — DataTable
 *  is presentational and knows nothing about this file's sort domain. */
function isCandidateSortKey(key: string): key is CandidateSortKey {
  return key === "score" || key === "debit" || key === "theta";
}

export interface CandidateTableProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
  /** User-pasted calendars, pinned above `candidates` in paste order. */
  readonly pastedCandidates: ReadonlyArray<PickerCandidate>;
  readonly selectedId: string;
  readonly combinedIds: ReadonlySet<string>;
  readonly sort: CandidateSortState;
  readonly onSortChange: (key: CandidateSortKey) => void;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  /** Removes one pasted row (its own × button) — leaves other pasted rows untouched. */
  readonly onRemovePasted: (candidate: PickerCandidate) => void;
  /** Scroll-container classes — the desktop rail caps height (vertical scroll, sticky header);
   *  the mobile tree scrolls horizontally instead (overflow-x-auto + min-w on the table). */
  readonly wrapperClassName: string;
  /** Extra classes on the <table> itself (mobile sets a min width so columns never crush). */
  readonly tableClassName?: string;
  /** Test hook on the scroll container (the mobile tree asserts its h-scroll behavior). */
  readonly wrapperTestId?: string;
}

export function CandidateTable({
  candidates,
  pastedCandidates,
  selectedId,
  combinedIds,
  sort,
  onSortChange,
  onSelect,
  onToggleCombine,
  onRemovePasted,
  wrapperClassName,
  tableClassName,
  wrapperTestId,
}: CandidateTableProps): React.ReactElement {
  const pastedIds = new Set(pastedCandidates.map((c) => c.id));

  const handleSort = (key: string): void => {
    if (isCandidateSortKey(key)) onSortChange(key);
  };

  const columns: ReadonlyArray<DataTableColumn<PickerCandidate>> = [
    {
      key: "score",
      header: "Score",
      sortable: true,
      headerTestId: "rail-sort-score",
      render: (candidate) => {
        const notScored = candidate.breakdown.length === 0;
        return (
          <span className="inline-flex items-center gap-1">
            {pastedIds.has(candidate.id) && (
              <span className="rounded-sm bg-violet/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-violet">
                PASTED
              </span>
            )}
            {!notScored && (
              <span className={cn("font-bold", scoreStatus(candidate.score).cls)}>
                {Math.round(candidate.score)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "name",
      header: "Calendar",
      align: "left",
      render: (candidate) => <span className="whitespace-nowrap">{compactCalendarName(candidate.name)}</span>,
    },
    {
      key: "debit",
      header: "Debit",
      sortable: true,
      headerTestId: "rail-sort-debit",
      render: (candidate) =>
        candidate.breakdown.length === 0 ? (
          <span className="text-dim">—</span>
        ) : (
          `$${Math.round(candidate.debit)}`
        ),
    },
    {
      key: "delta",
      header: "Δ",
      render: (candidate) =>
        candidate.breakdown.length === 0 ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.delta >= 0 ? "+" : ""}${candidate.delta.toFixed(2)}`
        ),
    },
    {
      key: "gamma",
      header: "Γ",
      render: (candidate) =>
        candidate.breakdown.length === 0 || candidate.gamma === null ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.gamma >= 0 ? "+" : ""}${candidate.gamma.toFixed(3)}`
        ),
    },
    {
      key: "theta",
      header: "Θ/d",
      sortable: true,
      headerTestId: "rail-sort-theta",
      render: (candidate) => {
        const notScored = candidate.breakdown.length === 0;
        return (
          <span className={cn(!notScored && (candidate.theta >= 0 ? "text-up" : "text-down"))}>
            {notScored ? (
              <span className="text-dim">—</span>
            ) : (
              `${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`
            )}
          </span>
        );
      },
    },
    {
      key: "vega",
      header: "Vega",
      render: (candidate) =>
        candidate.breakdown.length === 0 ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.vega >= 0 ? "+" : ""}${candidate.vega.toFixed(1)}`
        ),
    },
    {
      key: "iv",
      header: "IV f/b",
      render: (candidate) =>
        candidate.breakdown.length === 0 ? (
          <span className="text-dim">—</span>
        ) : (
          `${(candidate.frontLeg.iv * 100).toFixed(1)}/${(candidate.backLeg.iv * 100).toFixed(1)}`
        ),
    },
    {
      key: "event",
      header: "Event",
      align: "left",
      render: (candidate) => {
        const event = candidate.frontEvents[0] ?? candidate.backEvents[0] ?? null;
        const eventCount = candidate.frontEvents.length + candidate.backEvents.length;
        return event === null ? (
          <span className="text-dim">—</span>
        ) : (
          <span className="rounded-sm bg-raise px-1 py-0.5 text-amber">
            {`⚡ ${event}${eventCount > 1 ? ` +${eventCount - 1}` : ""}`}
          </span>
        );
      },
    },
    {
      key: "combine",
      header: <span className="sr-only">Combine</span>,
      render: (candidate) => (
        <span
          className="flex items-center justify-center gap-1"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <Button
            variant="toggle"
            tone="amber"
            size="xs"
            active={combinedIds.has(candidate.id)}
            data-testid={`combine-${candidate.id}`}
            aria-label={`Combine ${candidate.name}`}
            onClick={() => {
              onToggleCombine(candidate);
            }}
          >
            {"⊕"}
          </Button>
          {pastedIds.has(candidate.id) && (
            <Button
              variant="destructive"
              data-testid={`remove-pasted-${candidate.id}`}
              title="Remove this pasted calendar"
              className="px-1 text-[10px] leading-none"
              onClick={() => {
                onRemovePasted(candidate);
              }}
            >
              {"×"}
            </Button>
          )}
        </span>
      ),
    },
  ];

  const rows = [...pastedCandidates, ...candidates];

  // exactOptionalPropertyTypes: build the optional-key props via spread rather than passing
  // `tableClassName={tableClassName}` (string | undefined) into a `tableClassName?: string` slot.
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowTestId={(c) => `candidate-row-${c.id}`}
      rowClassName={(c) => (c.id === selectedId ? "border-l-2 border-l-violet bg-violet/[0.06]" : "")}
      onRowClick={onSelect}
      sort={sort}
      onSortChange={handleSort}
      wrapperClassName={wrapperClassName}
      {...(tableClassName !== undefined ? { tableClassName } : {})}
      {...(wrapperTestId !== undefined ? { wrapperTestId } : {})}
    />
  );
}
