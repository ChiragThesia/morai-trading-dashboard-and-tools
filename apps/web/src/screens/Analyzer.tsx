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
import type { PickerCandidate } from "@morai/contracts";
import { CandidateCard } from "../components/picker/CandidateCard.tsx";
import { ScenarioStrip } from "../components/picker/ScenarioStrip.tsx";
import { WhyPanel } from "../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
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
const COMPARE_CURVE_COLOR = "#f0b429";

function noop(): void {}

// ─── Suggested calendars rail ──────────────────────────────────────────────────

export interface CandidateRailProps {
  readonly candidates: ReadonlyArray<PickerCandidate>;
  readonly selectedId: string;
  readonly compareId: string | null;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onCompareToggle: (candidate: PickerCandidate) => void;
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
  compareId,
  onSelect,
  onCompareToggle,
}: CandidateRailProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title="Suggested calendars" />
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
              compared={candidate.id === compareId}
              onSelect={onSelect}
              onCompareToggle={onCompareToggle}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Scoring methodology panel (locked reference copy, not fixture-driven) ─────

function ScoringMethodologyPanel(): React.ReactElement {
  return (
    <Panel>
      <details>
        <summary className="cursor-pointer font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          Scoring methodology — verified &amp; refuted
        </summary>
        <ul className="mt-2 flex list-none flex-col gap-2 pl-0 font-mono text-[11px] leading-[1.45] text-txt">
          <li>
            <b>Scored</b> (verified): forward-IV edge via √[(T₂σ₂²−T₁σ₁²)/(T₂−T₁)] — never raw
            front−back IV subtraction (SpotGamma; no-arb identity) · term-structure slope,
            dominant long-vol driver (Vasquez JFQA 2017, 16.5%/mo decile spread) · event flags
            per leg with front-event penalty (arXiv 2606.12872: FOMC/CPI premia) · net θ &gt; 0
            constraint bounds OTM distance (live greeks, not fixed %) · GEX regime + abs-γ-strike
            proximity (SpotGamma; pinning literature) · debit = max loss for sizing, close by
            front expiry.
          </li>
          <li>
            <b>Deliberately NOT scored</b> (refuted 3-vote adversarial): IV-rank/percentile entry
            gates (0-3) · &quot;−1 to −3% IV differential ideal band&quot; (0-3, fabricated
            source) · &quot;fair debit = 25-40% of back premium&quot; (0-3).
          </li>
          <li>
            <b>Needs in-house backtest</b>: slope-signal transfer to SPX time-series
            (leg_observations has the history since 2026-06-12) · BE-vs-EM and θ/vega thresholds
            · VVIX/COT as entry timing (no verified evidence — shown as context only).
          </li>
        </ul>
      </details>
    </Panel>
  );
}

// ─── Right column: why-panel / term-structure / entry-exit-plan (ANLZ-03, D-01b) ──

export interface RightColumnProps {
  readonly candidate: PickerCandidate | null;
}

/**
 * RightColumn — the "Why this calendar" / "Term structure + your legs" / "Entry / exit plan"
 * stack for the currently-selected candidate. Reads the fixture's static term-structure/events/
 * GEX context (never live — this screen scores against the frozen D-03 snapshot).
 */
function RightColumn({ candidate }: RightColumnProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeading title="Why this calendar" />
        {candidate !== null && <WhyPanel candidate={candidate} gex={pickerSnapshotFixture.gex} />}
      </Panel>
      <Panel>
        <PanelHeading title="Term structure + your legs" />
        {candidate !== null && (
          <TermStructureChart
            termStructure={pickerSnapshotFixture.termStructure}
            events={pickerSnapshotFixture.events}
            asOf={pickerSnapshotFixture.asOf}
            candidate={candidate}
          />
        )}
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
  const [compareId, setCompareId] = useState<string | null>(null);

  const selected = useMemo<PickerCandidate | null>(() => {
    const found = SORTED_CANDIDATES.find((c) => c.id === selectedId);
    return found ?? SORTED_CANDIDATES[0] ?? null;
  }, [selectedId]);

  const compareCandidate = useMemo<PickerCandidate | null>(() => {
    if (compareId === null) return null;
    return SORTED_CANDIDATES.find((c) => c.id === compareId) ?? null;
  }, [compareId]);

  const handleSelect = useCallback((candidate: PickerCandidate) => {
    setSelectedId(candidate.id);
  }, []);

  const handleCompareToggle = useCallback((candidate: PickerCandidate) => {
    setCompareId((prev) => (prev === candidate.id ? null : candidate.id));
  }, []);

  // ── Payoff center (ANLZ-02, D-02): one engine, one adapter — repriceScenario is the sole
  // pricing path for both the selected candidate and the ⊕-compare overlay. ─────────────────

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
  const handleCopyOrder = useCallback((): void => {
    if (selected === null) return;
    void navigator.clipboard?.writeText(buildTosCalendarOrder(selected, pickerSnapshotFixture.asOf));
    setCopiedId(selected.id);
  }, [selected]);

  const params = useMemo<ScenarioParams>(
    () => ({ ...PARAMS, daysForward: dateControl.daysForward }),
    [dateControl.daysForward],
  );

  const scenarioResult = useMemo(
    () => (selectedPosition === null ? null : repriceScenario([selectedPosition], params)),
    [selectedPosition, params],
  );

  const compareScenarioResult = useMemo(() => {
    if (compareCandidate === null) return null;
    return repriceScenario([candidateToAnalyzerPosition(compareCandidate)], params);
  }, [compareCandidate, params]);

  return (
    <div
      className="grid gap-4 bg-bg p-3"
      style={{ gridTemplateColumns: "300px 1fr 330px" }}
    >
      {/* ── Left column: ranked rail ─────────────────────────────────── */}
      <div className="flex flex-col">
        <CandidateRail
          candidates={SORTED_CANDIDATES}
          selectedId={selectedId}
          compareId={compareId}
          onSelect={handleSelect}
          onCompareToggle={handleCompareToggle}
        />
      </div>

      {/* ── Center column: payoff center + methodology ───────────────── */}
      <div className="flex min-w-0 flex-col gap-3">
        <Panel>
          <div className="mb-1 flex items-center justify-between gap-2">
            <PanelHeading title="Risk profile" />
            {selected !== null && (
              <button
                type="button"
                data-testid="copy-tos-order"
                onClick={handleCopyOrder}
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
              {compareCandidate !== null && (
                <span className="ml-2 text-amber">{`vs ${compareCandidate.name} (dashed)`}</span>
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
                positionSetSignature={selected.id}
                baseExpirationCurve={scenarioResult.expirationCurve}
                todayCurveColor={TODAY_CURVE_COLOR}
                expirationCurveColor={EXPIRATION_CURVE_COLOR}
                compareCurve={compareScenarioResult?.expirationCurve ?? null}
                compareCurveColor={COMPARE_CURVE_COLOR}
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

        <ScoringMethodologyPanel />
      </div>

      {/* ── Right column: why-panel / term-structure / entry-exit-plan ─── */}
      <RightColumn candidate={selected} />
    </div>
  );
}
