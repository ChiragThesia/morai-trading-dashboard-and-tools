import { useMemo } from "react";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import { useStatus } from "../hooks/useStatus.ts";
import { computePositionGreeks } from "../lib/position-greeks.ts";
import { pairPositionsIntoCalendars } from "../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { Market } from "./Market.tsx";
import { Panel, SectionLabel, Stat } from "../components/system/index.tsx";
import { ComingSoon } from "../components/stubs/ComingSoon.tsx";
import { cn } from "@/lib/utils";
import type { BrokerPositionResponse } from "@morai/contracts";

/**
 * Overview — the home dashboard, three sections (UI directive 2026-06-28):
 *   1. Open positions — a TOS-style table of every position + net greeks.
 *   2. Market — dealer positioning (live GEX/OI/Volume) + CFTC COT + FRED macro
 *      (COT/FRED are "needs feed" stubs until Phases 13/14 ship the ingestion).
 *   3. Book & system — larger, easy-to-read summary boxes.
 *
 * Greeks use the BSM engine at a flat DEFAULT_IV (no per-contract chain IV here) — the
 * same approximation the Positions deep-dive uses. Live spot comes from the GEX snapshot.
 */

const DEFAULT_IV = 0.18;
const DEFAULT_RATE = 0.045;
const DEFAULT_DIV = 0.013;

type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

/** Sum position greeks across legs, scaled to position terms (per-share × netQty × 100). */
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

/** Σ marketValue across legs (signed — broker marks). */
function netValue(legs: ReadonlyArray<BrokerPositionResponse>): number {
  return legs.reduce((s, l) => s + (l.marketValue ?? 0), 0);
}

/** Σ unrealized P&L across legs (marketValue − avgPrice·netQty·100). */
function netUnreal(legs: ReadonlyArray<BrokerPositionResponse>): number | null {
  let total = 0;
  for (const l of legs) {
    if (l.marketValue === null || l.averagePrice === null) return null;
    total += l.marketValue - l.averagePrice * (l.longQty - l.shortQty) * 100;
  }
  return total;
}

function signed(v: number, decimals = 0): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}${Math.abs(v).toFixed(decimals)}`;
}

function signedUsd(v: number): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}$${Math.abs(v).toFixed(0)}`;
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

function PositionsTable({
  positions,
  spot,
}: {
  positions: ReadonlyArray<BrokerPositionResponse>;
  spot: number;
}): React.ReactElement {
  const rows = useMemo(() => buildRows(positions), [positions]);
  const total = useMemo(() => {
    const allLegs = rows.flatMap((r) => r.legs);
    return {
      val: netValue(allLegs),
      unreal: netUnreal(allLegs),
      greeks: netGreeksForLegs(allLegs, spot),
    };
  }, [rows, spot]);

  if (rows.length === 0) {
    return (
      <p className="font-mono text-[11px] text-dim">
        No open positions. Register a calendar via the API or paste a TOS order in the Analyzer.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
      <thead>
        <tr>
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
          const g = netGreeksForLegs(r.legs, spot);
          const val = netValue(r.legs);
          const unreal = netUnreal(r.legs);
          return (
            <tr key={r.key} className="border-b border-line/50">
              <td className="px-2 py-1 text-left text-txt">{r.label}</td>
              <td className="px-2 py-1 text-right text-muted-foreground">{r.dte}</td>
              <td className="px-2 py-1 text-right text-txt">${val.toFixed(0)}</td>
              <td className={cn("px-2 py-1 text-right", unreal === null ? "text-dim" : signClass(unreal))}>
                {unreal === null ? "—" : signedUsd(unreal)}
              </td>
              <td className={cn("px-2 py-1 text-right", signClass(g.delta))}>{signed(g.delta)}</td>
              <td className="px-2 py-1 text-right text-muted-foreground">{g.gamma.toFixed(2)}</td>
              <td className={cn("px-2 py-1 text-right", signClass(g.theta))}>{signedUsd(g.theta)}</td>
              <td className={cn("px-2 py-1 text-right", signClass(g.vega))}>{signedUsd(g.vega)}</td>
            </tr>
          );
        })}
        <tr className="border-t border-line font-semibold">
          <td className="px-2 py-1 text-left text-txt">Net</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-right text-txt">${total.val.toFixed(0)}</td>
          <td className={cn("px-2 py-1 text-right", total.unreal === null ? "text-dim" : signClass(total.unreal))}>
            {total.unreal === null ? "—" : signedUsd(total.unreal)}
          </td>
          <td className={cn("px-2 py-1 text-right", signClass(total.greeks.delta))}>{signed(total.greeks.delta)}</td>
          <td className="px-2 py-1 text-right text-muted-foreground">{total.greeks.gamma.toFixed(2)}</td>
          <td className={cn("px-2 py-1 text-right", signClass(total.greeks.theta))}>{signedUsd(total.greeks.theta)}</td>
          <td className={cn("px-2 py-1 text-right", signClass(total.greeks.vega))}>{signedUsd(total.greeks.vega)}</td>
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
      <Stat label="Net Γ" value={g.gamma.toFixed(2)} />
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

  return (
    <div className="mx-auto flex max-w-[1480px] flex-col gap-5 p-3.5">
      {/* ── Section 1: Open positions ── */}
      <section>
        <SectionLabel className="mb-2">Open positions · greeks</SectionLabel>
        <Panel>
          <PositionsTable positions={positions} spot={spot} />
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
