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
import { useCallback, useMemo, useState } from "react";
import type { PickerCandidate, BreakdownEntry, PickerGexContext } from "@morai/contracts";
import { cn } from "@/lib/utils";
import { CandidateCard } from "../components/picker/CandidateCard.tsx";
import { ScenarioStrip } from "../components/picker/ScenarioStrip.tsx";
import { WhyPanel } from "../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
import { AdHocCalendarAnalysis } from "../components/picker/AdHocCalendarAnalysis.tsx";
import { Panel, PanelHeading } from "../components/system/index.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { candidateToAnalyzerPosition } from "../lib/candidate-to-position.ts";
import { buildTosCalendarOrder } from "../lib/tos-order.ts";
import { repriceScenario } from "../lib/scenario-engine.ts";
import type { ScenarioParams } from "../lib/scenario-engine.ts";
import { computeProjectionBounds } from "../lib/date-projection.ts";
import { usePayoffDateControl } from "../hooks/usePayoffDateControl.ts";
import { usePicker } from "../hooks/usePicker.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

/** ANLZ-02 picker curve colors (UI-SPEC Color table — distinct from both Overview's TOS
 * override and the old Analyzer's own defaults). */
const TODAY_CURVE_COLOR = "#5b9cf6";
const EXPIRATION_CURVE_COLOR = "#a78bfa";

const RETRY_BUTTON =
  "cursor-pointer rounded-[3px] border border-line2 bg-transparent px-2 py-0.5 font-mono text-[9px] text-dim hover:text-txt";

function noop(): void {}

// ─── Suggested calendars rail ──────────────────────────────────────────────────

export interface CandidateRailProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
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
}: CandidateRailProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title="Suggested calendars" />
      {candidates.length > 0 && (
        <p className="mb-2 font-mono text-[9px] leading-[1.5] text-dim" data-testid="rail-legend">
          {"θ = daily $ decay · vega = $ per vol-pt · "}
          <span className="text-amber">◂f</span>
          {"/"}
          <span className="text-amber">◂b</span>
          {" = event on front / back leg · bars = scored factors (higher = better)"}
        </p>
      )}
      {candidates.length === 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="picker-empty-filtered">
          <p className="m-0 font-display text-sm font-bold text-txt">No candidates in this snapshot</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            {`No put calendars meet net-θ>0 over the ${asOf} snapshot.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
// Driven by the selected candidate's `breakdown` contributions, so it changes per calendar.
// Thresholds here are placeholders (contribution ≥55 = pass, ≥25 = partial) — the real
// pass/fail rubric lands with the Phase-19 engine; this just renders whatever the data says.

interface ScoringMethodologyPanelProps {
  readonly candidate: PickerCandidate | null;
}

const CHECK_ITEMS: ReadonlyArray<{ readonly key: BreakdownEntry["criterion"]; readonly label: string }> = [
  { key: "fwdEdge", label: "Forward-vol edge" },
  { key: "slope", label: "Term-structure slope" },
  { key: "eventAdjustment", label: "Event exposure" },
  { key: "gexFit", label: "GEX fit" },
  { key: "beVsEm", label: "Breakeven vs EM" },
];

function scoreStatus(contribution: number): { readonly icon: string; readonly cls: string } {
  if (contribution >= 55) return { icon: "✓", cls: "text-up" };
  if (contribution >= 25) return { icon: "~", cls: "text-amber" };
  return { icon: "✗", cls: "text-down" };
}

function ScoringMethodologyPanel({ candidate }: ScoringMethodologyPanelProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title="Scoring checklist" />
      <p className="mb-2 font-mono text-[9px] text-dim">How this calendar scores on the picking rubric.</p>
      {candidate === null ? (
        <p className="font-mono text-[10px] text-dim">Select a calendar to see its scorecard.</p>
      ) : (
        <ul className="flex list-none flex-col gap-1.5 pl-0 font-mono text-[10px]" data-testid="scoring-checklist">
          {CHECK_ITEMS.map((item) => {
            const entry = candidate.breakdown.find((b) => b.criterion === item.key);
            const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
            const contribution = entry?.contribution ?? 0;
            const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(contribution);
            return (
              <li key={item.key} className="flex items-center gap-2" data-testid={`checklist-${item.key}`}>
                <span className={cn("w-3 shrink-0 text-center", st.cls)}>{st.icon}</span>
                <span className="flex-1 text-txt">{item.label}</span>
                <span className="text-dim">{guard ? "n/a" : `${Math.round(contribution)}%`}</span>
              </li>
            );
          })}
          <li className="flex items-center gap-2" data-testid="checklist-theta">
            <span className={cn("w-3 shrink-0 text-center", candidate.theta >= 0 ? "text-up" : "text-down")}>
              {candidate.theta >= 0 ? "✓" : "✗"}
            </span>
            <span className="flex-1 text-txt">Positive daily theta</span>
            <span className="text-dim">{`${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`}</span>
          </li>
        </ul>
      )}
      <details className="mt-2.5">
        <summary className="cursor-pointer font-display text-[9px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          What we don&apos;t score
        </summary>
        <p className="mt-1.5 font-mono text-[10px] leading-[1.5] text-dim">
          <span className="text-txt">Deliberately NOT scored</span> (evidence didn&apos;t hold): IV-rank
          gates · fixed IV-difference band · debit-%-of-back. <span className="text-txt">Needs a backtest</span>:
          slope→SPX predictive test · BE-vs-EM &amp; θ/vega thresholds · VVIX / COT timing.
        </p>
      </details>
    </Panel>
  );
}

// ─── Right column: why-panel / term-structure / entry-exit-plan (ANLZ-03, D-01b) ──

export interface RightColumnProps {
  readonly candidate: PickerCandidate | null;
  readonly gex: PickerGexContext | null;
}

/**
 * RightColumn — the "Why this calendar" / "Entry / exit plan" stack for the currently-selected
 * candidate. The term-structure chart moved to the center column (stacked under the payoff graph);
 * reads the live snapshot's GEX context (Phase 19: never the frozen fixture).
 */
function RightColumn({ candidate, gex }: RightColumnProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeading title="Why this calendar" />
        {candidate !== null && gex !== null && <WhyPanel candidate={candidate} gex={gex} />}
      </Panel>
      <Panel>
        <PanelHeading title="Entry / exit plan" />
        {candidate !== null && <EntryExitPlan candidate={candidate} />}
      </Panel>
    </div>
  );
}

// ─── Main Analyzer (picker) screen ─────────────────────────────────────────────

/**
 * Analyzer — exported named export (D-04: full replacement, same export name/signature).
 */
export function Analyzer(): React.ReactElement {
  const { data, isPending, isError, refetch } = usePicker();
  // Unify `undefined` (never-settled) and `null` (404 cold start) into one `null` sentinel —
  // downstream logic only needs to distinguish "no snapshot" from "a real snapshot".
  const snapshot = data ?? null;

  const sortedCandidates = useMemo<ReadonlyArray<PickerCandidate>>(() => {
    if (snapshot === null) return [];
    return [...snapshot.candidates].sort((a, b) => b.score - a.score);
  }, [snapshot]);

  const spot = snapshot?.spot ?? 0;

  const [selectedId, setSelectedId] = useState<string>("");
  // Combined-book multi-select: extra calendars ⊕-Combine'd with the selected one and summed
  // into one net payoff (see bookCandidates/combinedPositions below).
  const [combinedIds, setCombinedIds] = useState<ReadonlySet<string>>(new Set());

  const selected = useMemo<PickerCandidate | null>(() => {
    const found = sortedCandidates.find((c) => c.id === selectedId);
    return found ?? sortedCandidates[0] ?? null;
  }, [selectedId, sortedCandidates]);

  const handleSelect = useCallback((candidate: PickerCandidate) => {
    setSelectedId(candidate.id);
  }, []);

  const handleToggleCombine = useCallback((candidate: PickerCandidate) => {
    setCombinedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  }, []);

  // ── Payoff center (ANLZ-02, D-02): one engine, one adapter — repriceScenario is the sole
  // pricing path. The selected candidate plus any ⊕-Combine'd ones are SUMMED into a net
  // combined-book payoff (the same array-of-positions path Overview uses for the live book). ──

  const selectedPosition = useMemo(
    () => (selected === null ? null : candidateToAnalyzerPosition(selected)),
    [selected],
  );

  // Forward date projection + series toggles (shared with Overview via PayoffControls /
  // usePayoffDateControl). The T+0 curve projects up to the selected candidate's front expiry;
  // the @exp curve is unaffected (D-01, bookPLAtExpiry ignores daysForward).
  const today = useMemo(() => new Date(), []);
  const bounds = useMemo(
    () => computeProjectionBounds(selectedPosition === null ? [] : [selectedPosition.frontDte], today),
    [selectedPosition, today],
  );
  const dateControl = usePayoffDateControl(today, bounds.maxDaysForward);
  const [toggles, setToggles] = useState<PayoffChartToggles>({
    showFan: false,
    showExpiration: true,
    showWalls: true,
    showProfitZone: true,
  });
  const handleToggle = useCallback((key: keyof PayoffChartToggles): void => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Copy-out: the selected candidate as a paste-ready TOS calendar order. copiedId tracks the
  // last-copied candidate so the button reads "Copied ✓" until a different candidate is selected.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopyCandidate = useCallback(
    (candidate: PickerCandidate): void => {
      void navigator.clipboard?.writeText(buildTosCalendarOrder(candidate, snapshot?.asOf ?? ""));
      setCopiedId(candidate.id);
    },
    [snapshot],
  );

  const params = useMemo<ScenarioParams>(
    () => ({ spot, daysForward: dateControl.daysForward, ivShift: 0, rate: DEFAULT_RATE, divYield: DEFAULT_DIV }),
    [spot, dateControl.daysForward],
  );

  // The combined book = the selected candidate (always) + any ⊕-Combine'd calendars.
  const bookCandidates = useMemo<ReadonlyArray<PickerCandidate>>(() => {
    if (selected === null) return [];
    const extra = sortedCandidates.filter((c) => combinedIds.has(c.id) && c.id !== selected.id);
    return [selected, ...extra];
  }, [selected, sortedCandidates, combinedIds]);

  const combinedPositions = useMemo(
    () => bookCandidates.map(candidateToAnalyzerPosition),
    [bookCandidates],
  );

  const scenarioResult = useMemo(
    () => (combinedPositions.length === 0 ? null : repriceScenario(combinedPositions, params)),
    [combinedPositions, params],
  );

  // Book totals (sum of debits/greeks) for the header summary when 2+ calendars are combined.
  const bookCount = bookCandidates.length;
  const bookDebit = bookCandidates.reduce((sum, c) => sum + c.debit, 0);
  const bookTheta = bookCandidates.reduce((sum, c) => sum + c.theta, 0);
  const bookVega = bookCandidates.reduce((sum, c) => sum + c.vega, 0);
  const positionSetSignature = combinedPositions.map((p) => p.id).join("|");

  // ── Rail body: five mutually-exclusive states (D-18/D-19), precedence
  // loading → error → cold-start → zero-filtered (inside CandidateRail) → populated. ──
  let railBody: React.ReactElement;
  if (isPending && data === undefined) {
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
          <button
            type="button"
            className={RETRY_BUTTON}
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </button>
        </div>
      </Panel>
    );
  } else if (snapshot === null) {
    railBody = (
      <Panel>
        <PanelHeading title="Suggested calendars" />
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
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 bg-bg p-3">
      {/* ── Top: paste-to-analyze a new calendar (payoff only; scoring is Phase 19) ─── */}
      <AdHocCalendarAnalysis
        today={today}
        spot={spot}
        rate={DEFAULT_RATE}
        gex={{
          // AdHocCalendarAnalysis needs concrete numeric levels — 0 fallback when the
          // snapshot hasn't loaded yet or a wall/flip is genuinely absent (nullable per
          // pickerGexContext); the panel is best-effort/ad-hoc, never scored.
          putWall: snapshot?.gex.putWall ?? 0,
          flip: snapshot?.gex.flip ?? 0,
          callWall: snapshot?.gex.callWall ?? 0,
        }}
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr 330px" }}>
      {/* ── Left column: ranked rail + the scoring matrix (how any calendar is scored) ── */}
      <div className="flex flex-col gap-3">
        {railBody}
        <ScoringMethodologyPanel candidate={selected} />
      </div>

      {/* ── Center column: payoff graph + term structure (both charts, stacked) ── */}
      <div className="flex min-w-0 flex-col gap-3">
        <Panel>
          <div className="mb-1 flex items-center justify-between gap-2">
            <PanelHeading title="Risk profile" />
            {selected !== null && (
              <button
                type="button"
                data-testid="copy-tos-order"
                onClick={() => { handleCopyCandidate(selected); }}
                title="Copy this calendar as a Thinkorswim order"
                className="cursor-pointer rounded-[3px] border border-line2 bg-transparent px-2 py-0.5 font-mono text-[9px] text-dim hover:text-txt"
              >
                {copiedId === selected.id ? "Copied ✓" : "⧉ Copy TOS order"}
              </button>
            )}
          </div>
          {selected !== null && (
            <p className="mb-1.5 font-mono text-[10px] text-dim">
              <span className="text-violet" data-testid="risk-profile-selected-name">
                {selected.name}
              </span>
              {` · debit $${selected.debit.toFixed(0)} · θ ${selected.theta >= 0 ? "+" : ""}${selected.theta.toFixed(1)}/d · vega +${selected.vega.toFixed(0)}`}
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
                spot={spot}
                toggles={toggles}
                fitY={false}
                onFitYConsumed={noop}
                positionSetSignature={positionSetSignature}
                baseExpirationCurve={scenarioResult.expirationCurve}
                todayCurveColor={TODAY_CURVE_COLOR}
                expirationCurveColor={EXPIRATION_CURVE_COLOR}
                expectedMoveBand={{ spot, em: selected.expectedMove }}
              />
              <ScenarioStrip
                position={selectedPosition}
                levels={{
                  putWall: snapshot?.gex.putWall ?? null,
                  flip: snapshot?.gex.flip ?? null,
                  callWall: snapshot?.gex.callWall ?? null,
                }}
                spot={spot}
                todayCurve={scenarioResult.payoffCurve}
                expirationCurve={scenarioResult.expirationCurve}
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
      <RightColumn candidate={selected} gex={snapshot?.gex ?? null} />
      </div>
    </div>
  );
}
