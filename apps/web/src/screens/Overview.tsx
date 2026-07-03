import { useCallback, useMemo, useState } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useStatus } from "../hooks/useStatus.ts";
import { useCot } from "../hooks/useCot.ts";
import { useMacro } from "../hooks/useMacro.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { pairPositionsIntoCalendars, bookUnrealizedPnl } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { classifyRegime } from "../lib/gex-regime.ts";
import { repriceScenario } from "../lib/scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams } from "../lib/scenario-engine.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { CotCard } from "../components/CotCard.tsx";
import { MacroCard } from "../components/MacroCard.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { Panel, PanelHeading, SectionLabel, Stat, MetricChip } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse, GexSnapshotEntry, MacroResponse, MacroSeriesId } from "@morai/contracts";
import type { StreamLiveGreekEvent } from "@morai/contracts";

/**
 * Overview — the home dashboard, TOS-dock layout (Phase 17 redesign, OVW-01/OVW-02):
 *   1. Pill header — SPX spot, net γ/1% + regime, γ flip, VIX, VVIX, Fed funds, 10y−2y,
 *      COT lev, book P&L.
 *   2. Two-column body: left = payoff hero ("Risk profile — combined book") + docked
 *      positions table; right = 320px GEX rail (dealer γ profile, GEX by strike,
 *      key levels, net book greeks).
 *   3. Positioning & macro detail row (CotCard + MacroCard, unchanged).
 *   4. Book & system row (BookSummary + SystemHealth, unchanged).
 *
 * The payoff hero uses `repriceScenario` over calendar positions built from
 * `pairPositionsIntoCalendars`. Task 17-04/2 replaces the placeholder flat IV below
 * with per-leg calibrated IV via `resolveLegIv` (OVW-02) — do not read this DEFAULT_IV
 * as final; it is superseded by the calibration wiring in the same plan.
 *
 * `netGreeksForLegs`/`BookSummary` stay on flat DEFAULT_IV permanently (OQ2 deferral,
 * recorded in 17-04-SUMMARY.md) — that path is NOT the payoff-hero calibration path.
 *
 * D-06 constraint: exactly one live-stream consumer on this surface. useLiveStream()
 * is called here and threaded into the payoff hero + docked positions table — NOT into
 * BookSummary or any other section. AdHocPicker / SC6 stays on Analyzer.
 */

const DEFAULT_IV = 0.18;
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

/** Sum position greeks across legs, scaled to position terms (per-share × netQty × 100).
 *  Used for the static BookSummary section AND the GEX rail's Net book greeks tile —
 *  NOT for the calibrated payoff-hero curve (OQ2 deferral). */
function netGreeksForLegs(
  legs: ReadonlyArray<BrokerPositionResponse>,
  spot: number,
): NetGreeks {
  const acc: NetGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const r = computePositionGreeks({
      occSymbol: leg.occSymbol,
      spot,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty: leg.longQty,
      shortQty: leg.shortQty,
    });
    if (!r.ok) continue;
    // computePositionGreeks already scales by netQty; apply ONLY the ×100 contract
    // multiplier — multiplying by netQty×100 double-applies netQty (CR-01).
    acc.delta += r.value.greeks.delta * 100;
    acc.gamma += r.value.greeks.gamma * 100;
    acc.theta += r.value.greeks.theta * 100;
    acc.vega += r.value.greeks.vega * 100;
  }
  return acc;
}

/** Σ unrealized P&L across legs (marketValue − avgPrice·netQty·100).
 *  Used for the static BookSummary section — NOT for the live-overlaid PositionsTable. */
function netUnreal(legs: ReadonlyArray<BrokerPositionResponse>): number | null {
  let total = 0;
  for (const l of legs) {
    if (l.marketValue === null || l.averagePrice === null) return null;
    total += l.marketValue - l.averagePrice * (l.longQty - l.shortQty) * 100;
  }
  return total;
}

/**
 * Truncate a non-negative number to `dp` decimals WITHOUT rounding, padded to `dp` places.
 * Round at dp+2 first (kills float noise like 186.5799999) then string-slice — so the
 * displayed digits never round the value up.
 */
function truncFixed(absV: number, dp: number): string {
  const s = absV.toFixed(dp + 2);
  const dot = s.indexOf(".");
  return dp === 0 ? s.slice(0, dot) : s.slice(0, dot + 1 + dp);
}

function signed(v: number, dp = 3): string {
  return `${v >= 0 ? "+" : "−"}${truncFixed(Math.abs(v), dp)}`;
}

function signedUsd(v: number, dp = 3): string {
  return `${v >= 0 ? "+" : "−"}$${truncFixed(Math.abs(v), dp)}`;
}

/** Dollar value without a forced + sign (negatives keep the − minus). */
function usd(v: number, dp = 3): string {
  return `${v < 0 ? "−" : ""}$${truncFixed(Math.abs(v), dp)}`;
}

function signClass(v: number): string {
  return v >= 0 ? "text-up" : "text-down";
}

// ─── Positions table (docked, TOS-style) ──────────────────────────────────────

type Row = {
  key: string;
  label: string;
  dte: string;
  legs: ReadonlyArray<BrokerPositionResponse>;
};

function buildRows(positions: ReadonlyArray<BrokerPositionResponse>): Row[] {
  const { calendars, singles } = pairPositionsIntoCalendars(positions, new Date());
  const calRows: Row[] = calendars.map((c) => ({
    key: c.key,
    label: `${c.strike}${c.optionType}`,
    dte: `${c.dteFront}d → ${c.dteBack}d`,
    legs: [c.front, c.back],
  }));
  const singleRows: Row[] = singles.map((p) => {
    const parsed = parseOccSymbol(p.occSymbol);
    const label = parsed.ok ? `${parsed.value.strike}${parsed.value.type}` : p.occSymbol.trim();
    const dte = parsed.ok
      ? `${Math.max(0, Math.ceil((parsed.value.expiry.getTime() - Date.now()) / 86_400_000))}d`
      : "—";
    return { key: p.occSymbol, label, dte, legs: [p] };
  });
  return [...calRows, ...singleRows];
}

const COLS = ["Position", "DTE", "Net val", "Unreal", "Δ", "Γ", "Θ/d", "Vega"] as const;

/**
 * PositionsTable — TOS-style docked positions table with live BSM greek overlay.
 *
 * Phase 12-07 extensions (STRM-01 / D-04 / Surface 2, kept unmodified — Pitfall 6):
 *   - resolveLivePositionRow overlays live SSE ticks per row + Net total.
 *   - .live-cell applied to live-sourced cells (Net val, Unreal, Δ, Γ, Θ/d, Vega).
 *   - .live-cell.stale applied when status is 'stale'/'reconnecting' (color dim, not opacity).
 *   - React key trick (key includes liveTs) re-triggers .live-cell-flash animation per tick.
 *   - Per-symbol fallback: no tick for a symbol → static polled value, no live-cell class.
 *   - Excluded-row opacity-40 is user-driven row exclusion — NOT the stale-streaming UX.
 */
function PositionsTable({
  positions,
  spot,
  liveGreeks,
  liveStatus,
}: {
  positions: ReadonlyArray<BrokerPositionResponse>;
  spot: number;
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  liveStatus: LiveStreamStatus;
}): React.ReactElement {
  const rows = useMemo(() => buildRows(positions), [positions]);
  // Excluded row keys — a position counts toward the Net total unless explicitly unchecked.
  // Tracking exclusions (not inclusions) means new positions default to "included".
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  const isStale = liveStatus === "stale" || liveStatus === "reconnecting";

  /** CSS class(es) to add to a live-sourced cell (adds stale dim when stream is stale). */
  const liveCellCn = (liveTs: string | null): string => {
    if (liveTs === null) return "";
    return `live-cell${isStale ? " stale" : ""}`;
  };

  const total = useMemo(() => {
    const includedLegs = rows
      .filter((r) => !excluded.has(r.key))
      .flatMap((r) => r.legs);
    return resolveLivePositionRow(includedLegs, spot, liveGreeks);
  }, [rows, excluded, spot, liveGreeks]);

  if (rows.length === 0) {
    return (
      <p className="font-mono text-[11px] text-dim">
        No open positions. Register a calendar via the API or paste a TOS order in the Analyzer.
      </p>
    );
  }

  const includedCount = rows.filter((r) => !excluded.has(r.key)).length;
  const toggle = (key: string): void =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
      <thead>
        <tr>
          <th className="border-b border-line px-2 py-1" aria-label="Include in total" />
          {COLS.map((c, i) => (
            <th
              key={c}
              className={cn(
                "border-b border-line px-2 py-1 font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase",
                i === 0 ? "text-left" : "text-right",
              )}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const included = !excluded.has(r.key);
          const resolved = resolveLivePositionRow(r.legs, spot, liveGreeks);
          const { netVal: val, unreal, greeks: g, liveTs } = resolved;
          const rowLive = liveCellCn(liveTs);
          const flashCn = liveTs !== null ? `live-cell-flash ${rowLive}` : "";
          return (
            <tr
              key={r.key}
              className={cn(
                "border-b border-line/50 transition-opacity hover:bg-raise/30",
                !included && "opacity-40",
              )}
            >
              <td className="px-2 py-1 text-center">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => { toggle(r.key); }}
                  aria-label={`Include ${r.label} in total`}
                  className="accent-blue cursor-pointer"
                />
              </td>
              {/* Position — static, no live-cell */}
              <td className="px-2 py-1 text-left text-txt">{r.label}</td>
              {/* DTE — static, no live-cell */}
              <td className="px-2 py-1 text-right text-muted-foreground">{r.dte}</td>
              {/* Net val — live-sourced when tick present */}
              <td
                key={`${r.key}-netval-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right text-txt", flashCn)}
              >
                {usd(val)}
              </td>
              {/* Unreal — live-sourced when tick present */}
              <td
                key={`${r.key}-unreal-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right", unreal === null ? "text-dim" : signClass(unreal), flashCn)}
              >
                {unreal === null ? "—" : signedUsd(unreal)}
              </td>
              {/* Δ — live-sourced when tick present */}
              <td
                key={`${r.key}-delta-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right", signClass(g.delta), flashCn)}
              >
                {signed(g.delta)}
              </td>
              {/* Γ — live-sourced when tick present */}
              <td
                key={`${r.key}-gamma-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right text-muted-foreground", flashCn)}
              >
                {signed(g.gamma)}
              </td>
              {/* Θ/d — live-sourced when tick present */}
              <td
                key={`${r.key}-theta-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right", signClass(g.theta), flashCn)}
              >
                {signedUsd(g.theta)}
              </td>
              {/* Vega — live-sourced when tick present */}
              <td
                key={`${r.key}-vega-${liveTs ?? ""}`}
                className={cn("px-2 py-1 text-right", signClass(g.vega), flashCn)}
              >
                {signedUsd(g.vega)}
              </td>
            </tr>
          );
        })}
        {/* Net total row — uses resolveLivePositionRow over all included legs */}
        <tr className="border-t border-line font-semibold">
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-left text-txt">
            Net <span className="font-mono text-[10px] font-normal text-dim">· {includedCount}/{rows.length}</span>
          </td>
          <td className="px-2 py-1" />
          {/* Net val total */}
          <td
            key={`total-netval-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right text-txt", total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {usd(total.netVal)}
          </td>
          {/* Unreal total */}
          <td
            key={`total-unreal-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right", total.unreal === null ? "text-dim" : signClass(total.unreal), total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {total.unreal === null ? "—" : signedUsd(total.unreal)}
          </td>
          {/* Δ total */}
          <td
            key={`total-delta-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right", signClass(total.greeks.delta), total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {signed(total.greeks.delta)}
          </td>
          {/* Γ total */}
          <td
            key={`total-gamma-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right text-muted-foreground", total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {signed(total.greeks.gamma)}
          </td>
          {/* Θ/d total */}
          <td
            key={`total-theta-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right", signClass(total.greeks.theta), total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {signedUsd(total.greeks.theta)}
          </td>
          {/* Vega total */}
          <td
            key={`total-vega-${total.liveTs ?? ""}`}
            className={cn("px-2 py-1 text-right", signClass(total.greeks.vega), total.liveTs !== null && `live-cell-flash ${liveCellCn(total.liveTs)}`)}
          >
            {signedUsd(total.greeks.vega)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Book summary (unchanged — OQ2: stays on flat DEFAULT_IV) ────────────────

function BookSummary({
  positions,
  spot,
}: {
  positions: ReadonlyArray<BrokerPositionResponse>;
  spot: number;
}): React.ReactElement {
  const rows = buildRows(positions);
  const allLegs = rows.flatMap((r) => r.legs);
  const unreal = netUnreal(allLegs);
  const g = netGreeksForLegs(allLegs, spot);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Stat label="Positions" value={String(rows.length)} />
      <Stat
        label="Unrealized P&L"
        value={unreal === null ? "—" : signedUsd(unreal)}
        valueClassName={unreal === null ? "text-dim" : signClass(unreal)}
      />
      <Stat label="Net Δ" value={signed(g.delta)} valueClassName={signClass(g.delta)} />
      <Stat label="Net Θ/day" value={signedUsd(g.theta)} valueClassName={signClass(g.theta)} />
      <Stat label="Net Vega" value={signedUsd(g.vega)} valueClassName={signClass(g.vega)} />
      <Stat label="Net Γ" value={signed(g.gamma)} />
    </div>
  );
}

function SystemHealth(): React.ReactElement {
  const { data: status } = useStatus();
  if (status === undefined || status.lastJobRuns === "none yet") {
    return <p className="font-mono text-[11px] text-dim">System status loading…</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(status.lastJobRuns).map(([job, rec]) => {
        const healthy =
          rec.lastErrorAt === null ||
          (rec.lastSuccessAt !== null && rec.lastSuccessAt > rec.lastErrorAt);
        return (
          <div key={job} className="flex items-center gap-2 font-mono text-[11px]">
            <span className={cn("size-2 shrink-0 rounded-full", healthy ? "bg-up" : "bg-down")} />
            <span className="text-muted-foreground">{job}</span>
            <span className="ml-auto text-dim">{healthy ? "ok" : "error"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── GEX rail (320px, right column) ───────────────────────────────────────────

function keyLevelsFor(
  gex: GexSnapshotEntry,
): ReadonlyArray<{ label: string; value: number | null; colorClass: string }> {
  return [
    { label: "Call Wall", value: gex.callWall, colorClass: "text-up" },
    { label: "γ flip", value: gex.flip, colorClass: "text-amber" },
    { label: "Spot", value: gex.spot, colorClass: "text-blue" },
    { label: "Put Wall", value: gex.putWall, colorClass: "text-down" },
  ];
}

function GexRail({
  gex,
  railGreeks,
}: {
  gex: GexSnapshotEntry | undefined;
  railGreeks: NetGreeks;
}): React.ReactElement {
  if (gex === undefined) {
    return (
      <Panel className="p-8 text-center font-mono text-xs text-dim" data-testid="gex-rail-empty">
        GEX data unavailable — run fetch-chain to populate.
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelHeading title="Dealer γ profile" />
        <GammaProfile profile={gex.profile} spot={gex.spot} flip={gex.flip} compact />
      </Panel>
      <Panel>
        <PanelHeading title="GEX by strike" />
        <GexBars
          mode="gex"
          strikes={gex.strikes}
          spot={gex.spot}
          callWall={gex.callWall}
          putWall={gex.putWall}
          height={200}
          range={10}
        />
      </Panel>
      <Panel>
        <PanelHeading title="Key levels" />
        <div className="flex flex-col gap-1.5">
          {keyLevelsFor(gex).map((lvl) => (
            <div
              key={lvl.label}
              className="flex items-center justify-between gap-2 rounded-md bg-raise/40 px-2.5 py-1 font-mono text-[10px] ring-1 ring-line"
            >
              <span className={cn(lvl.colorClass, "font-display font-semibold tracking-[0.09em] uppercase")}>
                {lvl.label}
              </span>
              <span className="text-txt">{lvl.value !== null ? lvl.value.toFixed(0) : "—"}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <PanelHeading title="Net book greeks" />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Net Δ" value={signed(railGreeks.delta)} valueClassName={signClass(railGreeks.delta)} />
          <Stat label="Net Γ" value={signed(railGreeks.gamma)} />
          <Stat label="Net Θ/d" value={signedUsd(railGreeks.theta)} valueClassName={signClass(railGreeks.theta)} />
          <Stat label="Net Vega" value={signedUsd(railGreeks.vega)} valueClassName={signClass(railGreeks.vega)} />
        </div>
      </Panel>
    </>
  );
}

// ─── Pill header ───────────────────────────────────────────────────────────────

function fmtGammaCompact(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(1)}B`;
}

function latestMacroValue(data: MacroResponse | undefined, id: MacroSeriesId): number | null {
  if (data === undefined) return null;
  const points = data[id];
  if (points === undefined || points.length === 0) return null;
  const latest = points[points.length - 1];
  return latest?.value ?? null;
}

function PillHeader({
  gex,
  cotLev,
  macro,
  bookPnl,
}: {
  gex: GexSnapshotEntry | undefined;
  cotLev: number | null;
  macro: MacroResponse | undefined;
  bookPnl: number;
}): React.ReactElement {
  const regime = gex !== undefined ? classifyRegime(gex.netGammaAtSpot) : null;
  const vix = latestMacroValue(macro, "VIXCLS");
  const vvix = latestMacroValue(macro, "VVIX");
  const dff = latestMacroValue(macro, "DFF");
  const curveSlope = latestMacroValue(macro, "T10Y2Y");

  return (
    <div className="sticky top-0 z-10 -mx-3.5 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-3.5 py-2 backdrop-blur">
      <MetricChip label="SPX" value={gex !== undefined ? gex.spot.toFixed(1) : "—"} valueClassName="text-blue" />
      <MetricChip
        label="net γ /1%"
        value={gex !== undefined ? fmtGammaCompact(gex.netGammaAtSpot) : "—"}
        alert={regime === "AMPLIFY"}
        valueClassName={regime === null ? "text-muted-foreground" : regime === "AMPLIFY" ? "text-down" : "text-up"}
      />
      <MetricChip
        label="γ flip"
        value={gex !== undefined && gex.flip !== null ? gex.flip.toFixed(0) : "—"}
        valueClassName="text-amber"
      />
      <MetricChip label="VIX" value={vix !== null ? vix.toFixed(2) : "—"} />
      <MetricChip label="VVIX" value={vvix !== null ? vvix.toFixed(1) : "—"} />
      <MetricChip label="Fed funds" value={dff !== null ? `${dff.toFixed(2)}%` : "—"} />
      <MetricChip
        label="10y−2y"
        value={curveSlope !== null ? `${curveSlope >= 0 ? "+" : ""}${curveSlope.toFixed(2)}` : "—"}
        valueClassName={curveSlope !== null ? signClass(curveSlope) : "text-muted-foreground"}
      />
      <MetricChip
        label="COT lev"
        value={cotLev !== null ? signed(cotLev, 0) : "—"}
        valueClassName={cotLev !== null ? signClass(cotLev) : "text-muted-foreground"}
      />
      <MetricChip
        label="book"
        value={signedUsd(bookPnl, 0)}
        valueClassName={signClass(bookPnl)}
        className="ml-auto"
      />
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function Overview(): React.ReactElement {
  const { data: posData } = usePositions();
  const { data: gex } = useGex();
  const { data: cot } = useCot();
  const { data: macro } = useMacro();
  const positions = posData?.positions ?? [];
  const spot = gex?.spot ?? 5800;

  // Phase 12-07: live stream hook (D-06 — this surface only).
  // useLiveStream() is called once here and threaded into the payoff hero + docked table.
  // Overview and Analyzer never mount simultaneously (ShellWithRouter renders one screen)
  // so no second EventSource opens.
  const {
    greeks: liveGreeks,
    status: liveStatus,
    lastTickAt: liveLastTickAt,
  } = useLiveStream();

  // ── Payoff hero positions (calendars only — the scenario engine models calendar
  // spreads; singles remain table-only rows) ──────────────────────────────────
  const { calendars } = useMemo(
    () => pairPositionsIntoCalendars(positions, new Date()),
    [positions],
  );

  // NOTE: placeholder flat DEFAULT_IV — 17-04 Task 2 replaces this with per-leg
  // calibrated IV via resolveLegIv (OVW-02). Do not extend this shape; it is
  // superseded in the same plan, same file.
  const calendarPositions = useMemo<ReadonlyArray<AnalyzerPosition>>(
    () =>
      calendars.map((cal) => ({
        id: cal.key,
        name: `${cal.strike}${cal.optionType}`,
        live: true,
        occSymbol: cal.back.occSymbol,
        putCall: cal.optionType,
        frontDte: cal.dteFront,
        backDte: cal.dteBack,
        frontIv: DEFAULT_IV,
        backIv: DEFAULT_IV,
        qty: Math.max(1, Math.abs(cal.back.longQty - cal.back.shortQty)),
        included: true,
      })),
    [calendars],
  );

  const scenario = useMemo(() => {
    const params: ScenarioParams = {
      spot,
      daysForward: 0,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return repriceScenario(calendarPositions, params);
  }, [calendarPositions, spot]);

  const positionSetSignature = calendarPositions.map((p) => p.id).join("|");

  const noop = useCallback((): void => {}, []);

  const railGreeks = useMemo(() => {
    const allLegs = buildRows(positions).flatMap((r) => r.legs);
    return netGreeksForLegs(allLegs, spot);
  }, [positions, spot]);

  const bookPnl = useMemo(() => bookUnrealizedPnl(positions), [positions]);
  const cotLev = cot?.[0]?.netLeveraged ?? null;

  return (
    <div className="mx-auto flex max-w-[1480px] flex-col gap-5 p-3.5">
      <PillHeader gex={gex} cotLev={cotLev} macro={macro} bookPnl={bookPnl} />

      {/* ── Two-column body: payoff hero + docked table (left) / GEX rail (right) ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 320px" }}>
        <div className="flex flex-col gap-3">
          {/* Payoff hero */}
          <Panel>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>Risk profile — combined book</SectionLabel>
              <span className="font-mono text-[10px] text-dim">view-only · Analyzer →</span>
            </div>
            <div className="mb-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-violet" />
                T+0
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-muted-foreground" />
                @ exp
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-amber" />
                γ flip
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-up" />
                walls
              </span>
            </div>
            <PayoffChart
              todayCurve={scenario.payoffCurve}
              fanCurves={[]}
              expirationCurve={scenario.expirationCurve}
              rollCurve={null}
              gex={gex !== undefined ? { callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip } : null}
              spot={spot}
              toggles={{ showFan: false, showExpiration: true, showWalls: true, showProfitZone: true }}
              fitY={false}
              onFitYConsumed={noop}
              positionSetSignature={positionSetSignature}
              baseExpirationCurve={scenario.expirationCurve}
            />
          </Panel>

          {/* Docked positions table */}
          <Panel>
            <div className="mb-2 flex items-center gap-2">
              <SectionLabel>Positions</SectionLabel>
              <LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />
            </div>
            <PositionsTable
              positions={positions}
              spot={spot}
              liveGreeks={liveGreeks}
              liveStatus={liveStatus}
            />
          </Panel>
        </div>

        {/* GEX rail */}
        <div className="flex flex-col gap-3">
          <GexRail gex={gex} railGreeks={railGreeks} />
        </div>
      </div>

      {/* ── Positioning & macro detail (unchanged) ── */}
      <section>
        <SectionLabel className="mb-2">Positioning & macro detail</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CotCard />
          <MacroCard />
        </div>
      </section>

      {/* ── Book & system (unchanged) ── */}
      <section>
        <SectionLabel className="mb-2">Book & system</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Panel className="p-4">
            <SectionLabel className="mb-3">Book summary</SectionLabel>
            <BookSummary positions={positions} spot={spot} />
          </Panel>
          <Panel className="p-4">
            <SectionLabel className="mb-3">System health</SectionLabel>
            <SystemHealth />
          </Panel>
        </div>
      </section>
    </div>
  );
}
