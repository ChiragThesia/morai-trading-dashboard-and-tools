/**
 * Analyzer — 3-column risk cockpit (Plan 10, Task 3)
 *
 * UI-SPEC "Analyzer screen":
 *   Layout: height:100vh, 3-col 236px|1fr|320px, gap 12px, padding 11px
 *
 *   Left (236px):
 *     - Positions panel: live=●live protected, non-live=× removable, checkbox to include,
 *       paste/blank add; scanner shows frontDte/backDte/IV
 *     - Scenario panel: Spot / Days forward / IV shift sliders + Reset
 *     - Roll simulator
 *
 *   Center (1fr):
 *     - PayoffChart + combined P&L readout (today/expiration/roll)
 *     - GreekStrips (book-level greek curves)
 *     - PnlHeatmap (spot×date)
 *
 *   Right (320px):
 *     - What's-moving: regime strip + GammaProfile compact + LevelBar + GexBars
 *     - Book greeks table (delta/gamma/theta/vega)
 *     - AttributionWaterfall (analyzer variant)
 *
 * D-01: all re-pricing uses @morai/quant via repriceScenario — client-side, zero network.
 * D-04: no seed/demo positions.
 * No any/as/!.
 */

import { useState, useMemo, useCallback } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { parseTosOrder } from "../lib/tos-parser.ts";
import {
  repriceScenario,
  rollScenario,
} from "../lib/scenario-engine.ts";
import type {
  AnalyzerPosition,
  ScenarioParams,
  RollConfig,
} from "../lib/scenario-engine.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { GreekStrips } from "../components/charts/GreekStrips.tsx";
import { PnlHeatmap } from "../components/charts/PnlHeatmap.tsx";
import { RollSimulator } from "../components/RollSimulator.tsx";
import { AttributionWaterfall } from "../components/AttributionWaterfall.tsx";
import type { AnalyzerWaterfallData } from "../components/AttributionWaterfall.tsx";
import { LevelBar } from "../components/LevelBar.tsx";
import type { LevelBarData } from "../components/LevelBar.tsx";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { Panel, SectionLabel } from "../components/system/index.tsx";
import { AdHocPicker } from "../components/AdHocPicker.tsx";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import type { CalendarGroup } from "../lib/pair-calendars.ts";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse } from "@morai/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

/** OCC-derived IV default when no chain data (15%) */
const DEFAULT_IV = 0.15;
/** Default front/back DTE for pasted positions */
const DEFAULT_FRONT_DTE = 30;
const DEFAULT_BACK_DTE = 60;

/** Greek strip spot range */
const STRIP_RANGE = 200;
const STRIP_POINTS = 41;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function linspace(lo: number, hi: number, n: number): ReadonlyArray<number> {
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => lo + i * step);
}

/** Parse OCC strike from chars 13-20 (1/1000) — no @morai/shared dependency needed here */
function extractStrike(occSymbol: string): number {
  return parseInt(occSymbol.slice(13, 21), 10) / 1000;
}

/** Build an AnalyzerPosition from a broker position */
function brokerToAnalyzerPosition(
  p: BrokerPositionResponse,
  spotForDte: number,
): AnalyzerPosition {
  const netQty = p.longQty - p.shortQty;
  const qty = Math.max(1, Math.abs(netQty));
  // For live positions: use 45/69 DTE defaults (common calendar structure)
  // In production these would come from real DTE, but broker data doesn't include it here
  const frontDte = DEFAULT_FRONT_DTE;
  const backDte = DEFAULT_BACK_DTE;
  const strike = extractStrike(p.occSymbol);
  const label = `${strike}${p.putCall} ${p.occSymbol.slice(6, 12).trim()}`;
  void spotForDte; // spot available for future IV computation
  return {
    id: p.occSymbol,
    name: label,
    live: true,
    occSymbol: p.occSymbol,
    putCall: p.putCall,
    frontDte,
    backDte,
    frontIv: DEFAULT_IV,
    backIv: DEFAULT_IV,
    qty,
    included: true,
  };
}

/**
 * Build one AnalyzerPosition from a paired calendar (front = short/nearer, back = long/farther).
 * This is the real calendar structure — front/back DTE come from the actual leg expiries, not
 * the single-leg DEFAULT_FRONT/BACK_DTE fallback. IVs stay at DEFAULT_IV (broker has no IV).
 */
function calendarToAnalyzerPosition(cal: CalendarGroup): AnalyzerPosition {
  const qty = Math.max(1, Math.abs(cal.back.longQty - cal.back.shortQty));
  return {
    id: cal.key,
    name: `${cal.strike}${cal.optionType}`,
    live: true,
    occSymbol: cal.back.occSymbol, // AnalyzerPosition.occSymbol = BACK leg
    putCall: cal.optionType,
    frontDte: cal.dteFront,
    backDte: cal.dteBack,
    frontIv: DEFAULT_IV,
    backIv: DEFAULT_IV,
    qty,
    included: true,
  };
}

/** Format a greek for display */
function fmtGreek(v: number, decimals = 4): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}`;
}

/** Format P&L as compact dollar */
function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Positions panel ─────────────────────────────────────────────────────────

interface PositionsPanelProps {
  positions: ReadonlyArray<AnalyzerPosition>;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggleInclude: (id: string) => void;
  onRemove: (id: string) => void;
  onAddPasted: (text: string) => void;
  pasteError: string | null;
  pasteSuccess: string | null;
  spot: number;
}

function PositionsPanel({
  positions,
  selectedId,
  onSelect,
  onToggleInclude,
  onRemove,
  onAddPasted,
  pasteError,
  pasteSuccess,
  spot,
}: PositionsPanelProps): React.ReactElement {
  const [pasteText, setPasteText] = useState("");

  const handleAdd = useCallback(() => {
    onAddPasted(pasteText);
    setPasteText("");
  }, [pasteText, onAddPasted]);

  return (
    <Panel>
      <div className="mb-2">
        <SectionLabel>Positions</SectionLabel>
      </div>

      {positions.length === 0 && (
        <p className="my-2 font-mono text-[11px] text-dim">
          No open positions. Add from paste below.
        </p>
      )}

      <div className="mb-2 flex flex-col gap-1">
        {positions.map((p) => (
          <div
            key={p.id}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1",
              selectedId === p.id ? "bg-raise" : "bg-transparent",
            )}
            onClick={() => onSelect(p.id)}
          >
            <input
              type="checkbox"
              checked={p.included}
              onChange={() => onToggleInclude(p.id)}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer accent-blue"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] text-txt">
                {p.name}
              </div>
              <div className="font-mono text-[9px] text-dim">
                {`F${p.frontDte}d B${p.backDte}d IV${Math.round(p.frontIv * 100)}%`}
              </div>
            </div>
            {p.live ? (
              <span className="font-mono text-[9px] whitespace-nowrap text-up">
                ●live
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(p.id);
                }}
                className="cursor-pointer border-none bg-transparent px-0.5 text-xs leading-none text-dim"
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Paste input */}
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste TOS order…"
          className="w-full rounded border border-line2 bg-panel2 px-[7px] py-1 font-mono text-[10px] text-txt"
        />
        <button
          onClick={handleAdd}
          className="cursor-pointer rounded border border-line2 bg-raise py-1 text-center font-display text-[10px] text-txt"
        >
          + add from paste
        </button>

        {pasteSuccess !== null && (
          <p className="m-0 font-mono text-[9px] text-up">{pasteSuccess}</p>
        )}

        {pasteError !== null && (
          <p className="m-0 font-mono text-[9px] text-down">{pasteError}</p>
        )}
      </div>

      <div className="mt-2 flex justify-end border-t border-line pt-2">
        <span className="font-mono text-[9px] text-dim">
          {`spot ${spot.toFixed(0)}`}
        </span>
      </div>
    </Panel>
  );
}

// ─── Scenario panel ───────────────────────────────────────────────────────────

interface ScenarioPanelProps {
  params: ScenarioParams;
  onParamsChange: (p: ScenarioParams) => void;
  liveSpot: number;
}

function ScenarioPanel({ params, onParamsChange, liveSpot }: ScenarioPanelProps): React.ReactElement {
  const reset = useCallback(() => {
    onParamsChange({
      spot: liveSpot,
      daysForward: 0,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    });
  }, [liveSpot, onParamsChange]);

  return (
    <Panel className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>Scenario</SectionLabel>
        <button
          onClick={reset}
          className="cursor-pointer rounded-[3px] border border-line2 bg-transparent px-[7px] py-0.5 font-mono text-[9px] text-dim"
        >
          Reset
        </button>
      </div>

      {/* Spot slider */}
      <div className="mb-2.5">
        <div className="mb-[3px] flex justify-between">
          <span className="font-mono text-[9px] text-muted-foreground">Spot</span>
          <span className="font-display text-[11px] font-bold text-blue tabular-nums">
            {params.spot.toFixed(0)}
          </span>
        </div>
        <input
          type="range"
          min={liveSpot - 400}
          max={liveSpot + 400}
          step={1}
          value={params.spot}
          onChange={(e) => onParamsChange({ ...params, spot: Number(e.target.value) })}
          className="w-full"
          aria-label="Spot price"
        />
      </div>

      {/* Days forward slider */}
      <div className="mb-2.5">
        <div className="mb-[3px] flex justify-between">
          <span className="font-mono text-[9px] text-muted-foreground">Days fwd</span>
          <span className="font-display text-[11px] font-bold text-txt tabular-nums">
            {`+${params.daysForward}d`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={params.daysForward}
          onChange={(e) => onParamsChange({ ...params, daysForward: Number(e.target.value) })}
          className="w-full"
          aria-label="Days forward"
        />
      </div>

      {/* IV shift slider */}
      <div>
        <div className="mb-[3px] flex justify-between">
          <span className="font-mono text-[9px] text-muted-foreground">IV shift</span>
          <span
            className={cn(
              "font-display text-[11px] font-bold tabular-nums",
              params.ivShift >= 0 ? "text-txt" : "text-down",
            )}
          >
            {`${params.ivShift >= 0 ? "+" : ""}${params.ivShift.toFixed(1)}v`}
          </span>
        </div>
        <input
          type="range"
          min={-10}
          max={10}
          step={0.5}
          value={params.ivShift}
          onChange={(e) => onParamsChange({ ...params, ivShift: Number(e.target.value) })}
          className="w-full"
          aria-label="IV shift"
        />
      </div>
    </Panel>
  );
}

// ─── Book greeks table ────────────────────────────────────────────────────────

function BookGreeksTable({
  delta,
  gamma,
  theta,
  vega,
}: {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}): React.ReactElement {
  const rows = [
    { label: "Δ", value: delta, color: "text-blue" },
    { label: "Γ", value: gamma, color: "text-cyan" },
    { label: "Θ/d", value: theta, color: "text-amber" },
    { label: "Vega", value: vega, color: "text-up" },
  ] as const;

  return (
    <Panel className="mt-2">
      <div className="mb-2">
        <SectionLabel>Book greeks</SectionLabel>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={cn("w-10 py-[3px] font-mono text-[10px]", row.color)}>
                {row.label}
              </td>
              <td className="text-right font-display text-xs font-bold text-txt tabular-nums">
                {fmtGreek(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── Combined P&L readout ─────────────────────────────────────────────────────

function PlReadout({
  todayPl,
  expiryPl,
  rollPl,
}: {
  todayPl: number;
  expiryPl: number;
  rollPl: number | null;
}): React.ReactElement {
  return (
    <div className="flex gap-4 py-1.5 font-display tabular-nums">
      <div>
        <div className="text-[9px] tracking-[0.7px] text-muted-foreground uppercase">
          Today
        </div>
        <div className={cn("text-[15px] font-bold", todayPl >= 0 ? "text-up" : "text-down")}>
          {fmtDollar(todayPl)}
        </div>
      </div>
      <div>
        <div className="text-[9px] tracking-[0.7px] text-muted-foreground uppercase">
          Expiry
        </div>
        <div className={cn("text-[15px] font-bold", expiryPl >= 0 ? "text-up" : "text-down")}>
          {fmtDollar(expiryPl)}
        </div>
      </div>
      {rollPl !== null && (
        <div>
          <div className="text-[9px] tracking-[0.7px] text-amber uppercase">
            Roll
          </div>
          <div className="text-[15px] font-bold text-amber">
            {fmtDollar(rollPl)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Analyzer screen ─────────────────────────────────────────────────────

/**
 * Analyzer — exported named export (D-04: no seed/demo data; live only on mount).
 */
export function Analyzer(): React.ReactElement {
  const positionsQuery = usePositions();
  const gexQuery = useGex();

  // Live spot from GEX snapshot or fallback
  const liveSpot = gexQuery.data?.spot ?? 7381;

  // Scenario slider state
  const [params, setParams] = useState<ScenarioParams>({
    spot: liveSpot,
    daysForward: 0,
    ivShift: 0,
    rate: DEFAULT_RATE,
    divYield: DEFAULT_DIV,
  });

  // Roll config
  const [rollConfig, setRollConfig] = useState<RollConfig>({
    rollDays: 0,
    strikeOffset: 0,
  });

  // Synthetic (pasted) positions
  const [syntheticPositions, setSyntheticPositions] = useState<ReadonlyArray<AnalyzerPosition>>([]);

  // Selected position ID for roll simulator target
  const [selectedId, setSelectedId] = useState<string>("");

  // Live stream for the ad-hoc greeks lookup (moved here from the Positions/Overview screen)
  const {
    greeks: liveGreeks,
    status: liveStatus,
    subscribeAdHoc,
  } = useLiveStream();
  const [adHocSymbol, setAdHocSymbol] = useState<string | null>(null);

  // Paste UI state
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState<string | null>(null);

  // Toggle fit-Y on payoff chart
  const [fitY, setFitY] = useState(false);
  const [fitYConsumed, setFitYConsumed] = useState(false);

  // Chart toggles — keys match PayoffChartToggles (the chart's contract)
  const [toggles, setToggles] = useState({
    showFan: true,
    showExpiration: true,
    showWalls: true,
    showProfitZone: true,
  });

  // ── Convert broker positions to AnalyzerPositions ─────────────────────────

  const livePositions = useMemo<ReadonlyArray<AnalyzerPosition>>(() => {
    const raw = positionsQuery.data?.positions ?? [];
    // Pair legs into calendars (real front/back DTE) — not one fake calendar per leg.
    const { calendars, singles } = pairPositionsIntoCalendars(raw, new Date());
    return [
      ...calendars.map(calendarToAnalyzerPosition),
      ...singles.map((p) => brokerToAnalyzerPosition(p, liveSpot)),
    ];
  }, [positionsQuery.data, liveSpot]);

  // ── Combined position list (live first, then synthetic) ───────────────────

  const allPositions = useMemo<ReadonlyArray<AnalyzerPosition>>(
    () => [...livePositions, ...syntheticPositions],
    [livePositions, syntheticPositions],
  );

  // Set default selected to first live position
  const resolvedSelectedId = selectedId || (livePositions[0]?.id ?? "");

  // ── Toggle include for a position ─────────────────────────────────────────

  const handleToggleInclude = useCallback((id: string) => {
    setSyntheticPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, included: !p.included } : p)),
    );
    // Live positions: cannot toggle include from here (they're from the broker)
    // In a full impl, live toggles would update a separate inclusion overlay
  }, []);

  // ── Remove synthetic position ─────────────────────────────────────────────

  const handleRemove = useCallback((id: string) => {
    setSyntheticPositions((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Add from paste ────────────────────────────────────────────────────────

  const handleAddPasted = useCallback(
    (text: string) => {
      setPasteError(null);
      setPasteSuccess(null);

      const parsed = parseTosOrder(text, new Date(), params.spot, params.rate);

      if (parsed === null) {
        setPasteError("Could not parse — need 2 expiries, a strike, and PUT/CALL.");
        return;
      }

      // Build synthetic AnalyzerPosition (D-04: non-live)
      const id = `pasted-${parsed.underlying}-${parsed.strike}${parsed.type}-${Date.now()}`;
      const label = `${parsed.strike}${parsed.type} F${parsed.frontDte}d/B${parsed.backDte}d`;
      const newPos: AnalyzerPosition = {
        id,
        name: label,
        live: false,
        occSymbol: `${parsed.underlying.padEnd(6)}${String(parsed.frontDte).padStart(6, "0")}${parsed.type}${String(Math.round(parsed.strike * 1000)).padStart(8, "0")}`,
        putCall: parsed.type,
        frontDte: parsed.frontDte,
        backDte: parsed.backDte,
        frontIv: parsed.iv,
        backIv: parsed.iv,
        qty: parsed.qty,
        included: true,
      };
      setSyntheticPositions((prev) => [...prev, newPos]);
      setPasteSuccess(`Added: ${label}`);
    },
    [params.spot, params.rate],
  );

  // ── Run scenario engine (client-side, zero network) ───────────────────────

  const scenarioResult = useMemo(() => {
    const included = allPositions.filter((p) => p.included);
    if (included.length === 0) return null;
    return repriceScenario(included, params);
  }, [allPositions, params]);

  // ── Roll overlay ──────────────────────────────────────────────────────────

  const rollResult = useMemo(() => {
    if (rollConfig.rollDays === 0 && rollConfig.strikeOffset === 0) return null;
    const included = allPositions.filter((p) => p.included);
    if (included.length === 0 || resolvedSelectedId === "") return null;
    return rollScenario(included, resolvedSelectedId, params, rollConfig);
  }, [allPositions, resolvedSelectedId, params, rollConfig]);

  // ── Book-level combined greeks at current params ──────────────────────────

  const bookGreeks = useMemo(() => {
    const strip = scenarioResult?.positionGreeks ?? [];
    return strip.reduce(
      (acc, g) => ({
        delta: acc.delta + g.delta,
        gamma: acc.gamma + g.gamma,
        theta: acc.theta + g.theta,
        vega: acc.vega + g.vega,
      }),
      { delta: 0, gamma: 0, theta: 0, vega: 0 },
    );
  }, [scenarioResult]);

  // ── Greek strips data ─────────────────────────────────────────────────────

  const greekStripData = useMemo(() => {
    const strip = scenarioResult?.bookGreekStrips;
    if (strip === undefined || strip.spots.length === 0) {
      const spots = linspace(liveSpot - STRIP_RANGE, liveSpot + STRIP_RANGE, STRIP_POINTS);
      return {
        spots,
        delta: spots.map(() => 0),
        gamma: spots.map(() => 0),
        theta: spots.map(() => 0),
        vega: spots.map(() => 0),
        currentSpot: liveSpot,
      };
    }
    return { ...strip, currentSpot: params.spot };
  }, [scenarioResult, liveSpot, params.spot]);

  // ── Attribution waterfall ──────────────────────────────────────────────────

  const waterfallData = useMemo<AnalyzerWaterfallData>(() => {
    // Analyzer variant: spot / theta / vega / residual
    return {
      spotDelta: bookGreeks.delta * (params.spot - liveSpot),
      theta: bookGreeks.theta * params.daysForward,
      vega: bookGreeks.vega * params.ivShift,
      residual: 0,
    };
  }, [bookGreeks, params, liveSpot]);

  // ── Level bar data ─────────────────────────────────────────────────────────

  const levelBarData = useMemo<LevelBarData | null>(() => {
    const gex = gexQuery.data;
    if (gex === null || gex === undefined) return null;
    const firstIncluded = allPositions.find((p) => p.included);
    const strike = firstIncluded !== undefined ? extractStrike(firstIncluded.occSymbol) : liveSpot;
    return {
      putWall: gex.putWall ?? liveSpot - 200,
      callWall: gex.callWall ?? liveSpot + 200,
      gammaFlip: gex.flip ?? liveSpot,
      strike,
      spot: liveSpot,
    };
  }, [gexQuery.data, allPositions, liveSpot]);

  // ── P&L readout ───────────────────────────────────────────────────────────

  const todayPl = useMemo(() => {
    const curve = scenarioResult?.payoffCurve ?? [];
    const point = curve.find((pt) => Math.abs(pt.spot - params.spot) < 0.5);
    return point?.pl ?? 0;
  }, [scenarioResult, params.spot]);

  const expiryPl = useMemo(() => {
    const curve = scenarioResult?.expirationCurve ?? [];
    const point = curve.find((pt) => Math.abs(pt.spot - params.spot) < 0.5);
    return point?.pl ?? 0;
  }, [scenarioResult, params.spot]);

  const rollPl = useMemo<number | null>(() => {
    if (rollResult === null) return null;
    const point = rollResult.payoffCurve.find((pt) => Math.abs(pt.spot - params.spot) < 0.5);
    return point?.pl ?? 0;
  }, [rollResult, params.spot]);

  // ── Selected position name ────────────────────────────────────────────────

  const selectedPositionName = useMemo(() => {
    return allPositions.find((p) => p.id === resolvedSelectedId)?.name ?? "—";
  }, [allPositions, resolvedSelectedId]);

  // ── Position set signature (stable for TOS-stable y-axis) ────────────────

  const positionSetSignature = useMemo(() => {
    return allPositions
      .filter((p) => p.included)
      .map((p) => p.id)
      .join(",");
  }, [allPositions]);

  // ── Included positions for heatmap ───────────────────────────────────────

  const includedPositions = useMemo(
    () => allPositions.filter((p) => p.included),
    [allPositions],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="grid h-screen gap-3 overflow-y-auto bg-bg p-[11px]"
      style={{ gridTemplateColumns: "236px 1fr 320px" }}
    >
      {/* ── Left column ─────────────────────────────────── */}
      <div className="flex flex-col">
        <PositionsPanel
          positions={allPositions}
          selectedId={resolvedSelectedId}
          onSelect={setSelectedId}
          onToggleInclude={handleToggleInclude}
          onRemove={handleRemove}
          onAddPasted={handleAddPasted}
          pasteError={pasteError}
          pasteSuccess={pasteSuccess}
          spot={liveSpot}
        />
        <ScenarioPanel
          params={params}
          onParamsChange={setParams}
          liveSpot={liveSpot}
        />
        <div className="mt-2">
          <Panel>
            <RollSimulator
              selectedPositionName={selectedPositionName}
              rollConfig={rollConfig}
              onChange={setRollConfig}
            />
          </Panel>
        </div>
        <div className="mt-2">
          <Panel>
            <AdHocPicker
              subscribeAdHoc={subscribeAdHoc}
              liveGreeks={liveGreeks}
              liveStatus={liveStatus}
              adHocSymbol={adHocSymbol}
              onSetAdHocSymbol={(sym) => { setAdHocSymbol(sym); }}
              onClearAdHoc={() => { setAdHocSymbol(null); }}
            />
          </Panel>
        </div>
      </div>

      {/* ── Center column ────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-2">
        <Panel>
          {/* Heading row */}
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Risk profile</SectionLabel>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setFitY(true);
                  setFitYConsumed(false);
                }}
                className="cursor-pointer rounded-[3px] border border-line2 bg-transparent px-[7px] py-0.5 font-mono text-[9px] text-dim"
              >
                Fit Y
              </button>
              {/* Toggle buttons — explicit per-key (avoids noUncheckedIndexedAccess any) */}
              {(
                [
                  { label: "Fan", key: "showFan" },
                  { label: "Exp", key: "showExpiration" },
                  { label: "Walls", key: "showWalls" },
                  { label: "Zone", key: "showProfitZone" },
                ] as const
              ).map(({ label, key }) => {
                const active = toggles[key];
                return (
                  <button
                    key={label}
                    onClick={() => setToggles((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={cn(
                      "cursor-pointer rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px]",
                      active
                        ? "border-line2 bg-raise text-txt"
                        : "border-line bg-transparent text-dim",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <PlReadout todayPl={todayPl} expiryPl={expiryPl} rollPl={rollPl} />

          <PayoffChart
            todayCurve={scenarioResult?.payoffCurve ?? []}
            fanCurves={scenarioResult?.fanCurves ?? []}
            expirationCurve={scenarioResult?.expirationCurve ?? []}
            rollCurve={rollResult?.payoffCurve ?? null}
            gex={gexQuery.data ?? null}
            spot={params.spot}
            toggles={toggles}
            fitY={fitY && !fitYConsumed}
            onFitYConsumed={() => setFitYConsumed(true)}
            positionSetSignature={positionSetSignature}
            baseExpirationCurve={scenarioResult?.expirationCurve ?? []}
          />
        </Panel>

        <Panel>
          <div className="mb-2">
            <SectionLabel>Book greeks</SectionLabel>
          </div>
          <GreekStrips data={greekStripData} panelWidth={180} panelHeight={80} />
        </Panel>

        <Panel>
          <PnlHeatmap positions={includedPositions} params={params} />
        </Panel>
      </div>

      {/* ── Right column ─────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {/* What's-moving */}
        <Panel>
          <div className="mb-2">
            <SectionLabel>What's moving</SectionLabel>
          </div>
          {gexQuery.data !== null && gexQuery.data !== undefined ? (
            <div className="flex flex-col gap-2">
              <GammaProfile
                profile={gexQuery.data.profile}
                flip={gexQuery.data.flip}
                spot={gexQuery.data.spot}
                compact
              />
              {levelBarData !== null && (
                <LevelBar data={levelBarData} />
              )}
              <GexBars
                strikes={gexQuery.data.strikes}
                spot={gexQuery.data.spot}
                callWall={gexQuery.data.callWall}
                putWall={gexQuery.data.putWall}
              />
            </div>
          ) : (
            <p className="m-0 font-mono text-[10px] text-dim">
              {gexQuery.isLoading ? "Loading GEX…" : "GEX unavailable"}
            </p>
          )}
        </Panel>

        <BookGreeksTable
          delta={bookGreeks.delta}
          gamma={bookGreeks.gamma}
          theta={bookGreeks.theta}
          vega={bookGreeks.vega}
        />

        <Panel>
          <div className="mb-2">
            <SectionLabel>Attribution</SectionLabel>
          </div>
          <AttributionWaterfall variant="analyzer" data={waterfallData} trackHeight={12} />
        </Panel>
      </div>
    </div>
  );
}
