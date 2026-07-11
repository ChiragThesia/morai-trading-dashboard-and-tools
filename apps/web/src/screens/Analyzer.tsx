/**
 * Analyzer — ranked-cards calendar PICKER (Phase 18, D-04 — full replacement of the
 * position-analyzer cockpit). Phase 19 (PICK-02) swaps the frozen fixture for live data.
 *
 * UI-SPEC "Ranked candidate cards" / "Payoff center": 3-col grid (300px/1fr/330px, stacking
 * below 1280px in DOM order):
 *   Left (300px)  — "Suggested calendars": ranked CandidateCard rail (ANLZ-01, D-01/D-05),
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
import { cn } from "@/lib/utils";
import { CandidateCard } from "../components/picker/CandidateCard.tsx";
import { WhyPanel } from "../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
import { Panel, PanelHeading, Button, MetricChip } from "../components/system/index.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
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
} from "./analyzer-mobile/useAnalyzerModel.ts";

// ─── Constants ────────────────────────────────────────────────────────────────
//
// The picker curve colors, the not-scored note, the chip labels/weights helper, and the
// paste-error copy now live in analyzer-mobile/useAnalyzerModel.ts (D-02, single source —
// both trees import them). This file re-imports the ones its desktop view still renders.

function noop(): void {}

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
  /** Full-ISO real instant (WR-03) — threaded to each CandidateCard's staleness dot. */
  readonly observedAt: string;
  readonly source: "schwab" | "cboe";
  readonly gexContextStatus: "ok" | "stale" | "missing";
  readonly eventsContextStatus: "ok" | "stale" | "missing";
  readonly selectedId: string;
  readonly combinedIds: ReadonlySet<string>;
  readonly copiedId: string | null;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onCopy: (candidate: PickerCandidate) => void;
  readonly onPasteTextChange: (text: string) => void;
  readonly onPasteAnalyze: () => void;
  /** Removes one pasted card (its own × button) — leaves other pasted cards untouched. */
  readonly onRemovePasted: (candidate: PickerCandidate) => void;
  /** Removes every pasted card at once. */
  readonly onClearAllPasted: () => void;
  /** Optional heading-row control (the Re-pull chains button — refreshes THIS rail). */
  readonly headerAction?: React.ReactNode;
}

/**
 * CandidateRail — the "Suggested calendars" panel: ranked CandidateCard rail + the
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
  observedAt,
  source,
  gexContextStatus,
  eventsContextStatus,
  selectedId,
  combinedIds,
  copiedId,
  onSelect,
  onToggleCombine,
  onCopy,
  onPasteTextChange,
  onPasteAnalyze,
  onRemovePasted,
  onClearAllPasted,
  headerAction,
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
        <div className="flex flex-col gap-2">
          {pastedCandidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              pasted
              selected={candidate.id === selectedId}
              combined={combinedIds.has(candidate.id)}
              copied={candidate.id === copiedId}
              observedAt={observedAt}
              source={source}
              gexContextStatus={gexContextStatus}
              eventsContextStatus={eventsContextStatus}
              onSelect={onSelect}
              onToggleCombine={onToggleCombine}
              onCopy={onCopy}
              onRemove={onRemovePasted}
            />
          ))}
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedId}
              combined={combinedIds.has(candidate.id)}
              copied={candidate.id === copiedId}
              observedAt={observedAt}
              source={source}
              gexContextStatus={gexContextStatus}
              eventsContextStatus={eventsContextStatus}
              onSelect={onSelect}
              onToggleCombine={onToggleCombine}
              onCopy={onCopy}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Scoring checklist (per-candidate: how THIS calendar scores on the picking rubric) ─────
//
// Driven by the selected candidate's `breakdown` + the snapshot's `ruleSet` (the engine's
// own rule registry — rules.ts). Labels/weights come from the registry, and pass/partial
// status is weight-relative (contribution is the 0-100 share of a criterion's weight:
// ✓ ≥ ⅔, ~ ≥ ⅓) — no client-side placeholder thresholds.

interface ScoringMethodologyPanelProps {
  readonly candidate: PickerCandidate | null;
  /** The engine's rule registry from the snapshot (empty on pre-registry snapshots). */
  readonly ruleSet: ReadonlyArray<RuleSetEntry>;
  /** Per-gate drop counts for the snapshot's compute run. */
  readonly gateDrops: { readonly liquidity: number; readonly netTheta: number };
  /** Marks provenance — "after-hours" renders the indicative-marks warning chip. */
  readonly marketSession: "rth" | "after-hours";
}

// FALLBACK_SCORE_ITEMS, scoreStatus, CHIP_LABELS, EXPERIMENTAL_SHORT now live in
// analyzer-mobile/useAnalyzerModel.ts (D-02, single source) — imported above.

function ScoringMethodologyPanel({
  candidate,
  ruleSet,
  gateDrops,
  marketSession,
}: ScoringMethodologyPanelProps): React.ReactElement {
  // Score rows from the engine's registry when available; legacy fallback otherwise.
  const scoreRules = ruleSet.filter((r) => r.kind === "score" && r.status === "active");
  const scoreItems =
    scoreRules.length > 0
      ? scoreRules.map((r) => ({ key: r.id, label: CHIP_LABELS[r.id] ?? r.label, weight: r.weight }))
      : FALLBACK_SCORE_ITEMS.map((item) => ({
          key: item.key,
          label: CHIP_LABELS[item.key] ?? item.label,
          weight: null,
        }));

  if (candidate === null) {
    return (
      <div data-testid="scoring-pills">
        <span className="font-mono text-[10px] text-dim">Select a calendar to see its scorecard.</span>
      </div>
    );
  }
  if (candidate.breakdown.length === 0) {
    return (
      <div data-testid="scoring-pills">
        <span className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="scoring-pills">
      {marketSession === "after-hours" && (
        <MetricChip
          data-testid="session-badge"
          alert
          label="SESSION"
          value={<span className="text-amber">AH — indicative</span>}
        />
      )}
      <div className="flex flex-wrap items-center gap-2" data-testid="scoring-checklist">
        {scoreItems.map((item) => {
          const entry = candidate.breakdown.find((b) => b.criterion === item.key);
          const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
          const contribution = entry?.contribution ?? 0;
          const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(contribution);
          return (
            <MetricChip
              key={item.key}
              data-testid={`checklist-${item.key}`}
              label={
                <>
                  {item.label}
                  {item.weight !== null && (
                    <span className="ml-1 text-dim" data-testid={`checklist-${item.key}-weight`}>
                      w{item.weight}
                    </span>
                  )}
                </>
              }
              value={
                <span className={st.cls}>
                  {st.icon} {guard ? "n/a" : `${Math.round(contribution)}%`}
                </span>
              }
            />
          );
        })}
        <MetricChip
          data-testid="checklist-theta"
          label="θ GATE"
          value={
            <span className={candidate.theta >= 0 ? "text-up" : "text-down"}>
              {candidate.theta >= 0 ? "✓" : "✗"} {`${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`}
            </span>
          }
        />
        {candidate.context.length > 0 && (
          <MetricChip
            data-testid="checklist-experimental"
            className="opacity-60"
            label="CALIBRATING"
            value={
              <span className="font-mono text-[10px] font-normal text-dim">
                {candidate.context
                  .map(
                    (entry) =>
                      `${EXPERIMENTAL_SHORT[entry.id] ?? entry.id} ${
                        entry.value === null
                          ? "—"
                          : entry.value.toFixed(entry.id === "slopePercentile" ? 0 : 3)
                      }`,
                  )
                  .join(" · ")}
              </span>
            }
          />
        )}
      </div>
      {(gateDrops.liquidity > 0 || gateDrops.netTheta > 0) && (
        <span className="font-mono text-[9px] text-dim" data-testid="checklist-gate-drops">
          {gateDrops.liquidity} illiquid quote{gateDrops.liquidity === 1 ? "" : "s"} ·{" "}
          {gateDrops.netTheta} negative-θ pair{gateDrops.netTheta === 1 ? "" : "s"} dropped this run
        </span>
      )}
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
    bookCount,
    bookDebit,
    bookTheta,
    bookVega,
    positionSetSignature,
    repull,
  } = useAnalyzerModel();

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
        candidates={sortedCandidates}
        pastedCandidates={pastedCandidates}
        pasteText={pasteText}
        pasteError={pasteError}
        asOf={snapshot.asOf}
        observedAt={snapshot.observedAt}
        source={snapshot.source}
        gexContextStatus={snapshot.gexContextStatus}
        eventsContextStatus={snapshot.eventsContextStatus}
        selectedId={selectedId}
        combinedIds={combinedIds}
        copiedId={copiedId}
        onSelect={handleSelect}
        onToggleCombine={handleToggleCombine}
        onCopy={handleCopyCandidate}
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
      {/* ── Top strip: the engine's scorecard chips for the selected calendar ──
          Mobile stack order (35-05): order-2 paints this after the rail below lg. */}
      <div data-testid="analyzer-scorecard-wrapper" className="order-2 lg:order-none">
        <ScoringMethodologyPanel
          candidate={selected}
          ruleSet={snapshot?.ruleSet ?? []}
          gateDrops={snapshot?.gateDrops ?? { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 }}
          marketSession={snapshot?.marketSession ?? "rth"}
        />
      </div>
      {/* `contents` flattens this box below lg, promoting rail/center/right to flex-items of
          the outer column above (so order-* can interleave scorecard between them without
          moving any JSX); `lg:grid` restores today's exact 300px/1fr/330px grid at lg. */}
      <div
        data-testid="analyzer-inner-grid"
        className="contents lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:gap-4"
      >
      {/* ── Left column: ranked rail ── */}
      <div data-testid="analyzer-rail-wrapper" className="order-1 lg:order-none flex flex-col gap-3">
        {railBody}
      </div>

      {/* ── Center column: payoff graph + term structure (both charts, stacked) ── */}
      <div data-testid="analyzer-center-column" className="order-3 lg:order-none flex min-w-0 flex-col gap-3">
        <Panel>
          <div className="mb-1 flex items-center justify-between gap-2">
            <PanelHeading title="Risk profile" />
            {selected !== null && (
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
            )}
          </div>
          {selected !== null && (
            <p className="mb-1.5 font-mono text-[10px] text-dim">
              <span className="text-violet" data-testid="risk-profile-selected-name">
                {selected.name}
              </span>
              {selected.breakdown.length === 0
                ? ` · debit $${selected.debit.toFixed(0)}`
                : ` · debit $${selected.debit.toFixed(0)} · θ ${selected.theta >= 0 ? "+" : ""}${selected.theta.toFixed(1)}/d · vega +${selected.vega.toFixed(0)}`}
              {bookCount > 1 && (
                <span className="ml-2 text-amber" data-testid="combined-book-summary">
                  {`+ ${bookCount - 1} more → combined debit $${bookDebit.toFixed(0)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${bookVega.toFixed(0)}`}
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
              {/* Full-bleed below lg (negates Panel's p-3 horizontal inset); reverts at lg */}
              <div data-testid="analyzer-payoff-chart-bleed" className="-mx-3 lg:mx-0">
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
              </div>
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
      <div data-testid="analyzer-right-wrapper" className="order-4 lg:order-none">
        <RightColumn candidate={selected} gex={snapshot?.gex ?? null} sizing={snapshot?.sizing ?? null} />
      </div>
      </div>
    </div>
  );
}
