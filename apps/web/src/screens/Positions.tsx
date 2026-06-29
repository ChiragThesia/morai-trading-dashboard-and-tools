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
 * Phase 12 extensions (D-04/D-05/D-06, UI-SPEC Surfaces 1/2/3/4):
 *   - useLiveStream() overlay on per-leg greeks table + KPI cells (Surface 1)
 *   - Stale-data dimming via .live-cell.stale (color, NOT opacity) (Surface 2)
 *   - LiveStatusBadge in Position CardHeading (Surface 3)
 *   - AdHocPicker: OCC input + AD HOC row + live greeks from stream (Surface 4)
 *   - D-06 constraint: live data ONLY on this screen — not wired to journal or GEX
 *
 * Data: live usePositions() (polling, stays as fallback/metadata) + useGex() + useLiveStream()
 * Empty state: locked "No open positions…" copy (D-04)
 */

import { useState, useMemo } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { AttributionWaterfall } from "../components/AttributionWaterfall.tsx";
import { LevelBar } from "../components/LevelBar.tsx";
import { GreekStrips } from "../components/charts/GreekStrips.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import type { GreekStripData } from "../components/charts/GreekStrips.tsx";
import type { BrokerPositionResponse } from "@morai/contracts";
import type { StreamLiveGreekEvent } from "@morai/contracts";

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
  // Pair raw legs into calendar spreads (short front / long back, same underlying+strike+type).
  // The list shows ONE row per calendar — not one row per leg. Orphan legs fall through to singles.
  const now = useMemo(() => new Date(), []);
  const { calendars, singles } = useMemo(
    () => pairPositionsIntoCalendars(positions, now),
    [positions, now],
  );
  const idxOf = (occSymbol: string): number =>
    positions.findIndex((p) => p.occSymbol === occSymbol);

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
        <>
          {calendars.map((cal) => {
            const frontIdx = idxOf(cal.front.occSymbol);
            const backIdx = idxOf(cal.back.occSymbol);
            const isSelected = selectedIdx === frontIdx || selectedIdx === backIdx;
            return (
              <button
                key={cal.key}
                onClick={() => { onSelect(backIdx >= 0 ? backIdx : frontIdx); }}
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
                <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#d6dbe4", marginBottom: 2 }}>
                  {cal.strike}{cal.optionType} calendar
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
                  <span>DTE {cal.dteFront}→{cal.dteBack}</span>
                  {cal.netUnreal !== null && (
                    <span style={{ color: cal.netUnreal >= 0 ? "#26a69a" : "#ef5350" }}>
                      {cal.netUnreal >= 0 ? "+" : "−"}${Math.abs(cal.netUnreal).toFixed(0)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#3f4a5a", fontFamily: "JetBrains Mono, monospace", marginTop: 1 }}>
                  {legLabel(cal.front.occSymbol)} / {legLabel(cal.back.occSymbol)}
                </div>
              </button>
            );
          })}
          {singles.map((pos) => {
            const idx = idxOf(pos.occSymbol);
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
                <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#d6dbe4", marginBottom: 2 }}>
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
          })}
        </>
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
  const spotChange = spot * 0.01;
  const spotAttr = greeks.delta * spotChange * netQty * 100;
  const thetaAttr = greeks.theta * netQty * 100;
  const totalVega = greeks.vega * netQty * 100;
  const vegaFrontAttr = totalVega * -0.6;
  const vegaBackAttr = totalVega * 0.4;
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

// ─── Ad-hoc picker (Surface 4) ────────────────────────────────────────────────

/**
 * AdHocPicker — input + AD HOC row for streaming live greeks for any OCC symbol.
 *
 * Validates via parseOccSymbol before any POST (Surface 4 client-side gate, T-12-06-02).
 * On valid submit: calls subscribeAdHoc (POST /api/stream/subscribe — not a no-op, SC6).
 * The AD HOC row renders live BSM values from liveGreeks once ticks arrive (D-05).
 * Only one ad-hoc symbol active at a time; × clears it.
 */
function AdHocPicker({
  subscribeAdHoc,
  liveGreeks,
  liveStatus,
  adHocSymbol,
  onSetAdHocSymbol,
  onClearAdHoc,
}: {
  subscribeAdHoc: (symbol: string) => Promise<void>;
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  liveStatus: LiveStreamStatus;
  adHocSymbol: string | null;
  onSetAdHocSymbol: (sym: string) => void;
  onClearAdHoc: () => void;
}): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clearHovered, setClearHovered] = useState(false);

  const isStale = liveStatus === "stale" || liveStatus === "reconnecting";

  // Live tick for the subscribed ad-hoc symbol (undefined until first tick arrives)
  const adHocTick = adHocSymbol !== null ? liveGreeks.get(adHocSymbol) : undefined;
  // Key changes each tick → React key trick → re-triggers .live-cell-flash animation
  const adHocTickKey = adHocTick?.ts ?? "";

  const handleSubmit = async (): Promise<void> => {
    const trimmed = inputValue.trim();
    if (trimmed === "") return;

    // Client-side OCC format validation (T-12-06-02 — server re-validates authoritatively)
    const parsed = parseOccSymbol(trimmed);
    if (!parsed.ok) {
      setValidationError(
        "Invalid OCC format — use 21-char Schwab format (e.g. SPX   260620C05000000)",
      );
      return;
    }

    setValidationError(null);
    setSubscribeError(null);
    setIsSubmitting(true);

    try {
      // POST /api/stream/subscribe (SC6 — NOT a no-op; ticks arrive over existing EventSource)
      await subscribeAdHoc(trimmed);
      onSetAdHocSymbol(trimmed);
    } catch {
      // subscribeAdHoc throws StreamSubscribeError on non-2xx
      setSubscribeError("Stream unavailable. Check server status.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = (): void => {
    setInputValue("");
    setValidationError(null);
    setSubscribeError(null);
    onClearAdHoc();
  };

  return (
    <div>
      <CardHeading text="Ad-hoc lookup" />

      {/* Input row: OCC text field + "Stream Greeks" submit button */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Input
            value={inputValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setInputValue(e.target.value);
              setValidationError(null);
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") { void handleSubmit(); }
            }}
            placeholder="SPX   260620C05000000"
            style={{ paddingRight: inputValue.length > 0 ? 32 : undefined }}
          />
          {inputValue.length > 0 && (
            <button
              onClick={handleClear}
              aria-label="Clear ad-hoc symbol"
              onMouseEnter={() => { setClearHovered(true); }}
              onMouseLeave={() => { setClearHovered(false); }}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: clearHovered ? "#d6dbe4" : "#7b8696", // --color-txt on hover, --color-muted at rest
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
                minHeight: 44,
                minWidth: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { void handleSubmit(); }}
          disabled={isSubmitting}
          style={{ minHeight: 44, alignSelf: "flex-start" }}
        >
          Stream Greeks
        </Button>
      </div>

      {/* Validation error (Surface 4 — --color-down, 12px mono, no red border on input) */}
      {validationError !== null && (
        <p
          style={{
            fontSize: 12,
            color: "#ef5350", // --color-down
            fontFamily: "JetBrains Mono, monospace",
            margin: "2px 0 6px",
            lineHeight: 1.4,
          }}
        >
          {validationError}
        </p>
      )}

      {/* Subscribe error */}
      {subscribeError !== null && (
        <p
          style={{
            fontSize: 12,
            color: "#ef5350", // --color-down
            fontFamily: "JetBrains Mono, monospace",
            margin: "2px 0 6px",
            lineHeight: 1.4,
          }}
        >
          {subscribeError}
        </p>
      )}

      {/* Empty state — no ad-hoc symbol active, no error */}
      {adHocSymbol === null && validationError === null && subscribeError === null && (
        <p
          style={{
            fontSize: 10,
            color: "#566273", // --color-dim
            fontFamily: "JetBrains Mono, monospace",
            margin: 0,
          }}
        >
          Enter any OCC symbol to stream live greeks.
        </p>
      )}

      {/* AD HOC row — distinct from owned positions (Surface 4) */}
      {adHocSymbol !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            borderRadius: 4,
            padding: "6px 8px",
            marginTop: 4,
            background: "transparent",
            border: "1px solid transparent",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Leg label */}
            <div
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "#d6dbe4",
                marginBottom: 2,
              }}
            >
              {legLabel(adHocSymbol)}
            </div>

            {/* DTE only — no P&L (no position basis for ad-hoc) */}
            <div
              style={{
                fontSize: 10,
                color: "#566273", // --color-dim
                fontFamily: "JetBrains Mono, monospace",
                marginBottom: 2,
              }}
            >
              DTE: {dteDays(adHocSymbol)}
            </div>

            {/* Live BSM values from stream — key changes each tick → .live-cell-flash re-triggers */}
            {adHocTick !== undefined ? (
              <div
                key={`adhoc-vals-${adHocTickKey}`}
                className={`live-cell-flash live-cell${isStale ? " stale" : ""}`}
                style={{
                  fontSize: 10,
                  fontFamily: "JetBrains Mono, monospace",
                  fontVariantNumeric: "tabular-nums",
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: adHocTick.bsmDelta >= 0 ? "#26a69a" : "#ef5350" }}>
                  Δ {fmtGreek(adHocTick.bsmDelta)}
                </span>
                <span style={{ color: "#d6dbe4" }}>
                  IV {(adHocTick.bsmIv * 100).toFixed(1)}%
                </span>
                <span style={{ color: "#d6dbe4" }}>
                  ${adHocTick.mark.toFixed(2)}
                </span>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 10,
                  color: "#566273", // --color-dim
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                Waiting for stream data…
              </div>
            )}
          </div>

          {/* AD HOC badge — visually distinct from owned positions (Surface 4) */}
          <span
            style={{
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
              textTransform: "uppercase",
              background: "#161d2b", // --color-raise
              color: "#566273", // --color-dim
              border: "1px solid #1b2433", // --color-line
              borderRadius: 3,
              padding: "1px 5px",
              flexShrink: 0,
              marginLeft: 8,
              marginTop: 2,
            }}
          >
            AD HOC
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Position KPI card + per-leg greeks table ─────────────────────────────────

/**
 * PositionCard — per-position KPI grid + per-leg greeks table with live overlay.
 *
 * Phase 12 extensions (UI-SPEC Surfaces 1/2/3):
 *   - Live greeks from useLiveStream overlay the per-leg table + Mark/Unreal KPIs.
 *   - .live-cell + .live-cell.stale applied to live-sourced cells (color dim on stale).
 *   - .live-cell-flash triggered via React key trick (key changes each tick).
 *   - Heading badge replaced with LiveStatusBadge (Surface 3).
 *   - Polling values (from usePositions) remain as metadata + fallback.
 */
function PositionCard({
  position,
  spot,
  liveGreeks,
  liveStatus,
  liveLastTickAt,
}: {
  position: BrokerPositionResponse;
  spot: number;
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  liveStatus: LiveStreamStatus;
  liveLastTickAt: Date | null;
}): React.ReactElement {
  const dte = dteDays(position.occSymbol);
  const mark = position.marketValue;
  const debit = position.averagePrice;
  const netQty = position.longQty - position.shortQty;
  const unreal =
    mark !== null && debit !== null
      ? (mark - debit * Math.abs(netQty) * 100)
      : null;

  // Static BSM greeks (fallback when no live tick)
  const greeksResult = computePositionGreeks({
    occSymbol: position.occSymbol,
    spot,
    iv: DEFAULT_IV,
    rate: DEFAULT_RATE,
    divYield: DEFAULT_DIV,
    longQty: position.longQty,
    shortQty: position.shortQty,
  });
  const staticGreeks = greeksResult.ok
    ? greeksResult.value.greeks
    : { delta: 0, gamma: 0, theta: 0, vega: 0 };

  // Live tick for this position's OCC symbol (undefined → fall back to polling values)
  const tick = liveGreeks.get(position.occSymbol);
  // Key changes on each tick ts → re-triggers .live-cell-flash CSS animation (React key trick)
  const tickKey = tick?.ts ?? "";
  const isStale = liveStatus === "stale" || liveStatus === "reconnecting";
  // CSS class applied to live-sourced table cells (Surface 2 stale dimming — color NOT opacity)
  const liveCellClass = tick !== undefined
    ? `live-cell${isStale ? " stale" : ""}`
    : "";

  // Live greeks (fallback to static BSM if no tick)
  const liveDelta = tick?.bsmDelta ?? staticGreeks.delta;
  const liveGamma = tick?.bsmGamma ?? staticGreeks.gamma;
  const liveTheta = tick?.bsmTheta ?? staticGreeks.theta;
  const liveVega = tick?.bsmVega ?? staticGreeks.vega;
  const liveIv = tick !== undefined ? tick.bsmIv : DEFAULT_IV;

  // KPI values: prefer live mark/unreal when tick is present
  const displayMark = tick !== undefined
    ? `$${tick.mark.toFixed(2)}`
    : fmtDollar(mark !== null ? mark / Math.abs(netQty) / 100 : null);
  const liveUnreal = tick !== undefined && debit !== null
    ? (tick.mark - debit) * Math.abs(netQty) * 100
    : unreal;
  const displayUnreal = fmtDollar(liveUnreal);

  return (
    <div>
      {/* Position heading — LiveStatusBadge replaces static "per spread" badge (Surface 3) */}
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
          Position
        </span>
        <LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />
      </div>

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
        {/* Mark KPI — live mark when tick present, else polling value */}
        <div>
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
            Mark
          </div>
          <div
            key={`kpi-mark-${tickKey}`}
            className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#d6dbe4",
              fontFamily: "Space Grotesk, sans-serif",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {displayMark}
          </div>
        </div>

        {/* Debit — position cost basis, always from polling (no live source) */}
        <div>
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
            Debit
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
            {fmtDollar(debit)}
          </div>
        </div>

        {/* Unreal — live-computed when tick present, else polling */}
        <div>
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
            Unreal
          </div>
          <div
            key={`kpi-unreal-${tickKey}`}
            className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#d6dbe4",
              fontFamily: "Space Grotesk, sans-serif",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {displayUnreal}
          </div>
        </div>

        {/* DTE — from OCC symbol, static */}
        <div>
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
            DTE
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
            {String(dte)}
          </div>
        </div>
      </div>

      {/* Per-leg greeks table — UI-SPEC columns: Leg / Mark / Δ / Γ / Θ/d / Vega / IV
          Live cells: key changes per tick → .live-cell-flash animation re-triggers.
          Stale cells: .live-cell.stale → color transitions to --color-dim (Surface 2). */}
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
            {/* Leg label — static, not live */}
            <td style={{ padding: "3px 4px", color: "#d6dbe4", textAlign: "left" }}>
              {legLabel(position.occSymbol)}
            </td>

            {/* Mark — live mark if tick present, else static */}
            <td
              key={`td-mark-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}
            >
              {tick !== undefined
                ? `$${tick.mark.toFixed(2)}`
                : (mark !== null ? `$${(mark / Math.abs(netQty) / 100).toFixed(2)}` : "—")}
            </td>

            {/* Δ — live bsmDelta if tick present, else static */}
            <td
              key={`td-delta-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{
                padding: "3px 4px",
                textAlign: "right",
                color: liveDelta >= 0 ? "#26a69a" : "#ef5350",
              }}
            >
              {fmtGreek(liveDelta)}
            </td>

            {/* Γ — live bsmGamma if tick present, else static */}
            <td
              key={`td-gamma-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}
            >
              {fmtGreek(liveGamma)}
            </td>

            {/* Θ/d — live bsmTheta if tick present, else static */}
            <td
              key={`td-theta-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{
                padding: "3px 4px",
                textAlign: "right",
                color: liveTheta < 0 ? "#ef5350" : "#26a69a",
              }}
            >
              {fmtGreek(liveTheta)}
            </td>

            {/* Vega — live bsmVega if tick present, else static */}
            <td
              key={`td-vega-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{ padding: "3px 4px", textAlign: "right", color: "#d6dbe4" }}
            >
              {fmtGreek(liveVega)}
            </td>

            {/* IV — live bsmIv if tick present, else DEFAULT_IV */}
            <td
              key={`td-iv-${tickKey}`}
              className={tick !== undefined ? `live-cell-flash ${liveCellClass}` : undefined}
              style={{ padding: "3px 4px", textAlign: "right", color: "#566273" }}
            >
              {(liveIv * 100).toFixed(1)}%
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
 * Phase 12: extends base screen with SSE live-greeks overlay (D-06 — this screen only).
 * usePositions() remains the fallback + position metadata source (qty, marketValue, debit).
 * useLiveStream() provides live BSM greeks, status machine, and the subscribeAdHoc callback.
 */
export function Positions(): React.ReactElement {
  const { data: posData, isPending: posLoading } = usePositions();
  const { data: gexData } = useGex();

  // Phase 12: live stream hook (D-06 — Positions screen only; NOT wired to journal or GEX)
  const {
    greeks: liveGreeks,
    status: liveStatus,
    lastTickAt: liveLastTickAt,
    subscribeAdHoc,
  } = useLiveStream();

  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  // Phase 12 D-05: single active ad-hoc OCC symbol (null = none active)
  const [adHocSymbol, setAdHocSymbol] = useState<string | null>(null);

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

          {/* Phase 12 Surface 4 — Ad-hoc picker below a separator */}
          <Separator style={{ margin: "8px 0", borderColor: "#1b2433" }} />
          <AdHocPicker
            subscribeAdHoc={subscribeAdHoc}
            liveGreeks={liveGreeks}
            liveStatus={liveStatus}
            adHocSymbol={adHocSymbol}
            onSetAdHocSymbol={(sym) => { setAdHocSymbol(sym); }}
            onClearAdHoc={() => { setAdHocSymbol(null); }}
          />
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
              {/* Phase 12 Surface 3: LiveStatusBadge even in loading/empty state */}
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
                  Position
                </span>
                <LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />
              </div>
              {posLoading ? (
                <Skeleton height={120} />
              ) : (
                <p style={{ fontSize: 10, color: "#566273", fontFamily: "JetBrains Mono, monospace" }}>
                  Select a position above.
                </p>
              )}
            </>
          ) : (
            // Phase 12: PositionCard receives live data for overlay (Surface 1/2/3)
            <PositionCard
              position={selected}
              spot={spot}
              liveGreeks={liveGreeks}
              liveStatus={liveStatus}
              liveLastTickAt={liveLastTickAt}
            />
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
