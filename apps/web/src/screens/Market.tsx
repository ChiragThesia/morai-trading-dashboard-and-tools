import { useGex } from "../hooks/useGex.ts";
import { classifyRegime } from "../lib/gex-regime.ts";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { GexByExpiry } from "../components/charts/GexByExpiry.tsx";
import { ComingSoon } from "../components/stubs/ComingSoon.tsx";
import { MetricChip, Panel, PanelHeading } from "../components/system/index.tsx";
import { cn } from "@/lib/utils";

/**
 * Market — Market structure screen (Plan 08).
 *
 * UI-SPEC "Market screen":
 *   - Regime strip: SPX spot (blue) / net γ /1% (coral when negative, blood-dark bg) /
 *     γ flip (amber) / AMPLIFY|DAMPEN via classifyRegime
 *   - 12-col grid:
 *       col-span-7: Net dealer gamma profile (GammaProfile visx, 720×230)
 *       col-span-5: GEX by strike (GexBars ECharts)
 *       col-span-4: Key levels table
 *       col-span-4: GEX by expiry (GexByExpiry ECharts)
 *       col-span-4: Charm/Vanna coming-soon stub ("○ next")
 *       col-span-4: Intraday flow coming-soon stub ("○ needs denser snapshots")
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
    <div className="flex flex-col gap-1">
      {levels.map((lvl) => {
        const dist = lvl.value !== null ? Math.round(lvl.value - spot) : null;
        const distStr =
          dist !== null ? `${dist >= 0 ? "+" : ""}${dist} pts` : "—";
        const valStr = lvl.value !== null ? lvl.value.toFixed(0) : "—";

        return (
          <div
            key={lvl.label}
            className="flex items-center justify-between border-b border-line py-0.5 font-mono text-[10px] tabular-nums"
          >
            <span className={cn(lvl.colorClass, "font-semibold")}>
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
      </div>

      {/* ── 12-column grid ── */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(12, 1fr)" }}
      >
        {/* Net dealer gamma profile (span 7) — visual anchor */}
        <Card
          heading="Net dealer gamma profile"
          badge="full chain · $Bn / 1% vs spot"
          colSpan={7}
        >
          <GammaProfile
            profile={gex.profile}
            spot={gex.spot}
            flip={gex.flip}
            width={720}
            height={230}
          />
          {/* Callout block — GEX note text */}
          <div className="mt-1 border-t border-line pt-1.5 font-mono text-[10px] text-dim">
            {isAmplify
              ? "Dealers are net short gamma — moves are amplified (positive feedback)."
              : "Dealers are net long gamma — moves are dampened (mean-reversion force)."}
          </div>
        </Card>

        {/* GEX by strike (span 5) */}
        <Card heading="GEX by strike" badge="±260 · live" colSpan={5}>
          <GexBars
            strikes={gex.strikes}
            spot={gex.spot}
            callWall={gex.callWall}
            putWall={gex.putWall}
            height={260}
          />
        </Card>

        {/* Key levels (span 4) */}
        <Card heading="Key levels" badge="distance to spot" colSpan={4}>
          <KeyLevelsTable
            spot={gex.spot}
            flip={gex.flip}
            callWall={gex.callWall}
            putWall={gex.putWall}
          />
        </Card>

        {/* GEX by expiry (span 4) */}
        <Card heading="GEX by expiration" badge="$Bn · live" colSpan={4}>
          <GexByExpiry byExpiry={gex.byExpiry} height={200} />
        </Card>

        {/* Charm/Vanna coming-soon stub (span 4) — never omitted */}
        <Card heading="Charm / Vanna" colSpan={4} minHeight={140}>
          {/* Badge rendered inside ComingSoon — "○ next" per UI-SPEC */}
          <ComingSoon
            badge="○ next"
            title="Charm & Vanna by strike"
            body="computable from chain (Δ-drift from time & IV) — same per-strike bar pattern as GEX"
            minHeight={100}
          />
        </Card>

        {/* Intraday flow coming-soon stub (span 4) — never omitted */}
        <Card heading="Intraday flow" colSpan={4} minHeight={140}>
          {/* Badge rendered inside ComingSoon — "○ needs denser snapshots" per UI-SPEC */}
          <ComingSoon
            badge="○ needs denser snapshots"
            title="HIRO-style net delta-flow"
            body="Δ(delta-notional) between snapshots — 30-min cadence → coarse; finer feed later"
            minHeight={100}
          />
        </Card>
      </div>
    </div>
  );
}
