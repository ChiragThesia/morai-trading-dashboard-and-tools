/**
 * CandidateTable — the ranked candidate <table> (UI-SPEC "Table Contract"), shared by the
 * desktop rail (Analyzer.tsx CandidateRail, vertical scroll inside its Panel) and the mobile
 * tree (AnalyzerMobile.tsx, horizontal scroll wrapper — user-locked 2026-07-14: the table
 * replaces the phase-36 card stack on mobile, h-scroll explicitly OK).
 *
 * Moved verbatim out of screens/Analyzer.tsx (sort helpers + SortableHeader + CandidateRow)
 * so both trees import from here without a screens→screens cycle. Analyzer.tsx re-exports
 * the public names its tests already use.
 *
 * No any/as/!.
 */
import type { PickerCandidate } from "@morai/contracts";
import { cn } from "@/lib/utils";
import { Button } from "../system/index.tsx";
import { scoreStatus } from "../../screens/analyzer-mobile/useAnalyzerModel.ts";

export type CandidateSortKey = "score" | "debit" | "theta";

export interface CandidateSortState {
  readonly key: CandidateSortKey;
  readonly dir: "asc" | "desc";
}

export const DEFAULT_CANDIDATE_SORT: CandidateSortState = { key: "score", dir: "desc" };

const SORT_LABEL: Record<CandidateSortKey, string> = { score: "Score", debit: "Debit", theta: "Θ/d" };

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

function SortableHeader({
  sortKey,
  sort,
  onSortChange,
}: {
  readonly sortKey: CandidateSortKey;
  readonly sort: CandidateSortState;
  readonly onSortChange: (key: CandidateSortKey) => void;
}): React.ReactElement {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className="cursor-pointer border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase hover:text-txt"
      aria-sort={ariaSort}
      data-testid={`rail-sort-${sortKey}`}
      onClick={() => { onSortChange(sortKey); }}
    >
      {SORT_LABEL[sortKey]}
      {active && <span className="ml-0.5">{sort.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

interface CandidateRowProps {
  readonly candidate: PickerCandidate;
  readonly pasted: boolean;
  readonly selected: boolean;
  readonly combinedIds: ReadonlySet<string>;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onRemove?: (candidate: PickerCandidate) => void;
}

/** One <tr> in the ranked table. Row click selects (UI-SPEC Selection linkage); the action
 *  cell stopPropagations so ⊕/× never also select the row (Overview.tsx's own td-onClick
 *  precedent). */
function CandidateRow({
  candidate,
  pasted,
  selected,
  combinedIds,
  onSelect,
  onToggleCombine,
  onRemove,
}: CandidateRowProps): React.ReactElement {
  const notScored = candidate.breakdown.length === 0;
  const event = candidate.frontEvents[0] ?? candidate.backEvents[0] ?? null;
  const eventCount = candidate.frontEvents.length + candidate.backEvents.length;

  return (
    <tr
      data-testid={`candidate-row-${candidate.id}`}
      onClick={() => { onSelect(candidate); }}
      className={cn(
        "cursor-pointer border-b border-line/60 text-txt hover:bg-line/40",
        selected && "border-l-2 border-l-violet bg-violet/[0.06]",
      )}
    >
      <td className="px-2 py-1.5 text-right">
        <span className="inline-flex items-center gap-1">
          {pasted && (
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
      </td>
      <td className="px-2 py-1.5 text-left whitespace-nowrap">{compactCalendarName(candidate.name)}</td>
      <td className="px-2 py-1.5 text-right">
        {notScored ? <span className="text-dim">—</span> : `$${Math.round(candidate.debit)}`}
      </td>
      <td className="px-2 py-1.5 text-right">
        {notScored ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.delta >= 0 ? "+" : ""}${candidate.delta.toFixed(2)}`
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {notScored || candidate.gamma === null ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.gamma >= 0 ? "+" : ""}${candidate.gamma.toFixed(3)}`
        )}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right",
          !notScored && (candidate.theta >= 0 ? "text-up" : "text-down"),
        )}
      >
        {notScored ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {notScored ? (
          <span className="text-dim">—</span>
        ) : (
          `${candidate.vega >= 0 ? "+" : ""}${candidate.vega.toFixed(1)}`
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {notScored ? (
          <span className="text-dim">—</span>
        ) : (
          `${(candidate.frontLeg.iv * 100).toFixed(1)}/${(candidate.backLeg.iv * 100).toFixed(1)}`
        )}
      </td>
      <td className="px-2 py-1.5 text-left">
        {event === null ? (
          <span className="text-dim">—</span>
        ) : (
          <span className="rounded-sm bg-raise px-1 py-0.5 text-amber">
            {`⚡ ${event}${eventCount > 1 ? ` +${eventCount - 1}` : ""}`}
          </span>
        )}
      </td>
      <td className="px-1 py-1.5" onClick={(e) => { e.stopPropagation(); }}>
        <span className="flex items-center justify-center gap-1">
          <Button
            variant="toggle"
            tone="amber"
            size="xs"
            active={combinedIds.has(candidate.id)}
            data-testid={`combine-${candidate.id}`}
            aria-label={`Combine ${candidate.name}`}
            onClick={() => { onToggleCombine(candidate); }}
          >
            {"⊕"}
          </Button>
          {pasted && onRemove !== undefined && (
            <Button
              variant="destructive"
              data-testid={`remove-pasted-${candidate.id}`}
              title="Remove this pasted calendar"
              className="px-1 text-[10px] leading-none"
              onClick={() => { onRemove(candidate); }}
            >
              {"×"}
            </Button>
          )}
        </span>
      </td>
    </tr>
  );
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
  return (
    <div className={wrapperClassName} data-testid={wrapperTestId}>
      <table className={cn("w-full border-collapse font-mono text-[11px] tabular-nums", tableClassName)}>
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            <SortableHeader sortKey="score" sort={sort} onSortChange={onSortChange} />
            <th className="border-b border-line px-2 py-1.5 text-left font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              Calendar
            </th>
            <SortableHeader sortKey="debit" sort={sort} onSortChange={onSortChange} />
            <th className="border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              Δ
            </th>
            <th className="border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              Γ
            </th>
            <SortableHeader sortKey="theta" sort={sort} onSortChange={onSortChange} />
            <th className="border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              Vega
            </th>
            <th className="border-b border-line px-2 py-1.5 text-right font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              IV f/b
            </th>
            <th className="border-b border-line px-2 py-1.5 text-left font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
              Event
            </th>
            <th className="border-b border-line px-1 py-1.5">
              <span className="sr-only">Combine</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pastedCandidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              pasted
              selected={candidate.id === selectedId}
              combinedIds={combinedIds}
              onSelect={onSelect}
              onToggleCombine={onToggleCombine}
              onRemove={onRemovePasted}
            />
          ))}
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              pasted={false}
              selected={candidate.id === selectedId}
              combinedIds={combinedIds}
              onSelect={onSelect}
              onToggleCombine={onToggleCombine}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
