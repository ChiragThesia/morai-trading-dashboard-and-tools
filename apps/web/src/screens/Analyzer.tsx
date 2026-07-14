/**
 * Analyzer — ranked-cards calendar PICKER (Phase 18, D-04 — full replacement of the
 * position-analyzer cockpit). Phase 19 (PICK-02) swaps the frozen fixture for live data.
 *
 * UI-SPEC "Ranked candidate cards" / "Payoff center": 3-col grid (300px/1fr/330px, stacking
 * below 1280px in DOM order):
 *   Left (300px)  — "Suggested calendars": ranked candidate table (ANLZ-01, D-01/D-05,
 *                   Phase 41 AUI-01/AUI-03),
 *                   now sourced from usePicker() with loading/error/cold-start/zero-filtered
 *                   states (19-UI-SPEC "Rail live-data states", D-18/D-19).
 *   Center (1fr)  — "Risk profile" (payoff center, wired in Task 3) + "Scoring methodology"
 *                   collapsible panel (locked reference copy, not fixture-driven).
 *   Right (330px) — "Why this calendar" / "Term structure + your legs" / "Entry / exit plan"
 *                   panel shells — content lands in 18-05 (out of this plan's scope).
 *
 * PICK-02 "no layout change": the 3-column grid, card anatomy, breakdown bars, why-panel,
 * term-structure, and entry/exit plan are UNCHANGED from Phase 18 — this is an import-only
 * data-source swap (`usePicker().data` replaces the Phase-18 frozen fixture import) plus the
 * additive rail states the synchronous fixture never needed.
 *
 * Keeps the exact `export function Analyzer(): React.ReactElement` name/signature so
 * `App.tsx`'s route wiring needs zero changes.
 *
 * No any/as/!.
 */
import type { PickerCandidate, PickerGexContext, RuleSetEntry, PickerSizing } from "@morai/contracts";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { WhyPanel } from "../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
import { formatAsOf } from "../components/picker/CandidateCard.tsx";
import { Panel, PanelHeading, Button } from "../components/system/index.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { useIsDesktop } from "../hooks/useIsDesktop.ts";
import { AnalyzerMobile } from "./analyzer-mobile/AnalyzerMobile.tsx";
import {
  useAnalyzerModel,
  scoreStatus,
  CHIP_LABELS,
  FALLBACK_SCORE_ITEMS,
  EXPERIMENTAL_SHORT,
  PASTED_NOT_SCORED_NOTE,
  TODAY_CURVE_COLOR,
  EXPIRATION_CURVE_COLOR,
  GROUP_OF,
  verdictWord,
} from "./analyzer-mobile/useAnalyzerModel.ts";

// ─── Constants ────────────────────────────────────────────────────────────────
//
// The picker curve colors, the not-scored note, the chip labels/weights helper, and the
// paste-error copy now live in analyzer-mobile/useAnalyzerModel.ts (D-02, single source —
// both trees import them). This file re-imports the ones its desktop view still renders.

function noop(): void {}

// ─── Ranked candidate table (D-01, D-03) ───────────────────────────────────────
//
// Replaces the 17-CandidateCard scroll rail with one compact sortable <table> (UI-SPEC
// "Table Contract"). Sort state is local to AnalyzerDesktop (NOT the shared model hook —
// mobile keeps CandidateCard, no table there, research OQ2).

export type CandidateSortKey = "score" | "debit" | "theta";

export interface CandidateSortState {
  readonly key: CandidateSortKey;
  readonly dir: "asc" | "desc";
}

export const DEFAULT_CANDIDATE_SORT: CandidateSortState = { key: "score", dir: "desc" };

const SORT_LABEL: Record<CandidateSortKey, string> = { score: "Score", debit: "Debit", theta: "Θ/d" };

function sortValue(candidate: PickerCandidate, key: CandidateSortKey): number {
  if (key === "score") return candidate.score;
  if (key === "debit") return candidate.debit;
  return candidate.theta;
}

/** Sorts a COPY of `candidates` by the active column/direction — never mutates the input;
 *  pasted rows are never passed through this (they stay pinned above, unsorted). */
function sortCandidates(
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
function cycleSort(current: CandidateSortState, clicked: CandidateSortKey): CandidateSortState {
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
      <td className="px-2 py-1.5 text-left">{candidate.name}</td>
      <td className="px-2 py-1.5 text-right">
        {notScored ? <span className="text-dim">—</span> : `$${Math.round(candidate.debit)}`}
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

// ─── Suggested calendars rail ──────────────────────────────────────────────────

export interface CandidateRailProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
  /** User-pasted calendars (multi-paste redesign), pinned above `candidates` in paste order. */
  readonly pastedCandidates: ReadonlyArray<PickerCandidate>;
  /** Controlled paste-input text (Analyzer owns the state). */
  readonly pasteText: string;
  /** Parse-failure copy, or null when the last Analyze succeeded / hasn't run yet. */
  readonly pasteError: string | null;
  /** Date-only reference date for the empty-state message (DTE/event x-axis anchor). */
  readonly asOf: string;
  readonly selectedId: string;
  readonly combinedIds: ReadonlySet<string>;
  readonly sort: CandidateSortState;
  readonly onSortChange: (key: CandidateSortKey) => void;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onPasteTextChange: (text: string) => void;
  readonly onPasteAnalyze: () => void;
  /** Removes one pasted row (its own × button) — leaves other pasted rows untouched. */
  readonly onRemovePasted: (candidate: PickerCandidate) => void;
  /** Removes every pasted row at once. */
  readonly onClearAllPasted: () => void;
  /** Optional heading-row control (the Re-pull chains button — refreshes THIS rail). */
  readonly headerAction?: React.ReactNode;
}

/**
 * CandidateRail — the "Suggested calendars" panel: ranked candidate table + the
 * zero-candidates-passed-filter empty state (D-18). Exported (like Overview.tsx's
 * `formatExpiryCell`) so the empty-state branch is directly unit-testable.
 *
 * Only handles the "settled response" states (populated / zero-candidates) — the
 * loading/error/cold-start states (D-18/D-19) live one level up in Analyzer(), since they
 * replace this panel's body entirely before a `PickerSnapshotResponse` even exists.
 */
export function CandidateRail({
  candidates,
  pastedCandidates,
  pasteText,
  pasteError,
  asOf,
  selectedId,
  combinedIds,
  sort,
  onSortChange,
  onSelect,
  onToggleCombine,
  onPasteTextChange,
  onPasteAnalyze,
  onRemovePasted,
  onClearAllPasted,
  headerAction,
}: CandidateRailProps): React.ReactElement {
  return (
    <Panel className="max-h-[70vh] overflow-y-auto">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelHeading title="Suggested calendars" />
        <div className="flex items-center gap-1.5">
          {pastedCandidates.length > 0 && (
            <Button variant="ghost" data-testid="picker-paste-clear-all" onClick={onClearAllPasted}>
              Clear all
            </Button>
          )}
          {headerAction}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          data-testid="picker-paste-input"
          value={pasteText}
          onChange={(e) => { onPasteTextChange(e.target.value); }}
          placeholder="Paste a TOS calendar order…"
          className="min-w-0 flex-1 rounded-[3px] border border-line2 bg-transparent px-2 py-1 font-mono text-[10px] text-txt"
        />
        <Button variant="primary" size="sm" data-testid="picker-paste-analyze" onClick={onPasteAnalyze}>
          Analyze
        </Button>
      </div>
      {pasteError !== null && (
        <p data-testid="picker-paste-error" className="mb-2 font-mono text-[9px] text-down">
          {pasteError}
        </p>
      )}
      {candidates.length > 0 && (
        <p className="mb-2 font-mono text-[9px] leading-[1.5] text-dim" data-testid="rail-legend">
          {"θ = daily $ decay · vega = $ per vol-pt · "}
          <span className="text-amber">◂f</span>
          {"/"}
          <span className="text-amber">◂b</span>
          {" = event on front / back leg · bars = scored factors (higher = better)"}
        </p>
      )}
      {candidates.length === 0 && pastedCandidates.length === 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="picker-empty-filtered">
          <p className="m-0 font-display text-sm font-bold text-txt">No candidates in this snapshot</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            {`No put calendars meet net-θ>0 over the ${asOf} snapshot.`}
          </p>
        </div>
      ) : (
        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              <SortableHeader sortKey="score" sort={sort} onSortChange={onSortChange} />
              <th className="border-b border-line px-2 py-1.5 text-left font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
                Calendar
              </th>
              <SortableHeader sortKey="debit" sort={sort} onSortChange={onSortChange} />
              <SortableHeader sortKey="theta" sort={sort} onSortChange={onSortChange} />
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
      )}
    </Panel>
  );
}

// ─── Verdict hero (per-candidate: how THIS calendar scores on the picking rubric) ──────────
//
// Replaces the retired 11-chip flat scorecard (AUI-02, D-02): one headline (verdict word +
// score + Θ) over three labeled EDGE/RISK/FIT factor-group columns — a re-layout of the
// selected candidate's `breakdown` + the snapshot's `ruleSet` (the engine's own rule
// registry — rules.ts). No new scoring, no new confidence (T-41-03/T-41-04): pass/partial
// status stays weight-relative (contribution is the 0-100 share of a criterion's weight:
// ✓ ≥ ⅔, ~ ≥ ⅓) — no client-side placeholder thresholds.

interface VerdictHeroProps {
  readonly candidate: PickerCandidate | null;
  /** The engine's rule registry from the snapshot (empty on pre-registry snapshots). */
  readonly ruleSet: ReadonlyArray<RuleSetEntry>;
  /** Per-gate drop counts for the snapshot's compute run. */
  readonly gateDrops: { readonly liquidity: number; readonly netTheta: number };
  /** Marks provenance — "after-hours" renders the indicative-marks warning chip. */
  readonly marketSession: "rth" | "after-hours";
  /** Snapshot-level as-of provenance (AUI-07) — footer-only, `formatAsOf` verbatim. */
  readonly observedAt: string;
  readonly source: "schwab" | "cboe";
}

// FALLBACK_SCORE_ITEMS, scoreStatus, CHIP_LABELS, EXPERIMENTAL_SHORT, GROUP_OF, verdictWord
// now live in analyzer-mobile/useAnalyzerModel.ts (D-02, single source) — imported above.

const GROUP_ORDER = ["EDGE", "RISK", "FIT"] as const;

function VerdictHero({
  candidate,
  ruleSet,
  gateDrops,
  marketSession,
  observedAt,
  source,
}: VerdictHeroProps): React.ReactElement | null {
  // No selection -> render nothing (matches MobileScorecard's candidate === null convention).
  if (candidate === null) return null;

  // Not-scored (pasted) -> the honest note only, no verdict word, no groups (catch #23).
  if (candidate.breakdown.length === 0) {
    return (
      <div data-testid="verdict-hero">
        <span className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</span>
      </div>
    );
  }

  // Score rows from the engine's registry when available; legacy fallback otherwise — the
  // exact scoreItems derivation the retired chip strip used, partitioned by GROUP_OF below.
  const scoreRules = ruleSet.filter((r) => r.kind === "score" && r.status === "active");
  const scoreItems =
    scoreRules.length > 0
      ? scoreRules.map((r) => ({ key: r.id, label: CHIP_LABELS[r.id] ?? r.label }))
      : FALLBACK_SCORE_ITEMS.map((item) => ({ key: item.key, label: CHIP_LABELS[item.key] ?? item.label }));

  const verdict = verdictWord(candidate.score);
  const asOf = formatAsOf(observedAt);
  const calibrating =
    candidate.context.length > 0
      ? `CALIBRATING ${candidate.context
          .map(
            (entry) =>
              `${EXPERIMENTAL_SHORT[entry.id] ?? entry.id} ${
                entry.value === null ? "—" : entry.value.toFixed(entry.id === "slopePercentile" ? 0 : 3)
              }`,
          )
          .join(" · ")}`
      : null;
  const drops =
    gateDrops.liquidity > 0 || gateDrops.netTheta > 0
      ? `${gateDrops.liquidity} illiquid quote${gateDrops.liquidity === 1 ? "" : "s"} · ${gateDrops.netTheta} negative-θ pair${gateDrops.netTheta === 1 ? "" : "s"} dropped this run`
      : null;
  const footer = [calibrating, drops, `${asOf.label} · ${source}`].filter((p): p is string => p !== null).join("   ");

  return (
    <div data-testid="verdict-hero">
      <div className="flex flex-wrap items-baseline gap-2" data-testid="verdict-headline">
        <span className={cn("font-display text-[16px] font-semibold", verdict.cls)} data-testid="verdict-word">
          {verdict.icon} {verdict.word}
        </span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-txt" data-testid="verdict-score">
          {`score ${Math.round(candidate.score)}/100`}
        </span>
        <span
          className={cn(
            "font-mono text-[13px] font-semibold tabular-nums",
            candidate.theta >= 0 ? "text-up" : "text-down",
          )}
          data-testid="verdict-theta"
        >
          {`Θ ${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`}
        </span>
      </div>
      {marketSession === "after-hours" && (
        <span
          data-testid="session-badge"
          className="mt-1 inline-block rounded-sm bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-amber"
        >
          {"SESSION · AH — indicative"}
        </span>
      )}
      <div className="mt-2 grid grid-cols-3 gap-4" data-testid="verdict-groups">
        {GROUP_ORDER.map((group) => (
          <div key={group} data-testid={`verdict-group-${group}`}>
            <span className="font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
              {group}
            </span>
            <div className="mt-1 flex flex-col gap-y-1">
              {scoreItems
                .filter((item) => GROUP_OF[item.key] === group)
                .map((item) => {
                  const entry = candidate.breakdown.find((b) => b.criterion === item.key);
                  if (entry === undefined) return null;
                  const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
                  const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(entry.contribution);
                  return (
                    <div
                      key={item.key}
                      data-testid={`checklist-${item.key}`}
                      className="flex items-center justify-between font-mono text-[11px]"
                    >
                      <span className="text-dim">{item.label}</span>
                      <span className={st.cls}>
                        {st.icon} {guard ? "n/a" : `${Math.round(entry.contribution)}%`}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-dim" data-testid="verdict-hero-footer">
        {footer}
      </p>
    </div>
  );
}

// ─── Right column: why-panel / term-structure / entry-exit-plan (ANLZ-03, D-01b) ──

export interface RightColumnProps {
  readonly candidate: PickerCandidate | null;
  readonly gex: PickerGexContext | null;
  /** VIX-tiered sizing recommendation from the snapshot (28-06, PLAY-03) — threaded straight
   *  to EntryExitPlan, never recomputed here. */
  readonly sizing: PickerSizing | null;
}

/**
 * RightColumn — the "Why this calendar" / "Entry / exit plan" stack for the currently-selected
 * candidate. The term-structure chart moved to the center column (stacked under the payoff graph);
 * reads the live snapshot's GEX context (Phase 19: never the frozen fixture).
 */
function RightColumn({ candidate, gex, sizing }: RightColumnProps): React.ReactElement {
  const notScored = candidate !== null && candidate.breakdown.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeading title="Why this calendar" />
        {notScored ? (
          <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
        ) : (
          candidate !== null && gex !== null && <WhyPanel candidate={candidate} gex={gex} />
        )}
      </Panel>
      <Panel>
        <PanelHeading title="Entry / exit plan" />
        {notScored ? (
          <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
        ) : (
          candidate !== null && <EntryExitPlan candidate={candidate} sizing={sizing} />
        )}
      </Panel>
    </div>
  );
}

// ─── Main Analyzer (picker) screen ─────────────────────────────────────────────

/**
 * Analyzer — the thin switch (D-01, verbatim Overview pattern): exactly one tree mounts at a
 * time. Desktop (≥1024px) renders AnalyzerDesktop (today's JSX, byte-identical DOM); below
 * 1024px the dedicated mobile tree. Same public export name/signature — App.tsx wiring
 * unchanged. `CandidateRail` stays exported for direct unit testing.
 */
export function Analyzer(): React.ReactElement {
  const isDesktop = useIsDesktop();
  return isDesktop ? <AnalyzerDesktop /> : <AnalyzerMobile />;
}

/**
 * AnalyzerDesktop — today's Analyzer picker screen (D-01: renamed in-file, JSX untouched).
 * Consumes the shared useAnalyzerModel like the mobile tree does.
 */
function AnalyzerDesktop(): React.ReactElement {
  // All state/derivation lives in useAnalyzerModel (D-02, single source shared with the
  // mobile tree). This desktop view consumes the model slices.
  const {
    snapshot,
    isLoading,
    isError,
    refetch,
    sortedCandidates,
    pastedCandidates,
    pasteText,
    setPasteText,
    pasteError,
    handlePasteAnalyze,
    handleRemovePasted,
    handleClearAllPasted,
    selected,
    selectedId,
    handleSelect,
    combinedIds,
    handleToggleCombine,
    copiedId,
    handleCopyCandidate,
    selectedPosition,
    bounds,
    dateControl,
    toggles,
    handleToggle,
    payoffDomain,
    scenarioResult,
    spot,
    liveBadgeProps,
    bookCount,
    bookDebit,
    bookTheta,
    bookVega,
    positionSetSignature,
    repull,
  } = useAnalyzerModel();

  // Table sort state (D-03) — local to this desktop view, not the shared model hook (mobile
  // has no table). Sorts a COPY of the scored candidates; pasted rows stay pinned above, unsorted.
  const [sort, setSort] = useState<CandidateSortState>(DEFAULT_CANDIDATE_SORT);
  const handleSortChange = (key: CandidateSortKey): void => {
    setSort((prev) => cycleSort(prev, key));
  };
  const sortedRows = useMemo(() => sortCandidates(sortedCandidates, sort), [sortedCandidates, sort]);

  // Re-pull chains control — lives with the rail it refreshes (heading action slot).
  const repullControl = (
    <div className="flex items-center gap-1.5">
      {repull.isSuccess && (
        <span className="font-mono text-[9px] text-dim" data-testid="repull-status">
          queued · ~4 min
        </span>
      )}
      {repull.isError && (
        <span className="font-mono text-[9px] text-down" data-testid="repull-status">
          failed
        </span>
      )}
      <Button
        variant="ghost"
        onClick={() => { repull.mutate(); }}
        disabled={repull.isPending}
        data-testid="repull-chains-button"
        title="Fetch fresh chains and re-score the rail (runs the full pipeline, ~4 min)"
      >
        {repull.isPending ? "Queuing…" : "↻ Re-pull"}
      </Button>
    </div>
  );

  // ── Rail body: five mutually-exclusive states (D-18/D-19), precedence
  // loading → error → cold-start → zero-filtered (inside CandidateRail) → populated. ──
  let railBody: React.ReactElement;
  if (isLoading) {
    railBody = (
      <Panel>
        <PanelHeading title="Suggested calendars" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="picker-loading"
        >
          Loading candidates…
        </div>
      </Panel>
    );
  } else if (isError) {
    railBody = (
      <Panel>
        <PanelHeading title="Suggested calendars" />
        <div className="flex flex-col items-center gap-2 p-4 text-center" data-testid="picker-error">
          <p className="m-0 font-mono text-[12px] text-down">Couldn&apos;t load candidates.</p>
          <Button
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Panel>
    );
  } else if (snapshot === null) {
    railBody = (
      <Panel>
        <div className="mb-2 flex items-center justify-between gap-2">
          <PanelHeading title="Suggested calendars" />
          {repullControl}
        </div>
        <div className="flex flex-col gap-1.5 p-4" data-testid="picker-empty-cold-start">
          <p className="m-0 font-display text-sm font-bold text-txt">Picker warming up</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            First scoring run pending — check back after the next chain snapshot.
          </p>
        </div>
      </Panel>
    );
  } else {
    railBody = (
      <CandidateRail
        candidates={sortedRows}
        pastedCandidates={pastedCandidates}
        pasteText={pasteText}
        pasteError={pasteError}
        asOf={snapshot.asOf}
        selectedId={selectedId}
        combinedIds={combinedIds}
        sort={sort}
        onSortChange={handleSortChange}
        onSelect={handleSelect}
        onToggleCombine={handleToggleCombine}
        onPasteTextChange={setPasteText}
        onPasteAnalyze={handlePasteAnalyze}
        onRemovePasted={handleRemovePasted}
        onClearAllPasted={handleClearAllPasted}
        headerAction={repullControl}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 bg-bg p-3">
      {/* ── Top strip: the verdict hero for the selected calendar ── */}
      <div data-testid="analyzer-scorecard-wrapper">
        <VerdictHero
          candidate={selected}
          ruleSet={snapshot?.ruleSet ?? []}
          gateDrops={snapshot?.gateDrops ?? { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 }}
          marketSession={snapshot?.marketSession ?? "rth"}
          observedAt={snapshot?.observedAt ?? ""}
          source={snapshot?.source ?? "schwab"}
        />
      </div>
      {/* 3-col desktop grid (this tree only mounts ≥1024px, D-17). */}
      <div
        data-testid="analyzer-inner-grid"
        className="grid grid-cols-[300px_minmax(0,1fr)_330px] gap-4"
      >
      {/* ── Left column: ranked rail ── */}
      <div data-testid="analyzer-rail-wrapper" className="flex flex-col gap-3">
        {railBody}
      </div>

      {/* ── Center column: payoff graph + term structure (both charts, stacked) ── */}
      <div data-testid="analyzer-center-column" className="flex min-w-0 flex-col gap-3">
        <Panel>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PanelHeading title="Risk profile" />
              <LiveStatusBadge {...liveBadgeProps} />
            </div>
            {selected !== null && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="toggle"
                  tone="amber"
                  active={combinedIds.has(selected.id)}
                  data-testid="detail-combine"
                  onClick={() => { handleToggleCombine(selected); }}
                  title="Add this calendar to the combined-book payoff"
                >
                  {combinedIds.has(selected.id) ? "✓ Combined" : "⊕ Combine"}
                </Button>
                <Button
                  variant="toggle"
                  tone="up"
                  active={copiedId === selected.id}
                  data-testid="copy-tos-order"
                  onClick={() => { handleCopyCandidate(selected); }}
                  title="Copy this calendar as a Thinkorswim order"
                >
                  {copiedId === selected.id ? "Copied ✓" : "⧉ Copy TOS order"}
                </Button>
              </div>
            )}
          </div>
          {selected !== null && (
            <p className="mb-1.5 font-mono text-[10px] text-dim">
              <span className="text-violet" data-testid="risk-profile-selected-name">
                {selected.name}
              </span>
              {selected.breakdown.length === 0
                ? ` · debit $${Math.round(selected.debit)}`
                : ` · debit $${Math.round(selected.debit)} · θ ${selected.theta >= 0 ? "+" : ""}${selected.theta.toFixed(1)}/d · vega +${selected.vega.toFixed(2)}`}
              {bookCount > 1 && (
                <span className="ml-2 text-amber" data-testid="combined-book-summary">
                  {`+ ${bookCount - 1} more → combined debit $${Math.round(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${bookVega.toFixed(2)}`}
                </span>
              )}
            </p>
          )}
          {selected !== null && selectedPosition !== null && scenarioResult !== null && (
            <>
              <PayoffControls
                dateInputValue={dateControl.dateInputValue}
                minIso={bounds.minIso}
                maxIso={bounds.maxIso}
                onDateChange={dateControl.setDate}
                onStepDate={dateControl.stepDate}
                onResetDate={dateControl.resetDate}
                toggles={toggles}
                onToggle={handleToggle}
              />
              <PayoffChart
                todayCurve={scenarioResult.payoffCurve}
                fanCurves={[]}
                expirationCurve={scenarioResult.expirationCurve}
                rollCurve={null}
                gex={{
                  callWall: snapshot?.gex.callWall ?? null,
                  putWall: snapshot?.gex.putWall ?? null,
                  flip: snapshot?.gex.flip ?? null,
                }}
                domain={payoffDomain}
                spot={spot}
                toggles={toggles}
                fitY={false}
                onFitYConsumed={noop}
                positionSetSignature={positionSetSignature}
                baseExpirationCurve={scenarioResult.expirationCurve}
                todayCurveColor={TODAY_CURVE_COLOR}
                expirationCurveColor={EXPIRATION_CURVE_COLOR}
                expectedMoveBand={selected.expectedMove > 0 ? { spot, em: selected.expectedMove } : null}
              />
            </>
          )}
        </Panel>

        <Panel>
          <PanelHeading title="Term structure + your legs" />
          {selected !== null && snapshot !== null && (
            <TermStructureChart
              termStructure={snapshot.termStructure}
              events={snapshot.events}
              asOf={snapshot.asOf}
              candidate={selected}
            />
          )}
        </Panel>
      </div>

      {/* ── Right column: why-panel / entry-exit-plan ─── */}
      <div data-testid="analyzer-right-wrapper">
        <RightColumn candidate={selected} gex={snapshot?.gex ?? null} sizing={snapshot?.sizing ?? null} />
      </div>
      </div>
    </div>
  );
}
