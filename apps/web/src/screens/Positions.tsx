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
import { Panel, PanelHeading, SectionLabel } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";
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

// ─── Card heading ───────────────────────────────────────────────────────────

/** Shared card heading (UI-SPEC label token — uppercase, 10px, semibold) + optional mono pill. */
function CardHeading({
  text,
  badge,
}: {
  text: string;
  badge?: string;
}): React.ReactElement {
  return (
    <PanelHeading
      title={text}
      badge={
        badge !== undefined ? (
          <span className="rounded-[3px] bg-raise px-[5px] py-px font-mono text-[10px] text-dim">
            {badge}
          </span>
        ) : undefined
      }
    />
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
        <p className="font-mono text-[10px] leading-normal text-dim">
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
                className={cn(
                  "mb-1 block w-full cursor-pointer rounded-[4px] border px-2 py-1.5 text-left",
                  isSelected
                    ? "border-violet bg-violetd"
                    : "border-transparent bg-transparent",
                )}
              >
                <div className="mb-0.5 font-mono text-[10px] text-txt">
                  {cal.strike}{cal.optionType} calendar
                </div>
                <div className="flex gap-2 font-mono text-[10px] text-dim tabular-nums">
                  <span>DTE {cal.dteFront}→{cal.dteBack}</span>
                  {cal.netUnreal !== null && (
                    <span className={cal.netUnreal >= 0 ? "text-up" : "text-down"}>
                      {cal.netUnreal >= 0 ? "+" : "−"}${Math.abs(cal.netUnreal).toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="mt-px font-mono text-[10px] text-faint">
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
                className={cn(
                  "mb-1 block w-full cursor-pointer rounded-[4px] border px-2 py-1.5 text-left",
                  isSelected
                    ? "border-violet bg-violetd"
                    : "border-transparent bg-transparent",
                )}
              >
                <div className="mb-0.5 font-mono text-[10px] text-txt">
                  {legLabel(pos.occSymbol)}
                </div>
                <div className="flex gap-2 font-mono text-[10px] text-dim tabular-nums">
                  <span>DTE: {dte}</span>
                  {unreal !== null && (
                    <span className={unreal >= 0 ? "text-up" : "text-down"}>
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
      <div className="mb-1.5 flex gap-1.5">
        <div className="relative flex-1">
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
            className={inputValue.length > 0 ? "pr-8" : undefined}
          />
          {inputValue.length > 0 && (
            <button
              onClick={handleClear}
              aria-label="Clear ad-hoc symbol"
              onMouseEnter={() => { setClearHovered(true); }}
              onMouseLeave={() => { setClearHovered(false); }}
              className={cn(
                "absolute top-1/2 right-1 flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-sm leading-none",
                clearHovered ? "text-txt" : "text-muted-foreground",
              )}
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
          className="min-h-11 self-start"
        >
          Stream Greeks
        </Button>
      </div>

      {/* Validation error (Surface 4 — --color-down, 12px mono, no red border on input) */}
      {validationError !== null && (
        <p className="mt-0.5 mb-1.5 font-mono text-xs leading-[1.4] text-down">
          {validationError}
        </p>
      )}

      {/* Subscribe error */}
      {subscribeError !== null && (
        <p className="mt-0.5 mb-1.5 font-mono text-xs leading-[1.4] text-down">
          {subscribeError}
        </p>
      )}

      {/* Empty state — no ad-hoc symbol active, no error */}
      {adHocSymbol === null && validationError === null && subscribeError === null && (
        <p className="m-0 font-mono text-[10px] text-dim">
          Enter any OCC symbol to stream live greeks.
        </p>
      )}

      {/* AD HOC row — distinct from owned positions (Surface 4) */}
      {adHocSymbol !== null && (
        <div className="mt-1 flex items-start justify-between rounded-[4px] border border-transparent bg-transparent px-2 py-1.5">
          <div className="min-w-0 flex-1">
            {/* Leg label */}
            <div className="mb-0.5 font-mono text-[10px] text-txt">
              {legLabel(adHocSymbol)}
            </div>

            {/* DTE only — no P&L (no position basis for ad-hoc) */}
            <div className="mb-0.5 font-mono text-[10px] text-dim">
              DTE: {dteDays(adHocSymbol)}
            </div>

            {/* Live BSM values from stream — key changes each tick → .live-cell-flash re-triggers */}
            {adHocTick !== undefined ? (
              <div
                key={`adhoc-vals-${adHocTickKey}`}
                className={cn(
                  "live-cell-flash live-cell flex flex-wrap gap-1.5 font-mono text-[10px] tabular-nums",
                  isStale && "stale",
                )}
              >
                <span className={adHocTick.bsmDelta >= 0 ? "text-up" : "text-down"}>
                  Δ {fmtGreek(adHocTick.bsmDelta)}
                </span>
                <span className="text-txt">
                  IV {(adHocTick.bsmIv * 100).toFixed(1)}%
                </span>
                <span className="text-txt">
                  ${adHocTick.mark.toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="font-mono text-[10px] text-dim">
                Waiting for stream data…
              </div>
            )}
          </div>

          {/* AD HOC badge — visually distinct from owned positions (Surface 4) */}
          <span className="mt-0.5 ml-2 shrink-0 rounded-[3px] border border-line bg-raise px-[5px] py-px font-mono text-[10px] text-dim uppercase">
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
      <PanelHeading
        title="Position"
        badge={<LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />}
      />

      {/* 4-KPI grid — UI-SPEC locked labels: Mark · Debit · Unreal · DTE */}
      <div className="mb-3 grid grid-cols-4 gap-1.5" data-testid="kpi-grid">
        {/* Mark KPI — live mark when tick present, else polling value */}
        <div>
          <SectionLabel className="mb-0.5">Mark</SectionLabel>
          <div
            key={`kpi-mark-${tickKey}`}
            className={cn(
              "font-display text-sm font-bold text-txt tabular-nums",
              tick !== undefined && `live-cell-flash ${liveCellClass}`,
            )}
          >
            {displayMark}
          </div>
        </div>

        {/* Debit — position cost basis, always from polling (no live source) */}
        <div>
          <SectionLabel className="mb-0.5">Debit</SectionLabel>
          <div className="font-display text-sm font-bold text-txt tabular-nums">
            {fmtDollar(debit)}
          </div>
        </div>

        {/* Unreal — live-computed when tick present, else polling */}
        <div>
          <SectionLabel className="mb-0.5">Unreal</SectionLabel>
          <div
            key={`kpi-unreal-${tickKey}`}
            className={cn(
              "font-display text-sm font-bold text-txt tabular-nums",
              tick !== undefined && `live-cell-flash ${liveCellClass}`,
            )}
          >
            {displayUnreal}
          </div>
        </div>

        {/* DTE — from OCC symbol, static */}
        <div>
          <SectionLabel className="mb-0.5">DTE</SectionLabel>
          <div className="font-display text-sm font-bold text-txt tabular-nums">
            {String(dte)}
          </div>
        </div>
      </div>

      {/* Per-leg greeks table — UI-SPEC columns: Leg / Mark / Δ / Γ / Θ/d / Vega / IV
          Live cells: key changes per tick → .live-cell-flash animation re-triggers.
          Stale cells: .live-cell.stale → color transitions to --color-dim (Surface 2). */}
      <table className="w-full border-collapse font-mono text-[10px] tabular-nums">
        <thead>
          <tr className="border-b border-line">
            {["Leg", "Mark", "Δ", "Γ", "Θ/d", "Vega", "IV"].map((col) => (
              <th
                key={col}
                className="px-1 py-0.5 text-right font-semibold tracking-[0.5px] text-muted-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Leg label — static, not live */}
            <td className="px-1 py-[3px] text-left text-txt">
              {legLabel(position.occSymbol)}
            </td>

            {/* Mark — live mark if tick present, else static */}
            <td
              key={`td-mark-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right text-txt",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
            >
              {tick !== undefined
                ? `$${tick.mark.toFixed(2)}`
                : (mark !== null ? `$${(mark / Math.abs(netQty) / 100).toFixed(2)}` : "—")}
            </td>

            {/* Δ — live bsmDelta if tick present, else static */}
            <td
              key={`td-delta-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right",
                liveDelta >= 0 ? "text-up" : "text-down",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
            >
              {fmtGreek(liveDelta)}
            </td>

            {/* Γ — live bsmGamma if tick present, else static */}
            <td
              key={`td-gamma-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right text-txt",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
            >
              {fmtGreek(liveGamma)}
            </td>

            {/* Θ/d — live bsmTheta if tick present, else static */}
            <td
              key={`td-theta-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right",
                liveTheta < 0 ? "text-down" : "text-up",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
            >
              {fmtGreek(liveTheta)}
            </td>

            {/* Vega — live bsmVega if tick present, else static */}
            <td
              key={`td-vega-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right text-txt",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
            >
              {fmtGreek(liveVega)}
            </td>

            {/* IV — live bsmIv if tick present, else DEFAULT_IV */}
            <td
              key={`td-iv-${tickKey}`}
              className={cn(
                "px-1 py-[3px] text-right text-dim",
                tick !== undefined && `live-cell-flash ${liveCellClass}`,
              )}
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
      <p className="mt-2 font-mono text-[10px] leading-[1.4] text-dim">
        Strike {strike} vs gamma flip {flip} ({Math.abs(strike - flip).toFixed(0)} pts apart).
      </p>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ height = 80 }: { height?: number }): React.ReactElement {
  return (
    <div
      className="rounded-[4px] bg-line"
      style={{ height, animation: "shimmer 1.5s infinite" }}
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
    <div className="mx-auto max-w-[1480px] p-3.5">
      {/* Row 1: 12-column grid */}
      <div className="mb-3 grid grid-cols-12 gap-3">
        {/* Open positions list — span 3 */}
        <Panel className="col-span-3">
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
          <Separator className="my-2" />
          <AdHocPicker
            subscribeAdHoc={subscribeAdHoc}
            liveGreeks={liveGreeks}
            liveStatus={liveStatus}
            adHocSymbol={adHocSymbol}
            onSetAdHocSymbol={(sym) => { setAdHocSymbol(sym); }}
            onClearAdHoc={() => { setAdHocSymbol(null); }}
          />
        </Panel>

        {/* Why it's moving — span 5 */}
        <Panel className="col-span-5">
          {posLoading || selected === null ? (
            <>
              <CardHeading text="Why it's moving" badge="P&L since yesterday" />
              {posLoading ? (
                <Skeleton height={120} />
              ) : (
                <p className="font-mono text-[10px] text-dim">
                  Select a position to see attribution.
                </p>
              )}
            </>
          ) : (
            <WhyItsMoving position={selected} spot={spot} />
          )}
        </Panel>

        {/* Position card — span 4 */}
        <Panel className="col-span-4">
          {posLoading || selected === null ? (
            <>
              {/* Phase 12 Surface 3: LiveStatusBadge even in loading/empty state */}
              <PanelHeading
                title="Position"
                badge={<LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />}
              />
              {posLoading ? (
                <Skeleton height={120} />
              ) : (
                <p className="font-mono text-[10px] text-dim">
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
        </Panel>
      </div>

      {/* Row 2: 12-column grid */}
      <div className="grid grid-cols-12 gap-3">
        {/* Greeks vs spot — span 8 */}
        <Panel className="col-span-8">
          {posLoading || selected === null ? (
            <>
              <CardHeading text="Greeks vs spot" badge="net · current spot marked" />
              <Skeleton height={104} />
            </>
          ) : (
            <GreeksVsSpot position={selected} spot={spot} strike={selectedStrike} />
          )}
        </Panel>

        {/* Strike vs structure — span 4 */}
        <Panel className="col-span-4">
          <StrikeVsStructure
            strike={selectedStrike}
            spot={spot}
            flip={flip}
            callWall={callWall}
            putWall={putWall}
          />
        </Panel>
      </div>
    </div>
  );
}
