/**
 * Analyzer — ranked-cards calendar PICKER (Phase 18, D-04 — full replacement of the
 * position-analyzer cockpit).
 *
 * UI-SPEC "Ranked candidate cards" / "Payoff center": 3-col grid (300px/1fr/330px, stacking
 * below 1280px in DOM order):
 *   Left (300px)  — "Suggested calendars": ranked CandidateCard rail (ANLZ-01, D-01/D-05).
 *   Center (1fr)  — "Risk profile" (payoff center, wired in Task 3) + "Scoring methodology"
 *                   collapsible panel (locked reference copy, not fixture-driven).
 *   Right (330px) — "Why this calendar" / "Term structure + your legs" / "Entry / exit plan"
 *                   panel shells — content lands in 18-05 (out of this plan's scope).
 *
 * D-02b: 100% fixture-driven — consumes `pickerSnapshotFixture` (@morai/contracts, 18-01) only.
 * NO usePositions/useGex/useLiveStream hooks, NO pairPositionsIntoCalendars/CalendarGroup —
 * the picker is view-only against a frozen snapshot, never live broker data.
 *
 * Keeps the exact `export function Analyzer(): React.ReactElement` name/signature so
 * `App.tsx`'s route wiring needs zero changes.
 *
 * No any/as/!.
 */
import { useCallback, useMemo, useState } from "react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate, BreakdownEntry } from "@morai/contracts";
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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixture candidates, defensively sorted score-descending (D-01: fixture is already sorted,
 * this guards against future fixture edits going out of order). */
const SORTED_CANDIDATES: ReadonlyArray<PickerCandidate> = [...pickerSnapshotFixture.candidates].sort(
  (a, b) => b.score - a.score,
);

const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

/** Fixed scenario params (D-02b: no scenario sliders on this fixture-only, view-only screen —
 * spot/rate/divYield are the frozen snapshot constants, matching Overview.tsx's defaults). */
const PARAMS: ScenarioParams = {
  spot: pickerSnapshotFixture.spot,
  daysForward: 0,
  ivShift: 0,
  rate: DEFAULT_RATE,
  divYield: DEFAULT_DIV,
};

/** ANLZ-02 picker curve colors (UI-SPEC Color table — distinct from both Overview's TOS
 * override and the old Analyzer's own defaults). */
const TODAY_CURVE_COLOR = "#5b9cf6";
const EXPIRATION_CURVE_COLOR = "#a78bfa";

function noop(): void {}

// ─── Suggested calendars rail ──────────────────────────────────────────────────

export interface CandidateRailProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
  readonly selectedId: string;
  readonly combinedIds: ReadonlySet<string>;
  readonly copiedId: string | null;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onCopy: (candidate: PickerCandidate) => void;
}

/**
 * CandidateRail — the "Suggested calendars" panel: ranked CandidateCard rail + locked
 * empty-state copy. Exported (like Overview.tsx's `formatExpiryCell`) so the empty-state
 * branch is directly unit-testable without needing to swap the fixture-only Analyzer's data
 * source via module mocking (Analyzer takes zero props, D-02b).
 */
export function CandidateRail({
  candidates,
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
        <div className="flex flex-col gap-1.5">
          <p className="m-0 font-display text-sm font-bold text-txt">No candidates in this snapshot</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            The picker found no calendars meeting the DTE and theta screen for today&apos;s chain.
            Check back after the next 30-minute snapshot.
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
}

/**
 * RightColumn — the "Why this calendar" / "Entry / exit plan" stack for the currently-selected
 * candidate. The term-structure chart moved to the center column (stacked under the payoff graph);
 * reads the fixture's static GEX context (never live — this screen scores against the D-03 snapshot).
 */
function RightColumn({ candidate }: RightColumnProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeading title="Why this calendar" />
        {candidate !== null && <WhyPanel candidate={candidate} gex={pickerSnapshotFixture.gex} />}
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
  const [selectedId, setSelectedId] = useState<string>(SORTED_CANDIDATES[0]?.id ?? "");
  // Combined-book multi-select: extra calendars ⊕-Combine'd with the selected one and summed
  // into one net payoff (see bookCandidates/combinedPositions below).
  const [combinedIds, setCombinedIds] = useState<ReadonlySet<string>>(new Set());

  const selected = useMemo<PickerCandidate | null>(() => {
    const found = SORTED_CANDIDATES.find((c) => c.id === selectedId);
    return found ?? SORTED_CANDIDATES[0] ?? null;
  }, [selectedId]);

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
  const handleCopyCandidate = useCallback((candidate: PickerCandidate): void => {
    void navigator.clipboard?.writeText(buildTosCalendarOrder(candidate, pickerSnapshotFixture.asOf));
    setCopiedId(candidate.id);
  }, []);

  const params = useMemo<ScenarioParams>(
    () => ({ ...PARAMS, daysForward: dateControl.daysForward }),
    [dateControl.daysForward],
  );

  // The combined book = the selected candidate (always) + any ⊕-Combine'd calendars.
  const bookCandidates = useMemo<ReadonlyArray<PickerCandidate>>(() => {
    if (selected === null) return [];
    const extra = SORTED_CANDIDATES.filter((c) => combinedIds.has(c.id) && c.id !== selected.id);
    return [selected, ...extra];
  }, [selected, combinedIds]);

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

  return (
    <div className="flex flex-col gap-4 bg-bg p-3">
      {/* ── Top: paste-to-analyze a new calendar (payoff only; scoring is Phase 19) ─── */}
      <AdHocCalendarAnalysis
        today={today}
        spot={PARAMS.spot}
        rate={DEFAULT_RATE}
        gex={{
          putWall: pickerSnapshotFixture.gex.putWall,
          flip: pickerSnapshotFixture.gex.flip,
          callWall: pickerSnapshotFixture.gex.callWall,
        }}
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr 330px" }}>
      {/* ── Left column: ranked rail + the scoring matrix (how any calendar is scored) ── */}
      <div className="flex flex-col gap-3">
        <CandidateRail
          candidates={SORTED_CANDIDATES}
          selectedId={selectedId}
          combinedIds={combinedIds}
          copiedId={copiedId}
          onSelect={handleSelect}
          onToggleCombine={handleToggleCombine}
          onCopy={handleCopyCandidate}
        />
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
                  callWall: pickerSnapshotFixture.gex.callWall,
                  putWall: pickerSnapshotFixture.gex.putWall,
                  flip: pickerSnapshotFixture.gex.flip,
                }}
                spot={PARAMS.spot}
                toggles={toggles}
                fitY={false}
                onFitYConsumed={noop}
                positionSetSignature={positionSetSignature}
                baseExpirationCurve={scenarioResult.expirationCurve}
                todayCurveColor={TODAY_CURVE_COLOR}
                expirationCurveColor={EXPIRATION_CURVE_COLOR}
                expectedMoveBand={{ spot: PARAMS.spot, em: selected.expectedMove }}
              />
              <ScenarioStrip
                position={selectedPosition}
                levels={{
                  putWall: pickerSnapshotFixture.gex.putWall,
                  flip: pickerSnapshotFixture.gex.flip,
                  callWall: pickerSnapshotFixture.gex.callWall,
                }}
                spot={PARAMS.spot}
                todayCurve={scenarioResult.payoffCurve}
                expirationCurve={scenarioResult.expirationCurve}
              />
            </>
          )}
        </Panel>

        <Panel>
          <PanelHeading title="Term structure + your legs" />
          {selected !== null && (
            <TermStructureChart
              termStructure={pickerSnapshotFixture.termStructure}
              events={pickerSnapshotFixture.events}
              asOf={pickerSnapshotFixture.asOf}
              candidate={selected}
            />
          )}
        </Panel>
      </div>

      {/* ── Right column: why-panel / entry-exit-plan ─── */}
      <RightColumn candidate={selected} />
      </div>
    </div>
  );
}
