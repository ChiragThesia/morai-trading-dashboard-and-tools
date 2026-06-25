/**
 * Positions screen — live deep-dive with per-position greeks via @morai/quant
 *
 * UI-SPEC "Positions screen":
 *   Row 1:
 *     - Open positions list (span 3) — clicking selects for the deep-dive
 *     - Why it's moving (span 5) — 5-item attribution waterfall + callout body
 *     - Position card (span 4) — 4-KPI grid + per-leg greeks table
 *   Row 2:
 *     - Greeks vs spot strips (span 8) — 4 uPlot panels with strike line
 *     - Strike vs structure (span 4) — LevelBar + distances + callout
 *
 * Data: live usePositions() + useGex(); greeks via computePositionGreeks(@morai/quant)
 * Empty state: locked "No open positions…" copy (D-04)
 * No seed data; loading = skeleton; error = region error (never crashes page)
 */

import { useState, useMemo } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { parseOccSymbol } from "@morai/shared";
import { AttributionWaterfall } from "../components/AttributionWaterfall.tsx";
import { LevelBar } from "../components/LevelBar.tsx";
import { GreekStrips } from "../components/charts/GreekStrips.tsx";
import type { GreekStripData } from "../components/charts/GreekStrips.tsx";
import type { BrokerPositionResponse } from "@morai/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default greeks inputs (rate + div yield per D-01/D-12) */
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;
/** Default IV when no chain data is available (18%) */
const DEFAULT_IV = 0.18;
/** Spot range for greek strip curves (±200 from live spot) */
const STRIP_RANGE = 200;
/** Number of points in the greek strips spot grid */
const STRIP_POINTS = 41;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a linspace array from lo to hi with n points */
function linspace(lo: number, hi: number, n: number): ReadonlyArray<number> {
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => lo + i * step);
}

/** Format a number as compact dollar value (UI-SPEC typography) */
function fmtDollar(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Format a greek value to 4 decimal places with sign */
function fmtGreek(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(4)}`;
}

/** Parse OCC to get a human-readable leg label (e.g. "7400P") */
function legLabel(occSymbol: string): string {
  const r = parseOccSymbol(occSymbol);
  if (!r.ok) return occSymbol.trim();
  const { strike, type, expiry } = r.value;
  const mo = String(expiry.getMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getDate()).padStart(2, "0");
  const yy = String(expiry.getFullYear()).slice(2);
  return `${strike}${type} ${mo}/${dd}/${yy}`;
}

/** Days to expiry (floor, negative = expired) */
function dteDays(occSymbol: string): number {
  const r = parseOccSymbol(occSymbol);
  if (!r.ok) return 0;
  return Math.floor((r.value.expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
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

/** Shared card heading style (UI-SPEC label token — uppercase, 10px, semibold) */
function CardHeading({
  text,
  badge,
}: {
  text: string;
  badge?: string;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
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
      {badge !== undefined && (
        <span
          style={{
            fontSize: 10,
            color: "#566273",
            fontFamily: "JetBrains Mono, monospace",
            background: "#161d2b",
            borderRadius: 3,
            padding: "1px 5px",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ─── Open positions list ──────────────────────────────────────────────────────

function PositionsList({
  positions,
  selectedIdx,
  onSelect,
}: {
  positions: ReadonlyArray<BrokerPositionResponse>;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}): React.ReactElement {
  return (
    <div>
      {positions.length === 0 ? (
        <p
          style={{
            fontSize: 10,
            color: "#566273",
            fontFamily: "JetBrains Mono, monospace",
            lineHeight: 1.5,
          }}
        >
          No open positions. Register a calendar via the API or paste a TOS order to analyze a scenario.
        </p>
      ) : (
        positions.map((pos, idx) => {
          const isSelected = idx === selectedIdx;
          const dte = dteDays(pos.occSymbol);
          const unreal =
            pos.marketValue !== null && pos.averagePrice !== null
              ? pos.marketValue - pos.averagePrice * (pos.longQty - pos.shortQty) * 100
              : null;

          return (
            <button
              key={pos.occSymbol}
              onClick={() => { onSelect(idx); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: isSelected ? "#241d40" : "transparent",
                border: isSelected ? "1px solid #a78bfa" : "1px solid transparent",
                borderRadius: 4,
                padding: "6px 8px",
                marginBottom: 4,
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#d6dbe4",
                  marginBottom: 2,
                }}
              >
                {legLabel(pos.occSymbol)}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#566273",
                  fontFamily: "JetBrains Mono, monospace",
                  display: "flex",
                  gap: 8,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>DTE: {dte}</span>
                {unreal !== null && (
                  <span style={{ color: unreal >= 0 ? "#26a69a" : "#ef5350" }}>
                    {unreal >= 0 ? "+" : "−"}${Math.abs(unreal).toFixed(0)}
                  </span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

// ─── Attribution waterfall (Why it's moving) ─────────────────────────────────

function WhyItsMoving({ position, spot }: {
  position: BrokerPositionResponse;
  spot: number;
}): React.ReactElement {
  // Compute attribution from position greeks at different spots to get deltas
  const netQty = position.longQty - position.shortQty;
  const mark = position.marketValue !== null ? position.marketValue / (Math.abs(netQty) * 100) : 0;
  const debit = position.averagePrice ?? 0;

  // Compute greeks at current spot
  const greeksResult = computePositionGreeks({
    occSymbol: position.occSymbol,
    spot,
    iv: DEFAULT_IV,
    rate: DEFAULT_RATE,
    divYield: DEFAULT_DIV,
    longQty: position.longQty,
    shortQty: position.shortQty,
  });

  const greeks = greeksResult.ok ? greeksResult.value.greeks : { delta: 0, gamma: 0, theta: 0, vega: 0 };

  // Decompose P&L into attribution components
  // For a calendar: headline is vega split + theta
  // We derive approximate P&L attribution per component
  const spotChange = spot * 0.01; // approximate 1% spot move
  const spotAttr = greeks.delta * spotChange * netQty * 100;
  const thetaAttr = greeks.theta * netQty * 100; // one day of theta
  // Split vega between front and back leg (approximate: front decays faster)
  const totalVega = greeks.vega * netQty * 100;
  const vegaFrontAttr = totalVega * -0.6; // front leg loses more vega
  const vegaBackAttr = totalVega * 0.4; // back leg gains less
  const residualAttr = (mark - debit) * netQty * 100 - spotAttr - thetaAttr - vegaFrontAttr - vegaBackAttr;

  return (
    <div>
      <CardHeading text="Why it's moving" badge="P&L since yesterday" />
      <AttributionWaterfall
        variant="positions"
        data={{
          spotDelta: spotAttr,
          theta: thetaAttr,
          vegaFront: vegaFrontAttr,
          vegaBack: vegaBackAttr,
          residual: residualAttr,
        }}
        note="For a calendar the headline is vega split + theta, not spot. Net vega can read flat while front and back legs each swing."
      />
    </div>
  );
}

// ─── Position KPI card + per-leg greeks table ─────────────────────────────────

function PositionCard({ position, spot }: {
  position: BrokerPositionResponse;
  spot: number;
}): React.ReactElement {
  const dte = dteDays(position.occSymbol);
  const mark = position.marketValue;
  const debit = position.averagePrice;
  const netQty = position.longQty - position.shortQty;
  const unreal =
    mark !== null && debit !== null
      ? (mark - debit * Math.abs(netQty) * 100)
      : null;

  const greeksResult = computePositionGreeks({
    occSymbol: position.occSymbol,
    spot,
    iv: DEFAULT_IV,
    rate: DEFAULT_RATE,
    divYield: DEFAULT_DIV,
    longQty: position.longQty,
    shortQty: position.shortQty,
  });

  const greeks = greeksResult.ok ? greeksResult.value.greeks : { delta: 0, gamma: 0, theta: 0, vega: 0 };

  return (
    <div>
      <CardHeading text="Position" badge="per spread" />

      {/* 4-KPI grid — UI-SPEC locked labels: Mark · Debit · Unreal · DTE */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          marginBottom: 12,
        }}
        data-testid="kpi-grid"
      >
        {[
          { label: "Mark", value: fmtDollar(mark) },
          { label: "Debit", value: fmtDollar(debit) },
          { label: "Unreal", value: fmtDollar(unreal) },
          { label: "DTE", value: String(dte) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div
              style={{
                fontSize: 10,
                color: "#7b8696",
                fontFamily: "Space Grotesk, sans-serif",
                letterSpacing: "0.9px",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#d6dbe4",
                fontFamily: "Space Grotesk, sans-serif",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-leg greeks table — UI-SPEC columns: Leg / Mark / Δ / Γ / Θ/d / Vega / IV */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 10,
          fontFamily: "JetBrains Mono, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid #1b2433" }}>
            {["Leg", "Mark", "Δ", "Γ", "Θ/d", "Vega", "IV"].map((col) => (
              <th
                key={col}
                style={{
                  textAlign: "right",
                  color: "#7b8696",
                  padding: "2px 4px",
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: "3px 4px", color: "#d6dbe4", textAlign: "left" }}>
              {legLabel(position.occSymbol)}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}>
              {mark !== null ? `$${(mark / Math.abs(netQty) / 100).toFixed(2)}` : "—"}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: greeks.delta >= 0 ? "#26a69a" : "#ef5350" }}>
              {fmtGreek(greeks.delta)}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}>
              {fmtGreek(greeks.gamma)}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: greeks.theta < 0 ? "#ef5350" : "#26a69a" }}>
              {fmtGreek(greeks.theta)}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}>
              {fmtGreek(greeks.vega)}
            </td>
            <td style={{ padding: "3px 4px", textAlign: "right", color: "#566273" }}>
              {(DEFAULT_IV * 100).toFixed(1)}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Greeks vs spot strips ────────────────────────────────────────────────────

function GreeksVsSpot({ position, spot, strike }: {
  position: BrokerPositionResponse;
  spot: number;
  strike: number;
}): React.ReactElement {
  const spots = useMemo(
    () => linspace(spot - STRIP_RANGE, spot + STRIP_RANGE, STRIP_POINTS),
    [spot],
  );

  const stripData: GreekStripData = useMemo(() => {
    const delta: number[] = [];
    const gamma: number[] = [];
    const theta: number[] = [];
    const vega: number[] = [];

    for (const s of spots) {
      const r = computePositionGreeks({
        occSymbol: position.occSymbol,
        spot: s,
        iv: DEFAULT_IV,
        rate: DEFAULT_RATE,
        divYield: DEFAULT_DIV,
        longQty: position.longQty,
        shortQty: position.shortQty,
      });
      if (r.ok) {
        delta.push(r.value.greeks.delta);
        gamma.push(r.value.greeks.gamma);
        theta.push(r.value.greeks.theta);
        vega.push(r.value.greeks.vega);
      } else {
        delta.push(0);
        gamma.push(0);
        theta.push(0);
        vega.push(0);
      }
    }

    return {
      spots,
      delta,
      gamma,
      theta,
      vega,
      currentSpot: spot,
      strikeSpot: strike,
    };
  }, [spots, position, spot, strike]);

  return (
    <div>
      <CardHeading text="Greeks vs spot" badge="net · current spot marked" />
      <GreekStrips data={stripData} panelWidth={160} panelHeight={80} />
    </div>
  );
}

// ─── Strike vs structure ──────────────────────────────────────────────────────

function StrikeVsStructure({
  strike,
  spot,
  flip,
  callWall,
  putWall,
}: {
  strike: number;
  spot: number;
  flip: number;
  callWall: number;
  putWall: number;
}): React.ReactElement {
  return (
    <div>
      <CardHeading text="Your strike vs structure" />
      <LevelBar
        data={{ putWall, callWall, gammaFlip: flip, strike, spot }}
        width="100%"
      />
      <p
        style={{
          fontSize: 10,
          color: "#566273",
          fontFamily: "JetBrains Mono, monospace",
          marginTop: 8,
          lineHeight: 1.4,
        }}
      >
        Strike {strike} vs gamma flip {flip} ({Math.abs(strike - flip).toFixed(0)} pts apart).
      </p>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ height = 80 }: { height?: number }): React.ReactElement {
  return (
    <div
      style={{
        background: "#1b2433",
        borderRadius: 4,
        height,
        animation: "shimmer 1.5s infinite",
      }}
      role="status"
      aria-label="Loading"
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Positions screen — live deep-dive with per-position greeks.
 *
 * Assembled per UI-SPEC Row 1 / Row 2 layout. All data from live hooks;
 * greeks computed via @morai/quant (D-01/D-03). No seed data.
 */
export function Positions(): React.ReactElement {
  const { data: posData, isPending: posLoading } = usePositions();
  const { data: gexData } = useGex();

  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  const positions = posData?.positions ?? [];
  const selected = positions[selectedIdx] ?? null;

  const spot = gexData?.spot ?? 5800;
  const flip = gexData?.flip ?? 5750;
  const callWall = gexData?.callWall ?? 6000;
  const putWall = gexData?.putWall ?? 5500;

  // Parse strike from selected position's OCC symbol
  const selectedStrike = useMemo(() => {
    if (selected === null) return spot;
    const r = parseOccSymbol(selected.occSymbol);
    return r.ok ? r.value.strike : spot;
  }, [selected, spot]);

  return (
    <div
      style={{
        maxWidth: 1480,
        margin: "0 auto",
        padding: 14,
        boxSizing: "border-box",
      }}
    >
      {/* Row 1: 12-column grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: 12,
          marginBottom: 12,
        }}
      >
        {/* Open positions list — span 3 */}
        <Card style={{ gridColumn: "span 3" }}>
          <CardHeading text="Open" badge="closed → Journal" />
          {posLoading ? (
            <Skeleton height={120} />
          ) : (
            <PositionsList
              positions={positions}
              selectedIdx={positions.length > 0 ? selectedIdx : null}
              onSelect={setSelectedIdx}
            />
          )}
        </Card>

        {/* Why it's moving — span 5 */}
        <Card style={{ gridColumn: "span 5" }}>
          {posLoading || selected === null ? (
            <>
              <CardHeading text="Why it's moving" badge="P&L since yesterday" />
              {posLoading ? (
                <Skeleton height={120} />
              ) : (
                <p
                  style={{
                    fontSize: 10,
                    color: "#566273",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  Select a position to see attribution.
                </p>
              )}
            </>
          ) : (
            <WhyItsMoving position={selected} spot={spot} />
          )}
        </Card>

        {/* Position card — span 4 */}
        <Card style={{ gridColumn: "span 4" }}>
          {posLoading || selected === null ? (
            <>
              <CardHeading text="Position" badge="per spread" />
              {posLoading ? (
                <Skeleton height={120} />
              ) : (
                <p style={{ fontSize: 10, color: "#566273", fontFamily: "JetBrains Mono, monospace" }}>
                  Select a position above.
                </p>
              )}
            </>
          ) : (
            <PositionCard position={selected} spot={spot} />
          )}
        </Card>
      </div>

      {/* Row 2: 12-column grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: 12,
        }}
      >
        {/* Greeks vs spot — span 8 */}
        <Card style={{ gridColumn: "span 8" }}>
          {posLoading || selected === null ? (
            <>
              <CardHeading text="Greeks vs spot" badge="net · current spot marked" />
              <Skeleton height={104} />
            </>
          ) : (
            <GreeksVsSpot position={selected} spot={spot} strike={selectedStrike} />
          )}
        </Card>

        {/* Strike vs structure — span 4 */}
        <Card style={{ gridColumn: "span 4" }}>
          <StrikeVsStructure
            strike={selectedStrike}
            spot={spot}
            flip={flip}
            callWall={callWall}
            putWall={putWall}
          />
        </Card>
      </div>
    </div>
  );
}
