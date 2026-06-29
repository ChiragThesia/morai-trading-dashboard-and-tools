import { useState } from "react";
import { useGex } from "../hooks/useGex.ts";
import { classifyRegime } from "../lib/gex-regime.ts";
import { GexBars } from "../components/charts/GexBars.tsx";
import type { StrikeRange } from "../components/charts/GexBars.tsx";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { MetricChip, Panel, PanelHeading } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";

/**
 * Market — Market structure screen (Plan 08).
 *
 * UI-SPEC "Market screen":
 *   - Regime strip: SPX spot (blue) / net γ /1% (coral when negative, blood-dark bg) /
 *     γ flip (amber) / AMPLIFY|DAMPEN via classifyRegime
 *   - 12-col grid:
 *       col-span-4 ×3: GEX / OI wall / Volume by strike (three locked GexBars, no picker)
 *       col-span-12: Key levels (pill row — call wall / γ flip / spot / put wall + distance)
 *
 * Data: useGex() only — no browser-side GEX recompute (D-01).
 * Empty state: "GEX data unavailable — run fetch-chain to populate." (locked copy).
 * No any/as/! — all types from GexSnapshotEntry.
 *
 * Visual anchor: Net Dealer Gamma Profile (span 7) — highest visual weight.
 *
 * Styling is design-system only (tokens + Tailwind), no inline color/font. Layout-only
 * inline styles (grid span, fixed chart px) remain.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compact number formatter: $1.2B / $47M / $1.2K */
function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Human relative age for the GEX freshness badge. */
function relAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** GEX freshness — green dot when computed within the last fetch cycle, amber when stale. */
const GEX_FRESH_MS = 35 * 60 * 1000; // chain refreshes every 30 min during RTH

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CardProps {
  heading: string;
  badge?: string;
  children: React.ReactNode;
  colSpan?: number;
  minHeight?: number;
}

/**
 * Card container per UI-SPEC — Panel surface (gradient + ring) with a PanelHeading.
 * Layout-only props (grid span, min height) stay as inline style.
 */
function Card({
  heading,
  badge,
  children,
  colSpan = 1,
  minHeight,
}: CardProps): React.ReactElement {
  return (
    <Panel
      className="flex flex-col gap-2"
      style={{
        gridColumn: `span ${colSpan}`,
        minHeight: minHeight !== undefined ? `${minHeight}px` : undefined,
      }}
    >
      <PanelHeading
        className="mb-0"
        title={heading}
        badge={
          badge !== undefined ? (
            <span className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim">
              {badge}
            </span>
          ) : undefined
        }
      />
      {children}
    </Panel>
  );
}

// ─── Key levels table ─────────────────────────────────────────────────────────

interface KeyLevel {
  label: string;
  value: number | null;
  colorClass: string;
}

interface KeyLevelsTableProps {
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}

function KeyLevelsTable({
  spot,
  flip,
  callWall,
  putWall,
}: KeyLevelsTableProps): React.ReactElement {
  const levels: ReadonlyArray<KeyLevel> = [
    { label: "Call Wall", value: callWall, colorClass: "text-up" },
    { label: "γ flip", value: flip, colorClass: "text-amber" },
    { label: "Spot", value: spot, colorClass: "text-blue" },
    { label: "Put Wall", value: putWall, colorClass: "text-down" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {levels.map((lvl) => {
        const dist = lvl.value !== null ? Math.round(lvl.value - spot) : null;
        const distStr =
          dist !== null ? `${dist >= 0 ? "+" : ""}${dist} pts` : "—";
        const valStr = lvl.value !== null ? lvl.value.toFixed(0) : "—";

        return (
          <div
            key={lvl.label}
            className="flex items-center gap-1.5 rounded-md bg-raise/40 px-2.5 py-1 font-mono text-[10px] tabular-nums ring-1 ring-line"
          >
            <span className={cn(lvl.colorClass, "font-display text-[10px] font-semibold tracking-[0.09em] uppercase")}>
              {lvl.label}
            </span>
            <span className="text-txt">{valStr}</span>
            <span className="text-dim">{distStr}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Market screen ────────────────────────────────────────────────────────────

/**
 * Market — renders dealer-gamma market structure from the live GEX snapshot.
 *
 * No browser-side GEX computation (D-01 — GEX is server-computed and cached).
 * Coming-soon stubs: Charm/Vanna ("○ next") + Intraday flow ("○ needs denser snapshots").
 */
export function Market(): React.ReactElement {
  const { data: gex } = useGex();

  // Strike window shared by the three by-strike charts (ATM ± N strikes).
  const [range, setRange] = useState<StrikeRange>(20);
  const handleRange = (v: string): void => {
    setRange(v === "all" ? "all" : Number(v));
  };

  // ── Empty / error state ──────────────────────────────────────────────────────
  if (gex === undefined) {
    return (
      <div
        className="p-8 text-center font-mono text-xs text-dim"
        data-testid="market-empty"
      >
        {/* Locked copy from UI-SPEC "Empty / loading / error states" */}
        GEX data unavailable — run fetch-chain to populate.
      </div>
    );
  }

  // ── Regime classification ────────────────────────────────────────────────────
  const regime = classifyRegime(gex.netGammaAtSpot);
  const isAmplify = regime === "AMPLIFY";

  const netGammaLabel = fmtDollar(gex.netGammaAtSpot) + " /1%";
  const flipLabel = gex.flip !== null ? gex.flip.toFixed(0) : "—";

  // Sign-color class: coral (AMPLIFY / net short gamma) vs teal (DAMPEN / net long).
  const signClass = isAmplify ? "text-down" : "text-up";

  // Regime chip
  const regimeLabel = isAmplify ? "▼ AMPLIFY" : "▲ DAMPEN";

  // GEX freshness — snapshot recomputes every 30 min during RTH; stale off-hours / on a feed gap.
  const gexTs = new Date(gex.computedAt);
  const gexAgeMs = Date.now() - gexTs.getTime();
  const gexFresh = gexAgeMs < GEX_FRESH_MS;
  const gexAsOf = gexTs.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto box-border flex max-w-[1480px] flex-col gap-3 p-[14px]">
      {/* ── Regime strip (4 chips, full width) ── */}
      <div className="flex flex-wrap gap-2" data-testid="regime-strip">
        {/* SPX spot (blue) */}
        <MetricChip
          label="SPX spot"
          value={gex.spot.toFixed(2)}
          valueClassName="text-blue"
        />
        {/* net γ /1% (coral when negative with blood-dark bg) */}
        <MetricChip
          label="net γ /1%"
          value={netGammaLabel}
          alert={isAmplify}
          valueClassName={signClass}
        />
        {/* γ flip (amber) */}
        <MetricChip label="γ flip" value={flipLabel} valueClassName="text-amber" />
        {/* Regime label: AMPLIFY or DAMPEN */}
        <MetricChip
          label="regime"
          value={regimeLabel}
          alert={isAmplify}
          valueClassName={signClass}
        />
        {/* GEX freshness — "as of <time> · <age>"; amber dot when stale (off-hours / feed gap) */}
        <div
          className="flex items-center gap-1.5 rounded-md bg-raise/40 px-2.5 py-1 font-mono text-[10px] ring-1 ring-line"
          data-testid="gex-freshness"
        >
          <span className={cn("size-1.5 rounded-full", gexFresh ? "bg-up" : "bg-amber")} />
          <span className="text-dim">GEX as of</span>
          <span className="text-txt">{gexAsOf}</span>
          <span className={gexFresh ? "text-up" : "text-amber"}>· {relAge(gexAgeMs)}</span>
        </div>
      </div>

      {/* ── Strike-window picker (shared by the three by-strike charts) ── */}
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
          Strike window
        </span>
        <Tabs value={String(range)} onValueChange={handleRange}>
          <TabsList aria-label="Strike window around spot">
            <TabsTrigger value="5">±5</TabsTrigger>
            <TabsTrigger value="10">±10</TabsTrigger>
            <TabsTrigger value="20">±20</TabsTrigger>
            <TabsTrigger value="40">±40</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ── 12-column grid ── */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(12, 1fr)" }}
      >
        {/* GEX / OI wall / Volume by strike — three separate locked charts (no tab picker) */}
        <Card heading="GEX by strike" badge="$Bn · live" colSpan={4}>
          <GexBars
            mode="gex"
            range={range}
            strikes={gex.strikes}
            spot={gex.spot}
            callWall={gex.callWall}
            putWall={gex.putWall}
            height={320}
          />
        </Card>

        <Card heading="OI wall by strike" badge="call/put OI · live" colSpan={4}>
          <GexBars
            mode="oi"
            range={range}
            strikes={gex.strikes}
            spot={gex.spot}
            callWall={gex.callWall}
            putWall={gex.putWall}
            height={320}
          />
        </Card>

        <Card heading="Volume by strike" badge="contracts · live" colSpan={4}>
          <GexBars
            mode="volume"
            range={range}
            strikes={gex.strikes}
            spot={gex.spot}
            callWall={gex.callWall}
            putWall={gex.putWall}
            height={320}
          />
        </Card>

        {/* Key levels — full-width pill row */}
        <Card heading="Key levels" badge="distance to spot" colSpan={12}>
          <KeyLevelsTable
            spot={gex.spot}
            flip={gex.flip}
            callWall={gex.callWall}
            putWall={gex.putWall}
          />
        </Card>
      </div>
    </div>
  );
}
