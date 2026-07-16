/**
 * MobileMarketSection — the mobile Overview's MARKET section (35.1, D-08 / UI-SPEC §7).
 *
 * Headline numbers replace the desktop's Dealer-γ/GEX-by-strike charts (which shrank to
 * axis soup at phone width): key levels (the EXACT desktop rows), a gamma grid, the net
 * book greeks 2x2, a macro grid — then `MarketRail` reused verbatim as a closed
 * disclosure (its own `<details>` + useIsDesktop-driven `open`, D-09). The desktop
 * GEX chart components are intentionally NOT imported anywhere in the mobile tree.
 */
import { keyLevelsFor, fmtGammaCompact } from "./useOverviewModel.ts";
import type { NetGreeks } from "./useOverviewModel.ts";
import type { GexRegime } from "../../lib/gex-regime.ts";
import { signed, signedUsd, signClass } from "../../lib/position-format.ts";
import { seriesDelta, formatDelta, pctOfPrev, fmtMag } from "../../lib/series-delta.ts";
import type { DeltaKind } from "../../lib/series-delta.ts";
import { MarketRail } from "../MarketRail.tsx";
import { Stat, SectionLabel } from "../../components/system/index.tsx";
import { cn } from "@/lib/utils";
import type { GexSnapshotEntry, MacroResponse } from "@morai/contracts";

export interface MobileMarketSectionProps {
  readonly gex: GexSnapshotEntry | undefined;
  readonly railGreeks: NetGreeks;
  readonly zeroDte: number | null;
  readonly regime: GexRegime | null;
  readonly vvix: number | null;
  readonly dff: number | null;
  readonly curveSlope: number | null;
  readonly cotLev: number | null;
  /** Live-aware engine spot (LIVE-04) — the other keyLevelsFor call site's override,
   *  so the mobile "Spot" row matches the desktop rail + hero (one SPX number). */
  readonly spot: number | null;
  /** Macro history for the tile trend chips (2026-07-16) — undefined renders no chips. */
  readonly macro?: MacroResponse | undefined;
  /** Prior week's COT leveraged net for the WoW chip — null renders no chip. */
  readonly cotLevPrev?: number | null;
}

/** Trend chip for one macro tile — same idiom as the regime rail's DeltaChip (direction
 *  color, unit-appropriate magnitude); null delta renders nothing (never fabricated). */
function tileDelta(
  testId: string,
  kind: DeltaKind,
  points: MacroResponse[keyof MacroResponse] | undefined,
): React.ReactElement | null {
  const d = seriesDelta(points);
  if (d === null) return null;
  const dir = d.delta > 0 ? "text-up" : d.delta < 0 ? "text-down" : "text-dim";
  return (
    <span className={cn("ml-1.5 font-mono text-[9px] tabular-nums", dir)} data-testid={testId}>
      {formatDelta(kind, d)}
    </span>
  );
}

export function MobileMarketSection({
  gex,
  railGreeks,
  zeroDte,
  regime,
  vvix,
  dff,
  curveSlope,
  cotLev,
  spot,
  macro,
  cotLevPrev,
}: MobileMarketSectionProps): React.ReactElement {
  // COT lev WoW chip — same arrow · magnitude · % idiom as CotCard's rows.
  const cotWow =
    cotLev !== null && cotLevPrev !== null && cotLevPrev !== undefined ? cotLev - cotLevPrev : null;
  const cotWowPct = cotWow !== null && cotLevPrev != null ? pctOfPrev(cotWow, cotLevPrev) : null;
  const cotChip =
    cotWow === null ? null : (
      <span
        className={cn("ml-1.5 font-mono text-[9px] tabular-nums", cotWow >= 0 ? "text-up" : "text-down")}
        data-testid="mobile-delta-cotlev"
      >
        {`${cotWow >= 0 ? "▲" : "▼"} ${fmtMag(Math.abs(cotWow))}${cotWowPct === null ? "" : ` · ${cotWowPct}`}`}
      </span>
    );
  return (
    <section data-testid="mobile-market" className="flex flex-col gap-3 px-4">
      <SectionLabel>Market</SectionLabel>

      {gex === undefined ? (
        <p className="font-mono text-xs text-dim">
          GEX data unavailable — run fetch-chain to populate.
        </p>
      ) : (
        <>
          {/* Key levels — the EXACT desktop rows (GexRail's key-levels block). */}
          <SectionLabel tone="dim">Key levels</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {keyLevelsFor(gex, spot ?? undefined).map((lvl) => (
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

          {/* Gamma — the headline dealer-γ numbers instead of the shrunken charts (D-08). */}
          <SectionLabel tone="dim">Gamma</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="net γ /1%"
              value={fmtGammaCompact(gex.netGammaAtSpot)}
              valueClassName={regime === "AMPLIFY" ? "text-down" : "text-up"}
            />
            <Stat
              label="0DTE γ"
              value={zeroDte !== null ? fmtGammaCompact(zeroDte) : "—"}
              valueClassName={
                zeroDte === null ? "text-muted-foreground" : zeroDte < 0 ? "text-down" : "text-up"
              }
            />
          </div>

          {/* Net book greeks — verbatim from GexRail. Inside the gex branch because
              railGreeks are priced at gex.spot; without gex the fallback spot would
              show plausible-but-wrong values (desktop GexRail hides the whole rail). */}
          <SectionLabel tone="dim">Net book greeks</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Net Δ" value={signed(railGreeks.delta)} valueClassName={signClass(railGreeks.delta)} />
            <Stat label="Net Γ" value={signed(railGreeks.gamma)} />
            <Stat label="Net Θ/d" value={signedUsd(railGreeks.theta)} valueClassName={signClass(railGreeks.theta)} />
            <Stat label="Net Vega" value={signedUsd(railGreeks.vega)} valueClassName={signClass(railGreeks.vega)} />
          </div>
        </>
      )}

      {/* Macro — the same formatting the header chips used, plus trend chips vs the
          prior observation (2026-07-16 parity with the regime rail's deltas). */}
      <SectionLabel tone="dim">Macro</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="VVIX"
          value={
            <>
              {vvix !== null ? vvix.toFixed(1) : "—"}
              {tileDelta("mobile-delta-vvix", "level-pct", macro?.["VVIX"])}
            </>
          }
        />
        <Stat
          label="Fed funds"
          value={
            <>
              {dff !== null ? `${dff.toFixed(2)}%` : "—"}
              {tileDelta("mobile-delta-dff", "bp", macro?.["DFF"])}
            </>
          }
        />
        <Stat
          label="10y−2y"
          value={
            <>
              {curveSlope !== null ? `${curveSlope >= 0 ? "+" : ""}${curveSlope.toFixed(2)}` : "—"}
              {tileDelta("mobile-delta-curve", "bp", macro?.["T10Y2Y"])}
            </>
          }
          valueClassName={curveSlope !== null ? signClass(curveSlope) : "text-muted-foreground"}
        />
        <Stat
          label="COT lev"
          value={
            <>
              {cotLev !== null ? signed(cotLev) : "—"}
              {cotChip}
            </>
          }
          valueClassName={cotLev !== null ? signClass(cotLev) : "text-muted-foreground"}
        />
      </div>

      {/* Regime · COT · health — MarketRail reused verbatim; closed here (useIsDesktop
          false below lg), user-toggled via the native details summary (D-09). */}
      <MarketRail />
    </section>
  );
}
