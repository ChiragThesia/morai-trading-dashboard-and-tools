import { useCot } from "../hooks/useCot.ts";
import { BulletGauge, Panel, PanelHeading } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";

/**
 * CotCard — CFTC Commitments-of-Traders positioning for E-mini S&P 500 (Phase 13 FE).
 *
 * Renders the newest weekly report as a net-per-class row list (long − short), each as a
 * NEUTRAL direction-tinted bullet gauge (39-03, GAUGE-03) — marker bg-up/bg-down by sign,
 * never a verdict color — with a week-over-week delta arrow and a 3-line teaching ⓘ
 * tooltip (GAUGE-04, rev 3 — condensed WHAT/WHY/META). Leveraged Funds is the headline
 * "big guys" signal (D-05). Data via useCot() — no props.
 *
 * Design-system only (tokens + Tailwind); layout-only inline styles for the bar removed
 * (BulletGauge owns its own track math).
 */

// The five net-per-class fields — all `z.number().int()`, so indexing is always a number.
type NetKey =
  | "netDealer"
  | "netAssetManager"
  | "netLeveraged"
  | "netOther"
  | "netNonreportable";

// Net-per-class rows to render, top → bottom. Leveraged is the headline signal.
const CLASSES: ReadonlyArray<{ key: NetKey; label: string; headline?: boolean }> = [
  { key: "netDealer", label: "Dealer" },
  { key: "netAssetManager", label: "Asset Mgr" },
  { key: "netLeveraged", label: "Leveraged", headline: true },
  { key: "netOther", label: "Other rept" },
  { key: "netNonreportable", label: "Non-rept" },
];

/** Visual axis per COT class (NOT semantic thresholds — same GAUGE_SCALE comment discipline
 *  as RegimeBoard/RateGaugeRow). CHECKER CORRECTION (39-03): the UI-SPEC's original axes
 *  (netDealer/netOther/netNonreportable ±150K, netAssetManager ±600K, netLeveraged ±400K)
 *  were derived from a single-week HTTP fixture and are stale against both this file's own
 *  test fixture and current live prints — netDealer −755.9K/−731K would pin past a ±150K
 *  axis, netAssetManager +992.7K/+971K would pin past ±600K, netLeveraged −515.5K (prior
 *  week) would pin past ±400K. Each axis below is ±(max observed |net| across the test
 *  fixture's two weeks, which bounds the live prints too) × ~1.5 headroom, rounded up to a
 *  clean number, so every real print sits visibly inside the track, never pinned at the edge. */
const COT_GAUGE_SCALE: Record<NetKey, { min: number; max: number }> = {
  // max observed |net| = 755,900 → ×1.5 = 1,133,850, rounded up
  netDealer: { min: -1_150_000, max: 1_150_000 },
  // max observed |net| = 992,729 → ×1.5 = 1,489,094, rounded up
  netAssetManager: { min: -1_500_000, max: 1_500_000 },
  // max observed |net| = 515,520 (prior week) → ×1.5 = 773,280, rounded up
  netLeveraged: { min: -800_000, max: 800_000 },
  // max observed |net| = 14,061 → ×1.5 = 21,092, rounded up
  netOther: { min: -25_000, max: 25_000 },
  // max observed |net| = 122,578 → ×1.5 = 183,867, rounded up
  netNonreportable: { min: -200_000, max: 200_000 },
};

/** WHAT/WHY/META copy, condensed from 39-UI-SPEC.md's "COT block" payload (rev 3 — 3-line scan
 *  per user feedback) — compression only, no new claims. META folds the axis range (matching
 *  each class's COT_GAUGE_SCALE below) and the shared CFTC TFF source into one quiet line. */
const TOOLTIP_COPY: Record<NetKey, { what: string; why: string; meta: string }> = {
  netDealer: {
    what: "Dealer net position — banks & broker-dealers",
    why: "Mostly intermediates client flow, not a conviction bet",
    meta: "±1.15M axis · CFTC TFF, weekly",
  },
  netAssetManager: {
    what: "Asset Manager net position — pensions & institutions",
    why: "Slow-moving, usually long-biased institutional read",
    meta: "±1.5M axis · CFTC TFF, weekly",
  },
  netLeveraged: {
    what: "Leveraged Funds net position — hedge funds & CTAs",
    why: "Most tactical class; often leads price action",
    meta: "±800K axis · CFTC TFF, weekly",
  },
  netOther: {
    what: "Other Reportable net position — the catch-all class",
    why: "Checks the other three classes explain most flow",
    meta: "±25K axis · CFTC TFF, weekly",
  },
  netNonreportable: {
    what: "Non-Reportable net position — small speculators, aggregated",
    why: "Read as a retail-sentiment proxy; small in size",
    meta: "±200K axis · CFTC TFF, weekly",
  },
};

/** Compact magnitude: 1.98M / 756K / 421. Unsigned. */
function fmtMag(abs: number): string {
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${Math.round(abs / 1_000)}K`;
  return String(abs);
}

/** Signed compact: −756K / +993K (minus glyph, matching Market). */
function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmtMag(Math.abs(v))}`;
}

/** aria-valuetext: true signed value + WoW direction phrase (never a band/verdict word —
 *  a COT row has no verdict). `wow` null (no prior week) degrades to the position alone. */
function cotAriaValueText(net: number, wow: number | null): string {
  const base = `${fmtSigned(net)} contracts`;
  return wow === null
    ? base
    : `${base} — ${wow >= 0 ? "up" : "down"} ${fmtMag(Math.abs(wow))} week-over-week`;
}

export function CotCard(): React.ReactElement {
  const { data } = useCot();
  const latest = data?.[0];
  const prev = data?.[1];

  if (latest === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 120 }}>
        <PanelHeading title="CFTC COT — dealer & spec positioning" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="cot-empty"
        >
          COT data unavailable — run fetch-cot to populate.
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid="cot-card">
      <PanelHeading
        title="CFTC COT — dealer & spec positioning"
        badge={
          <span className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim">
            E-mini S&P · as of {latest.asOf}
          </span>
        }
      />

      <div className="flex flex-col gap-1.5">
        {CLASSES.map((c) => {
          const net = latest[c.key];
          const isLong = net >= 0;
          const wow = prev !== undefined ? net - prev[c.key] : null;
          const scale = COT_GAUGE_SCALE[c.key];
          const copy = TOOLTIP_COPY[c.key];

          return (
            <div
              key={c.key}
              className="flex flex-col gap-1 py-1.5"
              data-testid={`cot-row-${c.key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  <span
                    className={cn(
                      "truncate text-[10px] font-display font-semibold tracking-[0.09em] uppercase",
                      c.headline === true ? "text-txt" : "text-dim",
                    )}
                  >
                    {c.label}
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        data-testid={`cot-why-${c.key}`}
                        aria-label={`${c.label} explanation`}
                        style={{
                          display: "inline-flex",
                          cursor: "default",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                        }}
                      >
                        <Badge
                          variant="outline"
                          className="border-line2 px-1 py-0 font-mono text-[10px] text-dim"
                        >
                          ⓘ
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex max-w-[15rem] flex-col gap-1 font-mono">
                          <span className="text-[11px] text-txt">{copy.what}</span>
                          <span className="text-[11px] text-dim">{copy.why}</span>
                          <span className="text-[10px] text-dim/70">{copy.meta}</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-14 shrink-0 text-right font-mono text-[11px] tabular-nums",
                      isLong ? "text-up" : "text-down",
                    )}
                    data-testid={`cot-net-${c.key}`}
                  >
                    {fmtSigned(net)}
                  </span>

                  <span
                    className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-dim"
                    data-testid={`cot-wow-${c.key}`}
                  >
                    {wow === null ? "" : `${wow >= 0 ? "▲" : "▼"} ${fmtMag(Math.abs(wow))}`}
                  </span>
                </div>
              </div>

              <BulletGauge
                variant="neutral"
                min={scale.min}
                max={scale.max}
                value={net}
                markerColorClass={isLong ? "bg-up" : "bg-down"}
                ariaLabel={`${c.label} net position`}
                ariaValueText={cotAriaValueText(net, wow)}
                testId={`cot-gauge-${c.key}`}
                markerTestId={`cot-gauge-marker-${c.key}`}
              />
            </div>
          );
        })}
      </div>

      <span className="font-mono text-[10px] text-dim">
        Net = long − short contracts · WoW vs prior week · Leveraged = the “big guys” (D-05).
      </span>
    </Panel>
  );
}
