import { Fragment, useCallback, useMemo, useState } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useCot } from "../hooks/useCot.ts";
import { useMacro } from "../hooks/useMacro.ts";
import { useExits } from "../hooks/useExits.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signed, signedUsd, signClass } from "../lib/position-format.ts";
import type { Row, ExpiryCell } from "../lib/position-format.ts";
import { pairPositionsIntoCalendars, bookUnrealizedPnl, dteExact } from "../lib/pair-calendars.ts";
import type { CalendarGroup } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { resolveCarry, DEFAULT_RATE, DEFAULT_DIV } from "../lib/resolve-carry.ts";
import { toDateInputValue } from "../lib/date-projection.ts";
import { classifyRegime, zeroDteGex } from "../lib/gex-regime.ts";
import { resolveLegIv } from "../lib/iv-calibration.ts";
import type { LiveTick } from "../lib/iv-calibration.ts";
import { computeProjectionBounds } from "../lib/date-projection.ts";
import { usePayoffDateControl } from "../hooks/usePayoffDateControl.ts";
import { repriceScenario, t0ExcludedPositions } from "../lib/scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams } from "../lib/scenario-engine.ts";
import { computePayoffDomain } from "../lib/payoff-domain.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { relAge, GEX_FRESH_MS } from "./Market.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { MarketRail } from "./MarketRail.tsx";
import {
  HeldPositionsPanel,
  VerdictChip,
  VerdictChangedMarker,
  VerdictDetailBody,
} from "./HeldPositionsPanel.tsx";
import { ExitRulesPanel } from "./ExitRulesPanel.tsx";
import { Panel, PanelHeading, Stat, MetricChip, Button, ChipRail } from "../components/system/index.tsx";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse, GexSnapshotEntry, MacroResponse, MacroSeriesId } from "@morai/contracts";
import type { StreamLiveGreekEvent, HeldPositionVerdict } from "@morai/contracts";

/**
 * Overview — the home dashboard, three-column Launchpad shell (overview-layout-redesign.md,
 * Option A):
 *   1. Pill header — SPX spot, net γ/1% + regime, γ flip, VIX, VVIX, Fed funds, 10y−2y,
 *      COT lev, book P&L.
 *   2. LEFT MarketRail (~280px) — entry gate + regime pills + rates + COT + system health
 *      (see MarketRail.tsx). Persistent "where is the market" context.
 *   3. CENTER — payoff hero ("Risk profile — combined book") above the docked positions
 *      table. The table carries a VERDICT column: each open calendar's exit verdict is
 *      joined into its row by `${strike}${optionType}` (verdictByRowKey). Row click expands
 *      the verdict detail (rule + metric, roll, CHANGED, as-of). Verdicts with no live
 *      broker row fall to an "Unlinked verdicts" list under the table (never dropped). The
 *      exit-rules ladder opens from an "Exit rules ▸" dialog button in the Positions header.
 *   4. RIGHT — 320px GEX rail (dealer γ profile, GEX by strike, key levels, net book greeks).
 *   5. Mobile — stacks ticker → MarketRail (collapsible) → hero → positions+verdicts → GEX.
 *
 * The payoff hero uses `repriceScenario` over calendar positions built from
 * `pairPositionsIntoCalendars`. Task 17-04/2 replaces the placeholder flat IV below
 * with per-leg calibrated IV via `resolveLegIv` (OVW-02) — do not read this DEFAULT_IV
 * as final; it is superseded by the calibration wiring in the same plan.
 *
 * `netGreeksForLegs` (the GEX rail's Net book greeks tile) stays on flat DEFAULT_IV
 * permanently (OQ2 deferral, recorded in 17-04-SUMMARY.md) — that path is NOT the
 * payoff-hero calibration path.
 *
 * D-06 constraint: exactly one live-stream consumer on this surface. useLiveStream()
 * is called here and threaded into the payoff hero + docked positions table only.
 * AdHocPicker / SC6 stays on Analyzer.
 */

const DEFAULT_IV = 0.18;
/** Live-mark badge freshness threshold (D-03) — independent of LiveStatusBadge's
 *  connection state; a reconnected stream can still have a >5min-old last tick. */
const LIVE_MARK_FRESH_MS = 5 * 60 * 1000;

type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

// ─── Per-leg IV calibration (OVW-02, D-01/D-02) ───────────────────────────────

type LegIvResolution = {
  readonly iv: number;
  readonly status: "ok" | "non-convergent";
  /** True only for a genuine invertIv non-convergence — NOT the wrapper's own
   *  "no-price" cold-start state (Pitfall 2 / T-17-09). Drives the "IV n/a" badge. */
  readonly ivNa: boolean;
};

/**
 * Resolve one leg's IV via `resolveLegIv` (17-01): trusts an already-converged live
 * tick's `bsmIv` when present, else calibrates from the REST-fallback price. Both a
 * genuine `IvError` AND the wrapper's "no-price" state exclude the leg from the
 * payoff-hero pricing (status "non-convergent") — the hero never substitutes a
 * guessed IV either way (T-17-05). Only a genuine `IvError` renders the "IV n/a"
 * badge; "no-price" (cold start / outside RTH) does not (Pitfall 2 / T-17-09).
 */
function resolveLeg(
  leg: BrokerPositionResponse,
  spot: number,
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>,
  now: Date,
): LegIvResolution {
  const netQty = leg.longQty - leg.shortQty;
  const tick = liveGreeks.get(leg.occSymbol);
  const liveTick: LiveTick | null = tick === undefined ? null : { mark: tick.mark, bsmIv: tick.bsmIv };
  const result = resolveLegIv(
    leg.occSymbol,
    spot,
    DEFAULT_RATE,
    DEFAULT_DIV,
    liveTick,
    leg.marketValue,
    netQty,
    now,
  );
  if (result.ok) {
    return { iv: result.value, status: "ok", ivNa: false };
  }
  return { iv: 0, status: "non-convergent", ivNa: result.error.kind !== "no-price" };
}

type CalendarPositionBuild = {
  readonly position: AnalyzerPosition;
  /** Either leg genuinely non-convergent (not just no-price) — drives the row badge. */
  readonly ivNa: boolean;
};

/** A leg's expiry as the GEX impliedCarry lookup key (YYYY-MM-DD, local calendar day —
 *  matches parseOccSymbol's local-Date construction, per RESEARCH Pitfall 1 / date-
 *  projection.ts's `toDateInputValue` precedent). "" (never a carry match) on an
 *  unparseable OCC symbol, which correctly degrades resolveCarry to the DEFAULTs. */
function legExpiryKey(occSymbol: string): string {
  const parsed = parseOccSymbol(occSymbol);
  return parsed.ok ? toDateInputValue(parsed.value.expiry) : "";
}

/** Build one AnalyzerPosition from a paired calendar, calibrating both legs' IV.
 *  `included` (OVW-06) is the row checkbox state lifted from PositionsTable — the single
 *  source of truth for whether this calendar contributes to the payoff curves AND the
 *  table total. It is NOT the IV-convergence gate (frontIvStatus/backIvStatus below,
 *  which the scenario engine applies independently via includedForT0/includedForExpiry).
 *  34-05: also sets the settlement-aware fractional DTE (dteExact) and each leg's own
 *  parity-implied carry (resolveCarry over `gex`) — degrading to DEFAULT_RATE/DEFAULT_DIV
 *  when gex/impliedCarry/the leg's expiry entry is unavailable. */
export function buildCalendarPosition(
  cal: CalendarGroup,
  spot: number,
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>,
  now: Date,
  included: boolean,
  gex: GexSnapshotEntry | undefined,
): CalendarPositionBuild {
  const front = resolveLeg(cal.front, spot, liveGreeks, now);
  const back = resolveLeg(cal.back, spot, liveGreeks, now);
  const frontCarry = resolveCarry(gex, legExpiryKey(cal.front.occSymbol));
  const backCarry = resolveCarry(gex, legExpiryKey(cal.back.occSymbol));
  // Actual fill basis (points per contract): anchors the payoff curves to the REAL
  // entry so they show true open P&L at spot, like TOS — not the model entry re-priced
  // at the live spot (which pins T+0 to $0 at spot and, on a near-flat calendar curve,
  // shifts the breakevens by hundreds of points).
  const entryNet =
    cal.back.averagePrice !== null && cal.front.averagePrice !== null
      ? cal.back.averagePrice - cal.front.averagePrice
      : null;
  return {
    position: {
      id: cal.key,
      name: `${cal.strike}${cal.optionType}`,
      live: true,
      occSymbol: cal.back.occSymbol,
      putCall: cal.optionType,
      frontDte: cal.dteFront,
      backDte: cal.dteBack,
      frontDteExact: dteExact(cal.front.occSymbol, now),
      backDteExact: dteExact(cal.back.occSymbol, now),
      frontIv: front.iv,
      backIv: back.iv,
      frontRate: frontCarry.rate,
      frontDivYield: frontCarry.divYield,
      backRate: backCarry.rate,
      backDivYield: backCarry.divYield,
      qty: Math.max(1, Math.abs(cal.back.longQty - cal.back.shortQty)),
      included,
      entryNet,
      frontIvStatus: front.status,
      backIvStatus: back.status,
    },
    ivNa: front.ivNa || back.ivNa,
  };
}

/** Sum position greeks across legs, scaled to position terms (per-share × netQty × 100).
 *  Used for the GEX rail's Net book greeks tile — NOT for the calibrated payoff-hero
 *  curve (OQ2 deferral). */
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

// ─── Positions table (docked, TOS-style) ──────────────────────────────────────

type ExpiryCellInput =
  | {
      readonly kind: "calendar";
      readonly frontOccSymbol: string;
      readonly backOccSymbol: string;
      readonly dteFront: number;
      readonly dteBack: number;
    }
  | {
      readonly kind: "single";
      readonly occSymbol: string;
      readonly dte: number;
    };

/** Short month/day, e.g. "Aug 8" — matches the existing `gexAsOf` convention. */
function formatExpiryDate(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

/**
 * Structured expiry/DTE cell for a positions-table row (OVW-03): a calendar shows both
 * leg expiries + both DTEs + the calendar width (days between); a single leg shows its
 * one expiry + DTE. Pure — takes already-computed DTEs (`CalendarGroup.dteFront/dteBack`,
 * or the caller's own single-leg DTE) rather than re-deriving "now" itself. Guards the
 * `parseOccSymbol` Result and falls back to "—" for line1 on a parse failure.
 */
export function formatExpiryCell(input: ExpiryCellInput): ExpiryCell {
  if (input.kind === "single") {
    const parsed = parseOccSymbol(input.occSymbol);
    return {
      line1: parsed.ok ? formatExpiryDate(parsed.value.expiry) : "—",
      line2: `${input.dte}d`,
    };
  }
  const front = parseOccSymbol(input.frontOccSymbol);
  const back = parseOccSymbol(input.backOccSymbol);
  const line1 =
    front.ok && back.ok
      ? `${formatExpiryDate(front.value.expiry)} → ${formatExpiryDate(back.value.expiry)}`
      : "—";
  return {
    line1,
    line2: `${input.dteFront}d/${input.dteBack}d · ${input.dteBack - input.dteFront}d wide`,
  };
}

function buildRows(positions: ReadonlyArray<BrokerPositionResponse>): Row[] {
  const { calendars, singles } = pairPositionsIntoCalendars(positions, new Date());
  const calRows: Row[] = calendars.map((c) => ({
    key: c.key,
    label: `${c.strike}${c.optionType}`,
    expiry: formatExpiryCell({
      kind: "calendar",
      frontOccSymbol: c.front.occSymbol,
      backOccSymbol: c.back.occSymbol,
      dteFront: c.dteFront,
      dteBack: c.dteBack,
    }),
    legs: [c.front, c.back],
  }));
  const singleRows: Row[] = singles.map((p) => {
    const parsed = parseOccSymbol(p.occSymbol);
    const label = parsed.ok ? `${parsed.value.strike}${parsed.value.type}` : p.occSymbol.trim();
    const dte = parsed.ok
      ? Math.max(0, Math.ceil((parsed.value.expiry.getTime() - Date.now()) / 86_400_000))
      : 0;
    return {
      key: p.occSymbol,
      label,
      expiry: formatExpiryCell({ kind: "single", occSymbol: p.occSymbol, dte }),
      legs: [p],
    };
  });
  return [...calRows, ...singleRows];
}

const COLS = ["Position", "Expiry / DTE", "Net val", "P&L / entry", "Δ", "Γ", "Θ/d", "Vega", "Verdict"] as const;

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
  ivNaByRowKey,
  verdictByRowKey,
  expandedRowKey,
  verdictObservedAt,
  verdictMarketSession,
  highlightedRowKey,
  onHoverRow,
  onSelectRow,
  excluded,
  onToggleExcluded,
}: {
  positions: ReadonlyArray<BrokerPositionResponse>;
  spot: number;
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  liveStatus: LiveStreamStatus;
  /** Rows whose calendar leg(s) genuinely did not converge (D-02) — renders "IV n/a". */
  ivNaByRowKey: ReadonlyMap<string, boolean>;
  /** Exit verdict per row, keyed by the row `label` (`${strike}${optionType}`) — the
   *  verdict-in-row join. Absent key → no verdict for that position (renders "—"). */
  verdictByRowKey: ReadonlyMap<string, HeldPositionVerdict>;
  /** The click-persisted selected row (drives the verdict-detail expand) — null when none. */
  expandedRowKey: string | null;
  /** Cohort instant + session for the expanded verdict detail's as-of dot / INDICATIVE label. */
  verdictObservedAt: string | null;
  verdictMarketSession: "rth" | "after-hours";
  /** The docked-table row currently hovered/selected (D-05) — null when none. */
  highlightedRowKey: string | null;
  onHoverRow: (key: string | null) => void;
  onSelectRow: (key: string) => void;
  /**
   * Excluded row keys (OVW-06) — controlled by `Overview`, the single lifted source of
   * truth. A position counts toward the Net total unless explicitly unchecked here.
   * Tracking exclusions (not inclusions) means new positions default to "included".
   * For calendar rows this SAME Set also drives the payoff-chart curves via
   * `buildCalendarPosition`'s `included` param — there is no second Set in this file.
   */
  excluded: ReadonlySet<string>;
  onToggleExcluded: (key: string) => void;
}): React.ReactElement {
  const rows = useMemo(() => buildRows(positions), [positions]);

  const isStale = liveStatus === "stalled";

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
          const ivNa = ivNaByRowKey.get(r.key) === true;
          const verdict = verdictByRowKey.get(r.label) ?? null;
          const expanded = expandedRowKey === r.key && verdict !== null;
          return (
            <Fragment key={r.key}>
            <tr
              data-testid={`position-row-${r.key}`}
              onMouseEnter={() => { onHoverRow(r.key); }}
              onMouseLeave={() => { onHoverRow(null); }}
              onClick={() => { onSelectRow(r.key); }}
              className={cn(
                "cursor-pointer border-b border-line/50 transition-opacity hover:bg-raise/30",
                !included && "opacity-40",
                highlightedRowKey === r.key && "bg-raise/20",
              )}
            >
              <td
                className="px-2 py-1 text-center"
                onClick={(e) => { e.stopPropagation(); }}
              >
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => { onToggleExcluded(r.key); }}
                  aria-label={`Include ${r.label} in risk profile & total`}
                  className="accent-blue cursor-pointer"
                />
              </td>
              {/* Position — static, no live-cell */}
              <td className="px-2 py-1 text-left text-txt">
                {r.label}
                {ivNa && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        style={{
                          display: "inline-flex",
                          marginLeft: 6,
                          verticalAlign: "middle",
                          cursor: "default",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                        }}
                      >
                        <Badge
                          variant="outline"
                          className="border-amber/50 px-1 py-0 font-mono text-[9px] text-amber"
                        >
                          IV n/a
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="font-mono text-xs text-muted-foreground">
                          IV n/a — did not converge. @exp shown; excluded from T+0.
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </td>
              {/* Expiry / DTE — static, no live-cell */}
              <td className="px-2 py-1 text-right">
                <div className="flex flex-col items-end">
                  <span className="text-[11px] text-muted-foreground">{r.expiry.line1}</span>
                  <span className="text-[9px] text-dim">{r.expiry.line2}</span>
                </div>
              </td>
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
              {/* Verdict — joined exit verdict for this calendar (static, no live-cell) */}
              <td className="px-2 py-1 text-right">
                {verdict !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    <VerdictChangedMarker row={verdict} />
                    <VerdictChip row={verdict} marketSession={verdictMarketSession} />
                  </span>
                ) : (
                  <span className="text-dim">—</span>
                )}
              </td>
            </tr>
            {expanded && verdict !== null && (
              <tr data-testid={`position-verdict-detail-${r.key}`}>
                <td className="px-2 pb-2" />
                <td className="px-2 pb-2" colSpan={COLS.length}>
                  <VerdictDetailBody row={verdict} observedAt={verdictObservedAt ?? ""} />
                </td>
              </tr>
            )}
            </Fragment>
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
          {/* Verdict column — no aggregate */}
          <td className="px-2 py-1" />
        </tr>
      </tbody>
    </table>
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
    // Near-term (≤45d DTE) set — the intraday-relevant walls when far-dated OI
    // dominates the all-expiry levels. Absent on pre-0019 snapshots.
    ...(gex.nearTerm !== null
      ? [
          { label: "Call Wall 45d", value: gex.nearTerm.callWall, colorClass: "text-up" },
          { label: "γ flip 45d", value: gex.nearTerm.flip, colorClass: "text-amber" },
          { label: "Put Wall 45d", value: gex.nearTerm.putWall, colorClass: "text-down" },
        ]
      : []),
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
              className="flex items-center justify-between gap-2 rounded-lg bg-raise/40 px-2.5 py-1 font-mono text-[10px] ring-1 ring-line"
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
  // 0DTE net gamma — today's expiry from the byExpiry rollup ($Bn/1% units)
  const zeroDte = gex !== undefined ? zeroDteGex(gex.byExpiry, gex.computedAt) : null;
  const vix = latestMacroValue(macro, "VIXCLS");
  const vvix = latestMacroValue(macro, "VVIX");
  const dff = latestMacroValue(macro, "DFF");
  const curveSlope = latestMacroValue(macro, "T10Y2Y");

  return (
    <div
      data-testid="pill-header"
      className="static lg:sticky lg:top-0 lg:z-10 -mx-4 border-b border-line bg-bg/90 px-4 py-2 lg:backdrop-blur"
    >
      {/* Mobile priority row (35-03) — SPX / net γ / VIX / book, one line, no wrap */}
      <div data-testid="pill-header-priority" className="flex flex-nowrap items-center gap-1 lg:hidden">
        <MetricChip
          label="SPX"
          value={gex !== undefined ? gex.spot.toFixed(1) : "—"}
          valueClassName="text-blue"
          className="px-2 py-1 gap-1"
        />
        <MetricChip
          label="net γ /1%"
          value={gex !== undefined ? fmtGammaCompact(gex.netGammaAtSpot) : "—"}
          alert={regime === "AMPLIFY"}
          valueClassName={regime === null ? "text-muted-foreground" : regime === "AMPLIFY" ? "text-down" : "text-up"}
          className="px-2 py-1 gap-1"
        />
        <MetricChip label="VIX" value={vix !== null ? vix.toFixed(2) : "—"} className="px-2 py-1 gap-1" />
        <MetricChip
          label="book"
          value={signedUsd(bookPnl, 0)}
          valueClassName={signClass(bookPnl)}
          className="ml-auto px-2 py-1 gap-1"
        />
      </div>

      {/* Mobile secondary ChipRail (35-03) — the other 6 metrics, scroll-snap, edge-peek */}
      <ChipRail ariaLabel="Additional market metrics" className="mt-2 lg:mt-0 lg:hidden">
        {/* 0DTE γ — today's expiry only (byExpiry rollup); "—" once it rolls off */}
        <MetricChip
          label="0DTE γ"
          value={zeroDte !== null ? fmtGammaCompact(zeroDte) : "—"}
          valueClassName={
            zeroDte === null ? "text-muted-foreground" : zeroDte < 0 ? "text-down" : "text-up"
          }
          className="snap-start shrink-0"
        />
        <MetricChip
          label="γ flip"
          value={gex !== undefined && gex.flip !== null ? gex.flip.toFixed(0) : "—"}
          valueClassName="text-amber"
          className="snap-start shrink-0"
        />
        <MetricChip label="VVIX" value={vvix !== null ? vvix.toFixed(1) : "—"} className="snap-start shrink-0" />
        <MetricChip
          label="Fed funds"
          value={dff !== null ? `${dff.toFixed(2)}%` : "—"}
          className="snap-start shrink-0"
        />
        <MetricChip
          label="10y−2y"
          value={curveSlope !== null ? `${curveSlope >= 0 ? "+" : ""}${curveSlope.toFixed(2)}` : "—"}
          valueClassName={curveSlope !== null ? signClass(curveSlope) : "text-muted-foreground"}
          className="snap-start shrink-0"
        />
        <MetricChip
          label="COT lev"
          value={cotLev !== null ? signed(cotLev, 0) : "—"}
          valueClassName={cotLev !== null ? signClass(cotLev) : "text-muted-foreground"}
          className="snap-start shrink-0"
        />
      </ChipRail>

      {/* Desktop full row — unchanged, all 10 chips, single flex-wrap row */}
      <div data-testid="pill-header-full" className="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-2">
        <MetricChip label="SPX" value={gex !== undefined ? gex.spot.toFixed(1) : "—"} valueClassName="text-blue" />
        <MetricChip
          label="net γ /1%"
          value={gex !== undefined ? fmtGammaCompact(gex.netGammaAtSpot) : "—"}
          alert={regime === "AMPLIFY"}
          valueClassName={regime === null ? "text-muted-foreground" : regime === "AMPLIFY" ? "text-down" : "text-up"}
        />
        {/* 0DTE γ — today's expiry only (byExpiry rollup); "—" once it rolls off */}
        <MetricChip
          label="0DTE γ"
          value={zeroDte !== null ? fmtGammaCompact(zeroDte) : "—"}
          valueClassName={
            zeroDte === null ? "text-muted-foreground" : zeroDte < 0 ? "text-down" : "text-up"
          }
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

  // ── Held positions + exit rules (moved from Analyzer, EXIT-07/EXIT-09/EXIT-10):
  // same D-18/D-19-style state precedence Analyzer used — loading → error → cold-start
  // (no verdicts computed anywhere yet) → empty (settled, zero open calendars) → loaded. ──
  const { data: exitsData, isPending: exitsIsPending, isError: exitsIsError, refetch: exitsRefetch } = useExits();
  const exitsSnapshot = exitsData ?? null;

  // ── Verdict-in-row join (overview-layout-redesign.md §Join design) ────────────
  // Deterministic, root-agnostic: key each loaded verdict by `${strike}${optionType}` and
  // look it up per positions row by its `label` (same format). A verdict with no live broker
  // row (closed calendar) is NEVER dropped — it falls to the "Unlinked verdicts" list below.
  const loadedVerdicts = exitsSnapshot?.positions ?? [];
  const verdictByRowKey = useMemo(
    () => new Map(loadedVerdicts.map((v) => [`${v.strike}${v.optionType}`, v])),
    [loadedVerdicts],
  );
  const rowLabels = useMemo(
    () => new Set(buildRows(positions).map((r) => r.label)),
    [positions],
  );
  const unlinkedVerdicts = useMemo(
    () => loadedVerdicts.filter((v) => !rowLabels.has(`${v.strike}${v.optionType}`)),
    [loadedVerdicts, rowLabels],
  );

  // Phase 12-07: live stream hook (D-06 — this surface only).
  // useLiveStream() is called once here and threaded into the payoff hero + docked table.
  // Overview and Analyzer never mount simultaneously (Shell renders one screen at a time)
  // so no second EventSource opens.
  const {
    greeks: liveGreeks,
    status: liveStatus,
    lastTickAt: liveLastTickAt,
    isRth: liveIsRth,
    hasReceivedFirstTick: liveHasReceivedFirstTick,
    isReconnecting: liveIsReconnecting,
    reconnectNow: liveReconnectNow,
  } = useLiveStream();

  // ── Payoff hero positions (calendars only — the scenario engine models calendar
  // spreads; singles remain table-only rows) ──────────────────────────────────
  const { calendars } = useMemo(
    () => pairPositionsIntoCalendars(positions, new Date()),
    [positions],
  );

  // OVW-06: single lifted source of truth for row inclusion. Feeds BOTH the payoff
  // chart (via buildCalendarPosition's `included` param below) AND PositionsTable's
  // checkbox/total/opacity (passed down as a controlled prop) — no second Set, no
  // syncing useEffect. Tracks EXCLUDED keys so new positions default to "included".
  const [excludedCalendars, setExcludedCalendars] = useState<ReadonlySet<string>>(new Set());
  const handleToggleExcludedCalendar = useCallback((key: string): void => {
    setExcludedCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Per-leg calibrated IV (OVW-02, D-01/D-02) — resolveLegIv per leg, never DEFAULT_IV
  // on this path (T-17-05). DEFAULT_IV remains only for netGreeksForLegs (the GEX rail's
  // Net book greeks tile, OQ2 recorded deferral).
  const calendarBuild = useMemo(
    () =>
      calendars.map((cal) =>
        buildCalendarPosition(cal, spot, liveGreeks, new Date(), !excludedCalendars.has(cal.key), gex),
      ),
    [calendars, spot, liveGreeks, excludedCalendars, gex],
  );
  const calendarPositions = useMemo<ReadonlyArray<AnalyzerPosition>>(
    () => calendarBuild.map((b) => b.position),
    [calendarBuild],
  );
  const ivNaByRowKey = useMemo(
    () => new Map(calendarBuild.map((b) => [b.position.id, b.ivNa])),
    [calendarBuild],
  );

  // OVW-05: TOS-style date picker — projects the today/date curve to a chosen future
  // date via the scenario engine's existing `daysForward` path. The @exp curve stays
  // fixed (D-01): `bookPLAtExpiry` structurally ignores `daysForward`, so no engine
  // change is needed here (locked by a characterization test in scenario-engine.test.ts).
  // A single stable `today` reference keeps re-renders/tests deterministic.
  const today = useMemo(() => new Date(), []);
  const bounds = useMemo(
    () =>
      computeProjectionBounds(
        calendarPositions
          .filter(
            (p) =>
              p.included &&
              p.frontIvStatus !== "non-convergent" &&
              p.backIvStatus !== "non-convergent",
          )
          .map((p) => p.frontDte),
        today,
      ),
    [calendarPositions, today],
  );
  // Forward date projection now lives in the shared hook (same behavior as the prior inline glue).
  const dateControl = usePayoffDateControl(today, bounds.maxDaysForward);

  // Series-visibility toggles — were a hardcoded const + static legend; now driven by the shared
  // PayoffControls chips. Defaults preserve the prior render exactly (fan off, the rest on).
  const [toggles, setToggles] = useState<PayoffChartToggles>({
    showFan: false,
    showExpiration: true,
    showWalls: true,
    showProfitZone: true,
  });
  const handleToggle = useCallback((key: keyof PayoffChartToggles): void => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ONE domain, computed from the FULL combined book (Pitfall 4: never a single-candidate
  // slice) — shared by the data grid (repriceScenario, both curves below) and the chart
  // scale (<PayoffChart domain=>) so neither clips relative to the other (Pitfall 1).
  const payoffDomain = useMemo(() => {
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return computePayoffDomain(calendarPositions, spot, params);
  }, [calendarPositions, spot, dateControl.daysForward]);

  const scenario = useMemo(() => {
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return repriceScenario(calendarPositions, params, payoffDomain);
  }, [calendarPositions, spot, dateControl.daysForward, payoffDomain]);

  const positionSetSignature = calendarPositions
    .map((p) => `${p.id}:${p.frontIvStatus ?? "ok"}:${p.backIvStatus ?? "ok"}:${p.included}`)
    .join("|");

  const noop = useCallback((): void => {}, []);

  const railGreeks = useMemo(() => {
    const allLegs = buildRows(positions).flatMap((r) => r.legs);
    return netGreeksForLegs(allLegs, spot);
  }, [positions, spot]);

  const bookPnl = useMemo(() => bookUnrealizedPnl(positions), [positions]);
  const cotLev = cot?.[0]?.netLeveraged ?? null;

  // ── Row highlight (D-05) — transient hover id + persisted click-toggle id,
  // mirroring AdHocPicker's clearHovered pattern. ──────────────────────────────
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const highlightedRowKey = hoveredRowKey ?? selectedRowKey;

  const handleHoverRow = useCallback((key: string | null): void => { setHoveredRowKey(key); }, []);
  const handleSelectRow = useCallback((key: string): void => {
    setSelectedRowKey((prev) => (prev === key ? null : key));
  }, []);

  const highlightedPosition = calendarPositions.find((p) => p.id === highlightedRowKey) ?? null;
  const highlightedScenario = useMemo(() => {
    if (highlightedPosition === null) return null;
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return repriceScenario([highlightedPosition], params, payoffDomain);
  }, [highlightedPosition, spot, dateControl.daysForward, payoffDomain]);

  const excludedFromT0 = t0ExcludedPositions(calendarPositions);

  // ── Staleness (D-03/D-04) — two independent channels, same visual grammar. ──
  const gexTs = gex !== undefined ? new Date(gex.computedAt) : null;
  const gexAgeMs = gexTs !== null ? Date.now() - gexTs.getTime() : null;
  const gexFresh = gexAgeMs !== null && gexAgeMs < GEX_FRESH_MS;
  const gexAsOf =
    gexTs !== null
      ? gexTs.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  const markAgeMs = liveLastTickAt !== null ? Date.now() - liveLastTickAt.getTime() : null;
  const markFresh = markAgeMs !== null && markAgeMs <= LIVE_MARK_FRESH_MS;
  const markAsOf =
    liveLastTickAt !== null
      ? liveLastTickAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  // Exit-advisor status / unlinked verdicts — rendered UNDER the positions table. The loaded
  // verdicts join into the table's VERDICT column above; this surfaces the advisor's non-loaded
  // states (loading/error/cold-start/empty, same copy the moved-from-Analyzer panel used) and,
  // once loaded, any verdict with no live broker row (never silently dropped).
  let exitsBody: React.ReactElement | null;
  if (exitsIsPending && exitsData === undefined) {
    exitsBody = (
      <div
        className="font-mono text-[10px] text-dim"
        data-testid="held-positions-loading"
      >
        Loading exit verdicts…
      </div>
    );
  } else if (exitsIsError) {
    exitsBody = (
      <div className="flex items-center gap-2" data-testid="held-positions-error">
        <p className="m-0 font-mono text-[12px] text-down">Couldn&apos;t load exit verdicts.</p>
        <Button
          onClick={() => {
            void exitsRefetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (exitsSnapshot === null) {
    exitsBody = (
      <div className="flex flex-col gap-1.5" data-testid="held-positions-cold-start">
        <p className="m-0 font-display text-sm font-bold text-txt">Exit advisor warming up</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          First verdict pending — check back after the next chain snapshot.
        </p>
      </div>
    );
  } else if (exitsSnapshot.positions.length === 0) {
    exitsBody = (
      <div className="flex flex-col gap-1.5" data-testid="held-positions-empty">
        <p className="m-0 font-display text-sm font-bold text-txt">No open positions</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          Nothing to advise on — the exit advisor activates once you have an open calendar.
        </p>
      </div>
    );
  } else if (unlinkedVerdicts.length > 0) {
    exitsBody = (
      <HeldPositionsPanel
        positions={unlinkedVerdicts}
        observedAt={exitsSnapshot.observedAt}
        marketSession={exitsSnapshot.marketSession}
        title="Unlinked verdicts"
      />
    );
  } else {
    exitsBody = null;
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <PillHeader gex={gex} cotLev={cotLev} macro={macro} bookPnl={bookPnl} />

      {/* ── Three-column Launchpad shell: MarketRail (left) / hero + positions (center) /
          GEX rail (right). Mobile stacks in DOM order: rail → hero → positions → GEX. ── */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:items-start">
        {/* LEFT — persistent market context rail (order-2 below lg: paints after the hero) */}
        <MarketRail className="order-2 lg:order-1" />

        {/* CENTER — payoff hero + docked positions table + exit-advisor status */}
        <div data-testid="overview-center-column" className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          {/* Payoff hero */}
          <Panel>
            <PanelHeading
              className="flex-wrap"
              title="Risk profile — combined book"
              badge={
                <div className="flex flex-wrap items-center gap-2">
                  {gex !== undefined && (
                    <div
                      className="flex items-center gap-1.5 rounded-md bg-raise/40 px-2.5 py-1 font-mono text-[10px] ring-1 ring-line"
                      data-testid="gex-freshness"
                    >
                      <span className={cn("size-1.5 rounded-full", gexFresh ? "bg-up" : "bg-amber")} />
                      <span className="text-dim">GEX as of</span>
                      <span className="text-txt">{gexAsOf}</span>
                      {gexAgeMs !== null && (
                        <span className={gexFresh ? "text-up" : "text-amber"}>· {relAge(gexAgeMs)}</span>
                      )}
                    </div>
                  )}
                  <div
                    className="flex items-center gap-1.5 rounded-md bg-raise/40 px-2.5 py-1 font-mono text-[10px] ring-1 ring-line"
                    data-testid="live-mark-freshness"
                  >
                    <span className={cn("size-1.5 rounded-full", markFresh ? "bg-up" : "bg-amber")} />
                    <span className="text-dim">mark as of</span>
                    <span className="text-txt">{markAsOf}</span>
                    {markAgeMs !== null && (
                      <span className={markFresh ? "text-up" : "text-amber"}>· {relAge(markAgeMs)}</span>
                    )}
                  </div>
                </div>
              }
              action={<span className="hidden font-mono text-[10px] text-dim lg:inline">view-only · Analyzer →</span>}
            />
            {/* OVW-05 + follow-on: shared control strip — forward date projection (projects
                scenario.payoffCurve via daysForward; @exp unaffected, D-01) + series toggles.
                The static legend it replaced is now the interactive toggle chips. */}
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
            {/* Curve-color key (T+0 / @exp / γ flip / call wall / put wall) — MORAI
                violet/gray palette, not TOS neon (OVW-04). The toggle chips above
                control visibility; this maps color → meaning (31-01: replaces the
                removed in-chart wall/flip text labels — KISS collision fix). */}
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
                call wall
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3.5 rounded-full bg-down" />
                put wall
              </span>
            </div>
            {/* MORAI default curve palette (violet T+0 / gray @exp) — same as the Analyzer's
                PayoffChart, which passes neither color prop. The TOS graph *logic* (combined
                curve, date projection, axis scaling) is emulated; the TOS neon palette is
                intentionally not (OVW-04, user decision — MORAI look, TOS behavior). */}
            {/* Full-bleed below lg (negates Panel's p-3 horizontal inset); reverts at lg */}
            <div data-testid="payoff-chart-bleed" className="-mx-3 lg:mx-0">
              <PayoffChart
                todayCurve={scenario.payoffCurve}
                fanCurves={[]}
                expirationCurve={scenario.expirationCurve}
                rollCurve={null}
                gex={gex !== undefined ? { callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip } : null}
                domain={payoffDomain}
                spot={spot}
                toggles={toggles}
                fitY={false}
                onFitYConsumed={noop}
                positionSetSignature={positionSetSignature}
                baseExpirationCurve={scenario.expirationCurve}
                highlightedPositionId={highlightedRowKey}
                highlightedTodayCurve={highlightedScenario?.payoffCurve ?? null}
                highlightedExpirationCurve={highlightedScenario?.expirationCurve ?? null}
                excludedFromT0Count={excludedFromT0.count}
              />
            </div>
          </Panel>

          {/* Docked positions table — verdicts join into the VERDICT column; the exit-rules
              ladder opens from the header dialog button */}
          <Panel>
            <PanelHeading
              title="Positions"
              badge={
                <LiveStatusBadge
                  status={liveStatus}
                  lastTickAt={liveLastTickAt}
                  isRth={liveIsRth}
                  hasReceivedFirstTick={liveHasReceivedFirstTick}
                  isReconnecting={liveIsReconnecting}
                  onReconnect={liveReconnectNow}
                />
              }
              action={
                exitsSnapshot !== null && (
                  <Dialog>
                    <DialogTrigger
                      data-testid="exit-rules-trigger"
                      className="rounded-md bg-raise/40 px-2.5 py-1 font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase ring-1 ring-line hover:text-txt"
                    >
                      Exit rules ▸
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <ExitRulesPanel ruleSet={exitsSnapshot.ruleSet} />
                    </DialogContent>
                  </Dialog>
                )
              }
            />
            <PositionsTable
              positions={positions}
              spot={spot}
              liveGreeks={liveGreeks}
              liveStatus={liveStatus}
              ivNaByRowKey={ivNaByRowKey}
              verdictByRowKey={verdictByRowKey}
              expandedRowKey={selectedRowKey}
              verdictObservedAt={exitsSnapshot?.observedAt ?? null}
              verdictMarketSession={exitsSnapshot?.marketSession ?? "rth"}
              highlightedRowKey={highlightedRowKey}
              onHoverRow={handleHoverRow}
              onSelectRow={handleSelectRow}
              excluded={excludedCalendars}
              onToggleExcluded={handleToggleExcludedCalendar}
            />
          </Panel>

          {/* Exit-advisor status / unlinked verdicts — under the table */}
          {exitsBody}
        </div>

        {/* RIGHT — GEX rail (untouched) */}
        <div data-testid="overview-gex-column" className="order-3 flex flex-col gap-3">
          <GexRail gex={gex} railGreeks={railGreeks} />
        </div>
      </div>
    </div>
  );
}
