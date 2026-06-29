import { useMemo, useState } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useStatus } from "../hooks/useStatus.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { Market } from "./Market.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { Panel, SectionLabel, Stat } from "../components/system/index.tsx";
import { ComingSoon } from "../components/stubs/ComingSoon.tsx";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse } from "@morai/contracts";
import type { StreamLiveGreekEvent } from "@morai/contracts";

/**
 * Overview — the home dashboard, three sections (UI directive 2026-06-28):
 *   1. Open positions — a TOS-style table of every position + net greeks.
 *      Phase 12-07: live SSE overlay (STRM-01) + LiveStatusBadge (D-04, Surface 3).
 *   2. Market — dealer positioning (live GEX/OI/Volume) + CFTC COT + FRED macro
 *      (COT/FRED are "needs feed" stubs until Phases 13/14 ship the ingestion).
 *   3. Book & system — larger, easy-to-read summary boxes.
 *
 * Greeks use the BSM engine at a flat DEFAULT_IV (no per-contract chain IV here) — the
 * same approximation the Positions deep-dive uses. Live spot comes from the GEX snapshot.
 *
 * D-06 constraint: exactly one live-stream consumer on this surface. useLiveStream()
 * is called here and threaded into PositionsTable — NOT into BookSummary or any other
 * section. AdHocPicker / SC6 stays on Analyzer (already wired + functional).
 */

const DEFAULT_IV = 0.18;
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

/** Sum position greeks across legs, scaled to position terms (per-share × netQty × 100).
 *  Used for the static BookSummary section — NOT for the live-overlaid PositionsTable. */
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
    const nq = (leg.longQty - leg.shortQty) * 100;
    acc.delta += r.value.greeks.delta * nq;
    acc.gamma += r.value.greeks.gamma * nq;
    acc.theta += r.value.greeks.theta * nq;
    acc.vega += r.value.greeks.vega * nq;
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

// ─── Section 1: positions table ───────────────────────────────────────────────

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
 * PositionsTable — TOS-style positions table with live BSM greek overlay.
 *
 * Phase 12-07 extensions (STRM-01 / D-04 / Surface 2):
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

// ─── Section 3: book summary ──────────────────────────────────────────────────

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

// ─── Overview ─────────────────────────────────────────────────────────────────

export function Overview(): React.ReactElement {
  const { data: posData } = usePositions();
  const { data: gex } = useGex();
  const positions = posData?.positions ?? [];
  const spot = gex?.spot ?? 5800;

  // Phase 12-07: live stream hook (D-06 — this surface only).
  // useLiveStream() is called once here and threaded into PositionsTable.
  // Overview and Analyzer never mount simultaneously (ShellWithRouter renders one screen)
  // so no second EventSource opens.
  const {
    greeks: liveGreeks,
    status: liveStatus,
    lastTickAt: liveLastTickAt,
  } = useLiveStream();

  return (
    <div className="mx-auto flex max-w-[1480px] flex-col gap-5 p-3.5">
      {/* ── Section 1: Open positions ── */}
      <section>
        {/* Surface 3 (D-04): LiveStatusBadge beside the section header — one place only. */}
        <div className="mb-2 flex items-center gap-2">
          <SectionLabel>Open positions · greeks</SectionLabel>
          <LiveStatusBadge status={liveStatus} lastTickAt={liveLastTickAt} />
        </div>
        <Panel>
          <PositionsTable
            positions={positions}
            spot={spot}
            liveGreeks={liveGreeks}
            liveStatus={liveStatus}
          />
        </Panel>
      </section>

      {/* ── Section 2: Market — positioning & macro ── */}
      <section>
        <SectionLabel className="mb-2">Market · what the big guys are doing & macro</SectionLabel>
        {/* Dealer positioning — live GEX / OI wall / Volume for SPX */}
        <Market />
        {/* CFTC COT + FRED macro — separated, awaiting ingestion (Phases 13/14) */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <ComingSoon
            badge="○ needs feed"
            title="CFTC COT — dealer & spec positioning"
            body="Weekly Commitments of Traders (E-mini S&P 500). Net non-commercial vs commercial positioning — what the big guys hold. Wired in Phase 13."
            minHeight={120}
          />
          <ComingSoon
            badge="○ needs feed"
            title="FRED macro"
            body="Rates, curves & vol regime (DFF · SOFR · T10Y2Y · VIX · VVIX). The macro backdrop. Wired in Phase 14."
            minHeight={120}
          />
        </div>
      </section>

      {/* ── Section 3: Book & system — larger, easy-to-read ── */}
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
