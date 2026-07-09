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
import type { PickerCandidate, BreakdownEntry, PickerGexContext, RuleSetEntry } from "@morai/contracts";
import { cn } from "@/lib/utils";
import { CandidateCard } from "../components/picker/CandidateCard.tsx";
import { ScenarioStrip } from "../components/picker/ScenarioStrip.tsx";
import { WhyPanel } from "../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../components/picker/EntryExitPlan.tsx";
import { Panel, PanelHeading, Button, MetricChip } from "../components/system/index.tsx";
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
import { useExits } from "../hooks/useExits.ts";
import { useRepullChains } from "../hooks/useRepullChains.ts";
import { parseTosOrder } from "../lib/tos-parser.ts";
import { parsedCalendarToPickerCandidate } from "../lib/parsed-calendar-to-candidate.ts";
import { HeldPositionsPanel } from "./HeldPositionsPanel.tsx";
import { ExitRulesPanel } from "./ExitRulesPanel.tsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

/** ANLZ-02 picker curve colors (UI-SPEC Color table — distinct from both Overview's TOS
 * override and the old Analyzer's own defaults). */
const TODAY_CURVE_COLOR = "#5b9cf6";
const EXPIRATION_CURVE_COLOR = "#a78bfa";

/** Id prefix for a user-pasted calendar (multi-paste redesign: several can coexist, each with a
 * unique `pasted-${n}` id assigned in paste order). */
const PASTED_ID_PREFIX = "pasted-";

function isPastedId(id: string): boolean {
  return id.startsWith(PASTED_ID_PREFIX);
}

/** Honest copy shown wherever engine-scored content would otherwise render for a pasted
 * candidate — a paste is never scored/ranked, so this replaces WhyPanel/ScoringMethodologyPanel/
 * EntryExitPlan content rather than fabricate scored-looking numbers for it. */
const PASTED_NOT_SCORED_NOTE = "Pasted calendar — not engine-scored.";

const PASTE_ERROR_COPY =
  "Couldn't read that. Paste a TOS calendar order, e.g. BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC";

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

/** Fallback labels when the snapshot predates the rule registry (ruleSet empty). */
const FALLBACK_SCORE_ITEMS: ReadonlyArray<{ readonly key: BreakdownEntry["criterion"]; readonly label: string }> = [
  { key: "fwdEdge", label: "Forward-vol edge" },
  { key: "slope", label: "Term-structure slope" },
  { key: "eventAdjustment", label: "Event exposure" },
  { key: "gexFit", label: "GEX fit" },
  { key: "beVsEm", label: "Breakeven vs EM" },
];

// Weight-relative status: contribution is already the 0-100 share of the criterion's weight.
function scoreStatus(contribution: number): { readonly icon: string; readonly cls: string } {
  if (contribution >= (200 / 3)) return { icon: "✓", cls: "text-up" };
  if (contribution >= (100 / 3)) return { icon: "~", cls: "text-amber" };
  return { icon: "✗", cls: "text-down" };
}

/** Short chip labels — the ruleSet's verbose labels stay in WhyPanel/docs; chips scan fast. */
const CHIP_LABELS: Record<string, string> = {
  fwdEdge: "FWD-IV EDGE",
  slope: "SLOPE",
  gexFit: "GEX FIT",
  eventAdjustment: "EVENT RISK",
  beVsEm: "BE : EM",
  deltaNeutral: "Δ NEUTRAL",
  thetaVega: "θ/VEGA",
  vrp: "VRP",
  debitFit: "DEBIT",
};

const EXPERIMENTAL_SHORT: Record<string, string> = {
  vrp: "VRP",
  slopePercentile: "SLP%",
  backEventBonus: "EVT",
  thetaVega: "θ/V",
};

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
  if (isPastedId(candidate.id)) {
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
}

/**
 * RightColumn — the "Why this calendar" / "Entry / exit plan" stack for the currently-selected
 * candidate. The term-structure chart moved to the center column (stacked under the payoff graph);
 * reads the live snapshot's GEX context (Phase 19: never the frozen fixture).
 */
function RightColumn({ candidate, gex }: RightColumnProps): React.ReactElement {
  const isPasted = candidate !== null && isPastedId(candidate.id);
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeading title="Why this calendar" />
        {isPasted ? (
          <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
        ) : (
          candidate !== null && gex !== null && <WhyPanel candidate={candidate} gex={gex} />
        )}
      </Panel>
      <Panel>
        <PanelHeading title="Entry / exit plan" />
        {isPasted ? (
          <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
        ) : (
          candidate !== null && <EntryExitPlan candidate={candidate} />
        )}
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

  // ── Pasted calendars (multi-paste redesign): any number of "PASTED"-badged cards pinned atop
  // the rail in paste order, each with a unique `pasted-${n}` id from the monotonic `pastedSeq`
  // counter. Each Analyze ADDS a card; each card's own × (onRemovePasted) or "Clear all"
  // (onClearAllPasted) removes it. Every pasted card drives the SAME
  // candidate→position→repriceScenario payoff path as every scored candidate. ──
  const [pastedCandidates, setPastedCandidates] = useState<ReadonlyArray<PickerCandidate>>([]);
  const [pastedSeq, setPastedSeq] = useState(0);
  const [pasteText, setPasteText] = useState<string>("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const railCandidates = useMemo<ReadonlyArray<PickerCandidate>>(
    () => [...pastedCandidates, ...sortedCandidates],
    [pastedCandidates, sortedCandidates],
  );

  const selected = useMemo<PickerCandidate | null>(() => {
    const found = railCandidates.find((c) => c.id === selectedId);
    return found ?? railCandidates[0] ?? null;
  }, [selectedId, railCandidates]);

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

  const handlePasteAnalyze = useCallback((): void => {
    const parsed = parseTosOrder(pasteText, today, spot, DEFAULT_RATE);
    if (parsed === null) {
      setPasteError(PASTE_ERROR_COPY);
      return;
    }
    setPasteError(null);
    const nextSeq = pastedSeq + 1;
    const id = `${PASTED_ID_PREFIX}${nextSeq}`;
    const candidate = parsedCalendarToPickerCandidate(parsed, id);
    setPastedCandidates((prev) => [...prev, candidate]);
    setPastedSeq(nextSeq);
    setSelectedId(id);
    setPasteText("");
  }, [pasteText, today, spot, pastedSeq]);

  const handleRemovePasted = useCallback((candidate: PickerCandidate): void => {
    setPastedCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    setCombinedIds((prev) => {
      if (!prev.has(candidate.id)) return prev;
      const next = new Set(prev);
      next.delete(candidate.id);
      return next;
    });
    setSelectedId((prev) => (prev === candidate.id ? "" : prev));
  }, []);

  const handleClearAllPasted = useCallback((): void => {
    const removedIds = new Set(pastedCandidates.map((c) => c.id));
    if (removedIds.size === 0) return;
    setPastedCandidates([]);
    setCombinedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of removedIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
    setSelectedId((prev) => (removedIds.has(prev) ? "" : prev));
    setPasteText("");
    setPasteError(null);
  }, [pastedCandidates]);

  // The combined book = the selected candidate (always) + any ⊕-Combine'd calendars — pooled
  // over railCandidates so a ⊕-Combine'd pasted card is included even when a scored candidate
  // is the one selected.
  const bookCandidates = useMemo<ReadonlyArray<PickerCandidate>>(() => {
    if (selected === null) return [];
    const extra = railCandidates.filter((c) => combinedIds.has(c.id) && c.id !== selected.id);
    return [selected, ...extra];
  }, [selected, railCandidates, combinedIds]);

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

  // Re-pull chains control — lives with the rail it refreshes (heading action slot).
  const repull = useRepullChains();
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

  // ── Held positions + exit rules (EXIT-07/EXIT-09, 26-06-PLAN.md): new full-width sections
  // BELOW the 3-col grid — the existing rail/risk-profile/why-panel columns above are UNCHANGED
  // (PICK-02 "no layout change"). Same D-18/D-19-style state precedence as the picker rail:
  // loading → error → cold-start (no verdicts computed anywhere yet) → empty (settled, zero open
  // calendars) → loaded. ──
  const { data: exitsData, isPending: exitsIsPending, isError: exitsIsError, refetch: exitsRefetch } = useExits();
  const exitsSnapshot = exitsData ?? null;

  let exitsBody: React.ReactElement;
  if (exitsIsPending && exitsData === undefined) {
    exitsBody = (
      <Panel>
        <PanelHeading title="Held positions" />
        <div
          className="flex items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="held-positions-loading"
        >
          Loading exit verdicts…
        </div>
      </Panel>
    );
  } else if (exitsIsError) {
    exitsBody = (
      <Panel>
        <PanelHeading title="Held positions" />
        <div className="flex flex-col items-center gap-2 p-4 text-center" data-testid="held-positions-error">
          <p className="m-0 font-mono text-[12px] text-down">Couldn&apos;t load exit verdicts.</p>
          <Button
            onClick={() => {
              void exitsRefetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Panel>
    );
  } else if (exitsSnapshot === null) {
    exitsBody = (
      <Panel>
        <PanelHeading title="Held positions" />
        <div className="flex flex-col gap-1.5 p-4" data-testid="held-positions-cold-start">
          <p className="m-0 font-display text-sm font-bold text-txt">Exit advisor warming up</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            First verdict pending — check back after the next chain snapshot.
          </p>
        </div>
      </Panel>
    );
  } else if (exitsSnapshot.positions.length === 0) {
    exitsBody = (
      <Panel>
        <PanelHeading title="Held positions" />
        <div className="flex flex-col gap-1.5 p-4" data-testid="held-positions-empty">
          <p className="m-0 font-display text-sm font-bold text-txt">No open positions</p>
          <p className="m-0 font-mono text-[11px] text-dim">
            Nothing to advise on — the exit advisor activates once you have an open calendar.
          </p>
        </div>
      </Panel>
    );
  } else {
    exitsBody = (
      <HeldPositionsPanel
        positions={exitsSnapshot.positions}
        observedAt={exitsSnapshot.observedAt}
        marketSession={exitsSnapshot.marketSession}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 bg-bg p-3">
      {/* ── Top strip: the engine's scorecard chips for the selected calendar ── */}
      <ScoringMethodologyPanel
        candidate={selected}
        ruleSet={snapshot?.ruleSet ?? []}
        gateDrops={snapshot?.gateDrops ?? { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 }}
        marketSession={snapshot?.marketSession ?? "rth"}
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr 330px" }}>
      {/* ── Left column: ranked rail ── */}
      <div className="flex flex-col gap-3">
        {railBody}
      </div>

      {/* ── Center column: payoff graph + term structure (both charts, stacked) ── */}
      <div className="flex min-w-0 flex-col gap-3">
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
              {isPastedId(selected.id)
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
                expectedMoveBand={selected.expectedMove > 0 ? { spot, em: selected.expectedMove } : null}
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

      {/* ── Held positions + exit rules (EXIT-07/EXIT-09): new full-width sections below the
          3-col grid — a new sibling, not inserted into the picker's own columns above. ── */}
      {exitsBody}
      {exitsSnapshot !== null && <ExitRulesPanel ruleSet={exitsSnapshot.ruleSet} />}
    </div>
  );
}
