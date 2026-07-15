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
import { EventChipsRow } from "../components/picker/TermStructureChart.tsx";
import { TermStructureInset } from "../components/picker/TermStructureInset.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
import { formatAsOf } from "../components/picker/CandidateCard.tsx";
import { Panel, PanelHeading, Button } from "../components/system/index.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { useIsDesktop } from "../hooks/useIsDesktop.ts";
import { AnalyzerMobile } from "./analyzer-mobile/AnalyzerMobile.tsx";
import {
  CandidateTable,
  cycleSort,
  sortCandidates,
  DEFAULT_CANDIDATE_SORT,
} from "../components/picker/CandidateTable.tsx";
import type { CandidateSortKey, CandidateSortState } from "../components/picker/CandidateTable.tsx";
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
  describeEmptyBoard,
} from "./analyzer-mobile/useAnalyzerModel.ts";

// ─── Constants ────────────────────────────────────────────────────────────────
//
// The picker curve colors, the not-scored note, the chip labels/weights helper, and the
// paste-error copy now live in analyzer-mobile/useAnalyzerModel.ts (D-02, single source —
// both trees import them). This file re-imports the ones its desktop view still renders.

function noop(): void {}

// ─── Ranked candidate table (D-01, D-03) ───────────────────────────────────────
//
// The sortable <table> (UI-SPEC "Table Contract") lives in components/picker/CandidateTable.tsx
// (shared with the mobile tree since 2026-07-14 — user-locked: mobile shows the table too,
// horizontal scroll OK). Sort state stays local to each view. Public names its tests use are
// re-exported below so import sites stay stable.

export {
  DEFAULT_CANDIDATE_SORT,
  compactCalendarName,
} from "../components/picker/CandidateTable.tsx";
export type { CandidateSortKey, CandidateSortState } from "../components/picker/CandidateTable.tsx";

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
  /** Honest zero-candidate reason lines (describeEmptyBoard) — falls back to the plain
   *  net-θ line when omitted (direct-render tests pass `asOf` only). */
  readonly emptyReasonLines?: ReadonlyArray<string>;
  /** True while the ad-hoc analyze request is in flight — Analyzing… button state. */
  readonly pasteAnalyzing?: boolean;
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
  emptyReasonLines,
  pasteAnalyzing,
}: CandidateRailProps): React.ReactElement {
  return (
    <Panel>
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
          className="min-w-0 flex-1 rounded-[3px] border border-line2 bg-transparent px-3 py-2 font-mono text-[12px] text-txt"
        />
        <Button
          variant="primary"
          size="sm"
          data-testid="picker-paste-analyze"
          disabled={pasteAnalyzing === true}
          onClick={onPasteAnalyze}
        >
          {pasteAnalyzing === true ? "Analyzing…" : "Analyze"}
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
          {(emptyReasonLines ?? [`No put calendars meet net-θ>0 over the ${asOf} snapshot.`]).map(
            (line) => (
              <p key={line} className="m-0 font-mono text-[11px] text-dim">
                {line}
              </p>
            ),
          )}
        </div>
      ) : (
        // ~5 rows visible, scroll for the rest (TOS idiom) — sticky header scrolls within
        // this wrapper, never the page.
        <CandidateTable
          candidates={candidates}
          pastedCandidates={pastedCandidates}
          selectedId={selectedId}
          combinedIds={combinedIds}
          sort={sort}
          onSortChange={onSortChange}
          onSelect={onSelect}
          onToggleCombine={onToggleCombine}
          onRemovePasted={onRemovePasted}
          wrapperClassName="max-h-[160px] overflow-y-auto"
        />
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

  // Single-line hero (no-scroll layout, 2026-07-15): headline + the three factor groups
  // inline on one flex-wrap row, footer provenance as a slim second line. Same testids and
  // copy as the retired 3-column grid — this is a density re-layout, not a scoring change.
  return (
    <div data-testid="verdict-hero" className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2" data-testid="verdict-headline">
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
            className="inline-block rounded-sm bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-amber"
          >
            {"SESSION · AH — indicative"}
          </span>
        )}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="verdict-groups">
          {GROUP_ORDER.map((group) => (
            <div key={group} data-testid={`verdict-group-${group}`} className="flex items-baseline gap-x-2.5">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
                {group}
              </span>
              {scoreItems
                .filter((item) => GROUP_OF[item.key] === group)
                .map((item) => {
                  const entry = candidate.breakdown.find((b) => b.criterion === item.key);
                  if (entry === undefined) return null;
                  const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
                  const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(entry.contribution);
                  return (
                    <span
                      key={item.key}
                      data-testid={`checklist-${item.key}`}
                      className="flex items-baseline gap-1 font-mono text-[10px]"
                    >
                      <span className="text-dim">{item.label}</span>
                      <span className={st.cls}>
                        {st.icon} {guard ? "n/a" : `${Math.round(entry.contribution)}%`}
                      </span>
                    </span>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      <p className="m-0 font-mono text-[9px] text-dim" data-testid="verdict-hero-footer">
        {footer}
      </p>
    </div>
  );
}

// ─── WHY / ENTRY-EXIT panels (ANLZ-03, D-01b) ──────────────────────────────────
//
// No-scroll layout (2026-07-15): the two panels are separate grid COLUMNS beside the chart
// (previously a stacked rail whose height could out-grow the chart and stretch the row).

interface SidePanelProps {
  readonly candidate: PickerCandidate | null;
  readonly gex: PickerGexContext | null;
  /** VIX-tiered sizing recommendation from the snapshot (28-06, PLAY-03) — threaded straight
   *  to EntryExitPlan, never recomputed here. */
  readonly sizing: PickerSizing | null;
}

function WhyColumn({ candidate, gex }: Omit<SidePanelProps, "sizing">): React.ReactElement {
  const notScored = candidate !== null && candidate.breakdown.length === 0;
  return (
    <Panel>
      <PanelHeading title="Why this calendar" />
      {notScored ? (
        <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
      ) : (
        candidate !== null && gex !== null && <WhyPanel candidate={candidate} gex={gex} />
      )}
    </Panel>
  );
}

function ExitColumn({ candidate, sizing }: Omit<SidePanelProps, "gex">): React.ReactElement {
  const notScored = candidate !== null && candidate.breakdown.length === 0;
  return (
    <Panel>
      <PanelHeading title="Entry / exit plan" />
      {notScored ? (
        <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
      ) : (
        candidate !== null && <EntryExitPlan candidate={candidate} sizing={sizing} />
      )}
    </Panel>
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
    pasteAnalyzing,
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
        emptyReasonLines={describeEmptyBoard(snapshot)}
        pasteAnalyzing={pasteAnalyzing}
      />
    );
  }

  // Zero-candidate empty state (2026-07-15): with nothing scored and nothing pasted there is
  // no selection, and the hero / WHY-ENTRY rail / chart / term panels would all render as
  // hollow shells — the rail (paste box + honest reason + Re-pull) IS the screen instead.
  if (!isLoading && !isError && snapshot !== null && selected === null) {
    return <div className="flex flex-col gap-4 bg-bg p-3">{railBody}</div>;
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
      {/* No-scroll layout (2026-07-15, evolves the 2026-07-14 TOS layout): WHY and ENTRY as
          two slim columns left of the chart — the rail can never out-grow the chart row —
          then the full-width greeks table. Term structure renders as a chart inset, not a
          page section. ≥1024px only (D-17). */}
      <div
        data-testid="analyzer-inner-grid"
        className="grid grid-cols-[minmax(230px,270px)_minmax(230px,270px)_minmax(0,1fr)] gap-4"
      >
      {/* ── WHY / ENTRY-EXIT columns ── */}
      <div data-testid="analyzer-right-wrapper">
        <WhyColumn candidate={selected} gex={snapshot?.gex ?? null} />
      </div>
      <div data-testid="analyzer-exit-wrapper">
        <ExitColumn candidate={selected} sizing={snapshot?.sizing ?? null} />
      </div>

      {/* ── Chart column ── */}
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
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="m-0 font-mono text-[10px] text-dim">
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
              {/* Event chips (from the retired term-structure panel) — hover for WHAT/WHY. */}
              {snapshot !== null && (
                <EventChipsRow
                  events={snapshot.events}
                  asOf={snapshot.asOf}
                  frontDte={selected.frontLeg.dte}
                  backDte={selected.backLeg.dte}
                />
              )}
            </div>
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
              <div className="relative">
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
                  aspectRatio={2.5}
                />
                {/* Term-structure inset (no-scroll layout): overlaid on the payoff canvas's
                    quiet top-left corner; pointer-events-none keeps the payoff crosshair
                    live underneath. */}
                {snapshot !== null && (
                  <div className="pointer-events-none absolute left-12 top-1 z-10">
                    <TermStructureInset
                      termStructure={snapshot.termStructure}
                      events={snapshot.events}
                      asOf={snapshot.asOf}
                      candidate={selected}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </Panel>

      </div>
      </div>

      {/* ── Full-width ranked greeks table (TOS idiom: table under the graph) ── */}
      <div data-testid="analyzer-rail-wrapper" className="flex flex-col gap-3">
        {railBody}
      </div>
    </div>
  );
}
