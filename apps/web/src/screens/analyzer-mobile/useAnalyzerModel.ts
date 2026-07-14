/**
 * useAnalyzerModel — the shared Analyzer state/derivation hook (Phase 36, D-02).
 *
 * All non-trivial state and derivation that used to live inline in `Analyzer()` moves here
 * (the `useOverviewModel` precedent) so BOTH the desktop and mobile Analyzer trees consume
 * one model — the logic is never duplicated per tree; only the view JSX is (sanctioned).
 *
 * The D-02 constants/helpers (`PASTED_NOT_SCORED_NOTE`, `PASTE_ERROR_COPY`, `CHIP_LABELS`,
 * `EXPERIMENTAL_SHORT`, `FALLBACK_SCORE_ITEMS`, `scoreStatus`, and the two picker curve
 * colors) are exported alongside so `Analyzer.tsx` (and the mobile tree) import them from
 * this single home. `DEFAULT_RATE`/`DEFAULT_DIV`/`PASTED_ID_PREFIX` stay module-private —
 * only the hook uses them.
 *
 * Behavior-preserving extraction: the existing Analyzer.test.tsx suite passes UNMODIFIED.
 *
 * No any/as/!.
 */
import { useCallback, useMemo, useState } from "react";
import type { PickerCandidate, PickerSnapshotResponse, BreakdownEntry } from "@morai/contracts";
import { candidateToAnalyzerPosition } from "../../lib/candidate-to-position.ts";
import { buildTosCalendarOrder } from "../../lib/tos-order.ts";
import { repriceScenario } from "../../lib/scenario-engine.ts";
import type {
  ScenarioParams,
  ScenarioResult,
  AnalyzerPosition,
  SpotDomain,
} from "../../lib/scenario-engine.ts";
import { computePayoffDomain } from "../../lib/payoff-domain.ts";
import { computeProjectionBounds } from "../../lib/date-projection.ts";
import { usePayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import { usePicker } from "../../hooks/usePicker.ts";
import { useRepullChains } from "../../hooks/useRepullChains.ts";
import { useAnalyzeCalendar } from "../../hooks/useAnalyzeCalendar.ts";
import { useLiveStream } from "../../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../../hooks/useLiveStream.ts";
import { parseTosOrder } from "../../lib/tos-parser.ts";
import { parsedCalendarToPickerCandidate } from "../../lib/parsed-calendar-to-candidate.ts";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

/** ANLZ-02 picker curve colors (UI-SPEC Color table — distinct from both Overview's TOS
 * override and the old Analyzer's own defaults). */
export const TODAY_CURVE_COLOR = "#5b9cf6";
export const EXPIRATION_CURVE_COLOR = "#a78bfa";

/** Id prefix for a user-pasted calendar (multi-paste redesign: several can coexist, each with a
 * unique `pasted-${n}` id assigned in paste order, kept for provenance even when the server
 * scores the calendar — see handlePasteAnalyze). */
const PASTED_ID_PREFIX = "pasted-";

/** Honest copy shown wherever engine-scored content would otherwise render for a pasted
 * candidate that came back `scored:false` (or a pasted CALL, D-03 — never sent to the
 * endpoint) — `candidate.breakdown.length === 0` is the gate (Pitfall 8), not the pasted id,
 * so a successfully SCORED pasted candidate renders the same panels an engine candidate does. */
export const PASTED_NOT_SCORED_NOTE = "Pasted calendar — not engine-scored.";

export const PASTE_ERROR_COPY =
  "Couldn't read that. Paste a TOS calendar order, e.g. BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC";

/** Fallback labels when the snapshot predates the rule registry (ruleSet empty). */
export const FALLBACK_SCORE_ITEMS: ReadonlyArray<{ readonly key: BreakdownEntry["criterion"]; readonly label: string }> = [
  { key: "fwdEdge", label: "Forward-vol edge" },
  { key: "slope", label: "Term-structure slope" },
  { key: "eventAdjustment", label: "Event exposure" },
  { key: "gexFit", label: "GEX fit" },
  { key: "beVsEm", label: "Breakeven vs EM" },
];

// Weight-relative status: contribution is already the 0-100 share of the criterion's weight.
export function scoreStatus(contribution: number): { readonly icon: string; readonly cls: string } {
  if (contribution >= (200 / 3)) return { icon: "✓", cls: "text-up" };
  if (contribution >= (100 / 3)) return { icon: "~", cls: "text-amber" };
  return { icon: "✗", cls: "text-down" };
}

/** Short chip labels — the ruleSet's verbose labels stay in WhyPanel/docs; chips scan fast. */
export const CHIP_LABELS: Record<string, string> = {
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

export const EXPERIMENTAL_SHORT: Record<string, string> = {
  vrp: "VRP",
  slopePercentile: "SLP%",
  backEventBonus: "EVT",
  thetaVega: "θ/V",
};

// ─── Model ──────────────────────────────────────────────────────────────────────

export interface AnalyzerModel {
  readonly snapshot: PickerSnapshotResponse | null;
  /** The exact `isPending && data === undefined` loading gate the rail body needs. */
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
  readonly sortedCandidates: ReadonlyArray<PickerCandidate>;
  readonly railCandidates: ReadonlyArray<PickerCandidate>;
  readonly pastedCandidates: ReadonlyArray<PickerCandidate>;
  readonly pasteText: string;
  readonly setPasteText: (text: string) => void;
  readonly pasteError: string | null;
  readonly handlePasteAnalyze: () => void;
  readonly handleRemovePasted: (candidate: PickerCandidate) => void;
  readonly handleClearAllPasted: () => void;
  readonly selected: PickerCandidate | null;
  readonly selectedId: string;
  readonly handleSelect: (candidate: PickerCandidate) => void;
  readonly combinedIds: ReadonlySet<string>;
  readonly handleToggleCombine: (candidate: PickerCandidate) => void;
  readonly copiedId: string | null;
  readonly handleCopyCandidate: (candidate: PickerCandidate) => void;
  readonly selectedPosition: AnalyzerPosition | null;
  readonly bounds: { readonly minIso: string; readonly maxIso: string; readonly maxDaysForward: number };
  readonly dateControl: PayoffDateControl;
  readonly toggles: PayoffChartToggles;
  readonly handleToggle: (key: keyof PayoffChartToggles) => void;
  readonly payoffDomain: SpotDomain;
  readonly scenarioResult: ScenarioResult | null;
  readonly spot: number;
  readonly liveBadgeProps: {
    readonly status: LiveStreamStatus;
    readonly lastTickAt: Date | null;
    readonly isRth: boolean | null;
    readonly hasReceivedFirstTick: boolean;
    readonly isReconnecting: boolean;
    readonly onReconnect: () => void;
  };
  readonly bookCount: number;
  readonly bookDebit: number;
  readonly bookTheta: number;
  readonly bookVega: number;
  readonly positionSetSignature: string;
  readonly repull: ReturnType<typeof useRepullChains>;
}

/**
 * useAnalyzerModel — the single source of Analyzer state/derivation (D-02). Both the desktop
 * and mobile trees call it; the returned slices carry the exact behavior the inline Analyzer
 * body had, so the extraction is byte-for-byte behavior-preserving.
 */
export function useAnalyzerModel(): AnalyzerModel {
  const { data, isPending, isError, refetch } = usePicker();
  // Unify `undefined` (never-settled) and `null` (404 cold start) into one `null` sentinel —
  // downstream logic only needs to distinguish "no snapshot" from "a real snapshot".
  const snapshot = data ?? null;

  const sortedCandidates = useMemo<ReadonlyArray<PickerCandidate>>(() => {
    if (snapshot === null) return [];
    return [...snapshot.candidates].sort((a, b) => b.score - a.score);
  }, [snapshot]);

  // Live-aware spot seam (AUI-07, D-07 — direct port of Phase 38's LIVE-04): live only while
  // the stream itself is live AND a spot tick has arrived; else the unchanged 30-min snapshot
  // fallback — never a silent stale-as-live claim (catch #26). Only the source of `spot`
  // changes; the existing params/payoffDomain/scenarioResult memo chain below is untouched.
  const {
    status: liveStatus,
    liveSpot,
    lastTickAt: liveLastTickAt,
    isRth: liveIsRth,
    hasReceivedFirstTick: liveHasReceivedFirstTick,
    isReconnecting: liveIsReconnecting,
    reconnectNow: liveReconnectNow,
  } = useLiveStream();
  const spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (snapshot?.spot ?? 0);

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

  // POST /api/picker/analyze (D-02) — pasting a PUT calendar scores it through the real
  // engine; a pasted CALL (D-03) never reaches the endpoint (puts-only, binding #6).
  const analyzeCalendar = useAnalyzeCalendar();

  const handlePasteAnalyze = useCallback((): void => {
    const parsed = parseTosOrder(pasteText, today, spot, DEFAULT_RATE);
    if (parsed === null) {
      setPasteError(PASTE_ERROR_COPY);
      return;
    }
    setPasteError(null);
    setPasteText("");

    // Reserves the next id/seq and adds the card — kept together so a failed request never
    // consumes a seq number or selects a card that was never added (mirrors the parse-failure
    // no-op above).
    const addCandidate = (candidate: PickerCandidate): void => {
      setPastedSeq((prevSeq) => {
        const nextSeq = prevSeq + 1;
        const id = `${PASTED_ID_PREFIX}${nextSeq}`;
        // Keep the pasted-prefix id for provenance even on a scored response (the server
        // assigns its own `adhoc-*` id — not used client-side).
        setPastedCandidates((prev) => [...prev, { ...candidate, id }]);
        setSelectedId(id);
        return nextSeq;
      });
    };

    if (parsed.type === "C") {
      // Calls are never sent to the endpoint (D-03) — unscored fallback only.
      addCandidate(parsedCalendarToPickerCandidate(parsed, ""));
      return;
    }

    void analyzeCalendar
      .mutateAsync({
        putCall: "P",
        strike: parsed.strike,
        frontDte: parsed.frontDte,
        backDte: parsed.backDte,
        qty: parsed.qty,
        frontIv: parsed.iv,
        backIv: parsed.iv,
        debit: parsed.debit ?? 0,
        frontExpiry: parsed.frontExpiry,
        backExpiry: parsed.backExpiry,
      })
      .then((result) => {
        addCandidate(
          result.scored && result.candidate !== null
            ? result.candidate
            : parsedCalendarToPickerCandidate(parsed, ""),
        );
      })
      .catch(() => {
        // Network/HTTP failure (not scored:false, which resolves normally above) — the
        // existing paste-error copy, not a crash; no card is added (mirrors a parse failure).
        setPasteError(PASTE_ERROR_COPY);
      });
  }, [pasteText, today, spot, analyzeCalendar]);

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

  const payoffDomain = useMemo(
    () => computePayoffDomain(combinedPositions, spot, params),
    [combinedPositions, spot, params],
  );

  const scenarioResult = useMemo(
    () => (combinedPositions.length === 0 ? null : repriceScenario(combinedPositions, params, payoffDomain)),
    [combinedPositions, params, payoffDomain],
  );

  // Book totals (sum of debits/greeks) for the header summary when 2+ calendars are combined.
  const bookCount = bookCandidates.length;
  const bookDebit = bookCandidates.reduce((sum, c) => sum + c.debit, 0);
  const bookTheta = bookCandidates.reduce((sum, c) => sum + c.theta, 0);
  const bookVega = bookCandidates.reduce((sum, c) => sum + c.vega, 0);
  const positionSetSignature = combinedPositions.map((p) => p.id).join("|");

  // Re-pull chains control — lives with the rail it refreshes (heading action slot).
  const repull = useRepullChains();

  return {
    snapshot,
    isLoading: isPending && data === undefined,
    isError,
    refetch,
    sortedCandidates,
    railCandidates,
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
    liveBadgeProps: {
      status: liveStatus,
      lastTickAt: liveLastTickAt,
      isRth: liveIsRth,
      hasReceivedFirstTick: liveHasReceivedFirstTick,
      isReconnecting: liveIsReconnecting,
      onReconnect: liveReconnectNow,
    },
    bookCount,
    bookDebit,
    bookTheta,
    bookVega,
    positionSetSignature,
    repull,
  };
}
