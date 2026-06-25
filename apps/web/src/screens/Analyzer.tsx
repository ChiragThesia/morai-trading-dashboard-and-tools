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
  p: BrokerPositionResponse[number],
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

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #0f1521, #0c111a)",
        border: "1px solid #1b2433",
        borderRadius: 8,
        padding: 12,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }): React.ReactElement {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.9px",
        textTransform: "uppercase",
        color: "#7b8696",
        fontFamily: "Space Grotesk, sans-serif",
      }}
    >
      {text}
    </span>
  );
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
    <Card>
      <div style={{ marginBottom: 8 }}>
        <SectionLabel text="Positions" />
      </div>

      {positions.length === 0 && (
        <p
          style={{
            color: "#566273",
            fontSize: 11,
            fontFamily: "JetBrains Mono, monospace",
            margin: "8px 0",
          }}
        >
          No open positions. Add from paste below.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {positions.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px",
              borderRadius: 4,
              background: selectedId === p.id ? "#141c2c" : "transparent",
              cursor: "pointer",
            }}
            onClick={() => onSelect(p.id)}
          >
            <input
              type="checkbox"
              checked={p.included}
              onChange={() => onToggleInclude(p.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ accentColor: "#5b9cf6", cursor: "pointer" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#c4cdd9",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: "#566273",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {`F${p.frontDte}d B${p.backDte}d IV${Math.round(p.frontIv * 100)}%`}
              </div>
            </div>
            {p.live ? (
              <span
                style={{
                  fontSize: 9,
                  color: "#26a69a",
                  fontFamily: "JetBrains Mono, monospace",
                  whiteSpace: "nowrap",
                }}
              >
                ●live
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(p.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#566273",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Paste input */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input
          type="text"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste TOS order…"
          style={{
            background: "#0c111a",
            border: "1px solid #27313f",
            borderRadius: 4,
            color: "#c4cdd9",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
            padding: "4px 7px",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={handleAdd}
          style={{
            background: "#141c2c",
            border: "1px solid #27313f",
            borderRadius: 4,
            color: "#c4cdd9",
            fontSize: 10,
            fontFamily: "Space Grotesk, sans-serif",
            padding: "4px 0",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          + add from paste
        </button>

        {pasteSuccess !== null && (
          <p
            style={{
              fontSize: 9,
              color: "#26a69a",
              fontFamily: "JetBrains Mono, monospace",
              margin: 0,
            }}
          >
            {pasteSuccess}
          </p>
        )}

        {pasteError !== null && (
          <p
            style={{
              fontSize: 9,
              color: "#ef5350",
              fontFamily: "JetBrains Mono, monospace",
              margin: 0,
            }}
          >
            {pasteError}
          </p>
        )}
      </div>

      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid #1b2433",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <span style={{ fontSize: 9, color: "#566273", fontFamily: "JetBrains Mono, monospace" }}>
          {`spot ${spot.toFixed(0)}`}
        </span>
      </div>
    </Card>
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
    <Card style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <SectionLabel text="Scenario" />
        <button
          onClick={reset}
          style={{
            background: "none",
            border: "1px solid #27313f",
            borderRadius: 3,
            color: "#566273",
            cursor: "pointer",
            fontSize: 9,
            padding: "2px 7px",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          Reset
        </button>
      </div>

      {/* Spot slider */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#7b8696", fontFamily: "JetBrains Mono, monospace" }}>
            Spot
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              color: "#5b9cf6",
              fontVariantNumeric: "tabular-nums",
            }}
          >
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
          style={{ width: "100%" }}
          aria-label="Spot price"
        />
      </div>

      {/* Days forward slider */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#7b8696", fontFamily: "JetBrains Mono, monospace" }}>
            Days fwd
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              color: "#c4cdd9",
              fontVariantNumeric: "tabular-nums",
            }}
          >
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
          style={{ width: "100%" }}
          aria-label="Days forward"
        />
      </div>

      {/* IV shift slider */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#7b8696", fontFamily: "JetBrains Mono, monospace" }}>
            IV shift
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              color: params.ivShift >= 0 ? "#c4cdd9" : "#ef5350",
              fontVariantNumeric: "tabular-nums",
            }}
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
          style={{ width: "100%" }}
          aria-label="IV shift"
        />
      </div>
    </Card>
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
    { label: "Δ", value: delta, color: "#5b9cf6" },
    { label: "Γ", value: gamma, color: "#22d3ee" },
    { label: "Θ/d", value: theta, color: "#f0b429" },
    { label: "Vega", value: vega, color: "#26a69a" },
  ] as const;

  return (
    <Card style={{ marginTop: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <SectionLabel text="Book greeks" />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td
                style={{
                  fontSize: 10,
                  fontFamily: "JetBrains Mono, monospace",
                  color: row.color,
                  padding: "3px 0",
                  width: 40,
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  fontSize: 12,
                  fontFamily: "Space Grotesk, sans-serif",
                  fontWeight: 700,
                  color: "#c4cdd9",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtGreek(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
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
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "6px 0",
        fontFamily: "Space Grotesk, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div>
        <div style={{ fontSize: 9, color: "#7b8696", textTransform: "uppercase", letterSpacing: "0.7px" }}>
          Today
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: todayPl >= 0 ? "#26a69a" : "#ef5350",
          }}
        >
          {fmtDollar(todayPl)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 9, color: "#7b8696", textTransform: "uppercase", letterSpacing: "0.7px" }}>
          Expiry
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: expiryPl >= 0 ? "#26a69a" : "#ef5350",
          }}
        >
          {fmtDollar(expiryPl)}
        </div>
      </div>
      {rollPl !== null && (
        <div>
          <div style={{ fontSize: 9, color: "#f0b429", textTransform: "uppercase", letterSpacing: "0.7px" }}>
            Roll
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#f0b429",
            }}
          >
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

  // Paste UI state
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState<string | null>(null);

  // Toggle fit-Y on payoff chart
  const [fitY, setFitY] = useState(false);
  const [fitYConsumed, setFitYConsumed] = useState(false);

  // Chart toggles
  const [toggles, setToggles] = useState({
    showFan: true,
    showExpiry: true,
    showRoll: true,
    showGex: true,
    showZeroline: true,
  });

  // ── Convert broker positions to AnalyzerPositions ─────────────────────────

  const livePositions = useMemo<ReadonlyArray<AnalyzerPosition>>(() => {
    const raw = positionsQuery.data ?? [];
    return raw.map((p) => brokerToAnalyzerPosition(p, liveSpot));
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
    const point = rollResult.find((pt) => Math.abs(pt.spot - params.spot) < 0.5);
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
      style={{
        display: "grid",
        gridTemplateColumns: "236px 1fr 320px",
        gap: 12,
        padding: 11,
        height: "100vh",
        boxSizing: "border-box",
        background: "#08111a",
        overflowY: "auto",
      }}
    >
      {/* ── Left column ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
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
        <div style={{ marginTop: 8 }}>
          <Card>
            <RollSimulator
              selectedPositionName={selectedPositionName}
              rollConfig={rollConfig}
              onChange={setRollConfig}
            />
          </Card>
        </div>
      </div>

      {/* ── Center column ────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <Card>
          {/* Heading row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <SectionLabel text="Risk profile" />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => {
                  setFitY(true);
                  setFitYConsumed(false);
                }}
                style={{
                  background: "none",
                  border: "1px solid #27313f",
                  borderRadius: 3,
                  color: "#566273",
                  cursor: "pointer",
                  fontSize: 9,
                  padding: "2px 7px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                Fit Y
              </button>
              {/* Toggle buttons — explicit per-key (avoids noUncheckedIndexedAccess any) */}
              {(
                [
                  { label: "Fan", key: "showFan" },
                  { label: "Exp", key: "showExpiry" },
                  { label: "Roll", key: "showRoll" },
                  { label: "GEX", key: "showGex" },
                  { label: "Zero", key: "showZeroline" },
                ] as const
              ).map(({ label, key }) => {
                const active = toggles[key];
                return (
                  <button
                    key={label}
                    onClick={() => setToggles((prev) => ({ ...prev, [key]: !prev[key] }))}
                    style={{
                      background: active ? "#141c2c" : "none",
                      border: `1px solid ${active ? "#27313f" : "#1b2433"}`,
                      borderRadius: 3,
                      color: active ? "#c4cdd9" : "#566273",
                      cursor: "pointer",
                      fontSize: 9,
                      padding: "2px 6px",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
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
            rollCurve={rollResult ?? null}
            gex={gexQuery.data ?? null}
            spot={params.spot}
            toggles={toggles}
            fitY={fitY && !fitYConsumed}
            onFitYConsumed={() => setFitYConsumed(true)}
            positionSetSignature={positionSetSignature}
            baseExpirationCurve={scenarioResult?.expirationCurve ?? []}
          />
        </Card>

        <Card>
          <div style={{ marginBottom: 8 }}>
            <SectionLabel text="Book greeks" />
          </div>
          <GreekStrips data={greekStripData} panelWidth={180} panelHeight={80} />
        </Card>

        <Card>
          <PnlHeatmap positions={includedPositions} params={params} />
        </Card>
      </div>

      {/* ── Right column ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* What's-moving */}
        <Card>
          <div style={{ marginBottom: 8 }}>
            <SectionLabel text="What's moving" />
          </div>
          {gexQuery.data !== null && gexQuery.data !== undefined ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            <p style={{ fontSize: 10, color: "#566273", fontFamily: "JetBrains Mono, monospace", margin: 0 }}>
              {gexQuery.isLoading ? "Loading GEX…" : "GEX unavailable"}
            </p>
          )}
        </Card>

        <BookGreeksTable
          delta={bookGreeks.delta}
          gamma={bookGreeks.gamma}
          theta={bookGreeks.theta}
          vega={bookGreeks.vega}
        />

        <Card>
          <div style={{ marginBottom: 8 }}>
            <SectionLabel text="Attribution" />
          </div>
          <AttributionWaterfall variant="analyzer" data={waterfallData} trackHeight={12} />
        </Card>
      </div>
    </div>
  );
}
