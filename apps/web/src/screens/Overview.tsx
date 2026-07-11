import { Fragment, useMemo } from "react";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signed, signedUsd, signClass } from "../lib/position-format.ts";
import { classifyRegime, zeroDteGex } from "../lib/gex-regime.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { relAge } from "./Market.tsx";
import {
  useOverviewModel,
  buildRows,
  keyLevelsFor,
  fmtGammaCompact,
  latestMacroValue,
} from "./overview-mobile/useOverviewModel.ts";
import type { NetGreeks } from "./overview-mobile/useOverviewModel.ts";
import { OverviewMobile } from "./overview-mobile/OverviewMobile.tsx";
import { useIsDesktop } from "../hooks/useIsDesktop.ts";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { PositionCard } from "../components/PositionCard.tsx";
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
import type { BrokerPositionResponse, GexSnapshotEntry, MacroResponse } from "@morai/contracts";
import type { StreamLiveGreekEvent, HeldPositionVerdict } from "@morai/contracts";

// 35.1 D-02: moved to useOverviewModel.ts — re-exported so existing imports keep
// resolving (the EDGE_ARROW_LANE_Y precedent in PayoffChart.tsx).
export { formatExpiryCell, buildCalendarPosition } from "./overview-mobile/useOverviewModel.ts";

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
 * D-06 constraint: exactly one live-stream consumer on this surface. useLiveStream()
 * is called (inside useOverviewModel) and threaded into the payoff hero + docked
 * positions table only. AdHocPicker / SC6 stays on Analyzer.
 *
 * 35.1 D-02: ALL state/derivation (data hooks, live stream, calendar builds, scenario,
 * toggles, hover, freshness) lives in useOverviewModel.ts — this file keeps the desktop
 * view components (PillHeader / PositionsTable / GexRail) and the screen JSX.
 */

// ─── Positions table (docked, TOS-style) ──────────────────────────────────────

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
    <>
    <table className="hidden w-full border-collapse font-mono text-[11px] tabular-nums lg:table">
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
    {/* Mobile card list (35-04) — same rows, display:none paired with the table above so a
        screen reader never announces a position twice. */}
    <div data-testid="positions-card-list" className="flex flex-col gap-2 lg:hidden">
      {rows.map((r) => {
        const included = !excluded.has(r.key);
        const ivNa = ivNaByRowKey.get(r.key) === true;
        const verdict = verdictByRowKey.get(r.label) ?? null;
        // Un-gated by verdict — the greeks grid is the ONLY way to see Δ/Γ/Θ/Vega on mobile,
        // unlike the desktop table's verdict-detail-row gate above (which has nothing else to show).
        const expanded = expandedRowKey === r.key;
        return (
          <PositionCard
            key={r.key}
            row={r}
            spot={spot}
            liveGreeks={liveGreeks}
            ivNa={ivNa}
            verdict={verdict}
            marketSession={verdictMarketSession}
            expanded={expanded}
            onSelect={onSelectRow}
            included={included}
            onToggleIncluded={onToggleExcluded}
          />
        );
      })}
    </div>
    </>
  );
}

// ─── GEX rail (320px, right column) ───────────────────────────────────────────

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

/** The thin root switch (35.1 D-01, UI-SPEC §1): exactly ONE tree mounts per viewport
 *  state, so useOverviewModel's useLiveStream call stays the single stream consumer. */
export function Overview(): React.ReactElement {
  const isDesktop = useIsDesktop();
  return isDesktop ? <OverviewDesktop /> : <OverviewMobile />;
}

function OverviewDesktop(): React.ReactElement {
  // 35.1 D-02: the shared model hook owns ALL state/derivation. Locals are destructured
  // to the pre-extraction names so the JSX below stays byte-identical to the pre-35.1
  // render — same elements, classes, testids, order.
  const {
    positions,
    spot,
    gex,
    macro,
    cotLev,
    bookPnl,
    liveGreeks,
    liveStatus,
    liveBadgeProps,
    ivNaByRowKey,
    verdictByRowKey,
    unlinkedVerdicts,
    exits,
    scenario,
    payoffDomain,
    positionSetSignature,
    excludedFromT0Count,
    toggles,
    handleToggle,
    dateControl,
    bounds,
    excluded: excludedCalendars,
    handleToggleExcluded: handleToggleExcludedCalendar,
    selectedRowKey,
    handleSelectRow,
    hover,
    freshness,
    railGreeks,
    noop,
  } = useOverviewModel();
  const {
    snapshot: exitsSnapshot,
    isPending: exitsIsPending,
    isError: exitsIsError,
    refetch: exitsRefetch,
    dataIsUndefined: exitsDataIsUndefined,
  } = exits;
  const { highlightedRowKey, handleHoverRow, highlightedScenario } = hover;
  const { gexFresh, gexAsOf, gexAgeMs, markFresh, markAsOf, markAgeMs } = freshness;
  const {
    lastTickAt: liveLastTickAt,
    isRth: liveIsRth,
    hasReceivedFirstTick: liveHasReceivedFirstTick,
    isReconnecting: liveIsReconnecting,
    onReconnect: liveReconnectNow,
  } = liveBadgeProps;

  // Exit-advisor status / unlinked verdicts — rendered UNDER the positions table. The loaded
  // verdicts join into the table's VERDICT column above; this surfaces the advisor's non-loaded
  // states (loading/error/cold-start/empty, same copy the moved-from-Analyzer panel used) and,
  // once loaded, any verdict with no live broker row (never silently dropped).
  let exitsBody: React.ReactElement | null;
  if (exitsIsPending && exitsDataIsUndefined) {
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
                excludedFromT0Count={excludedFromT0Count}
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
