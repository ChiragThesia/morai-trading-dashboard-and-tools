import { memo } from "react";
import { useRegimeBoard } from "../hooks/useRegimeBoard.ts";
import { usePicker } from "../hooks/usePicker.ts";
import { useMacro } from "../hooks/useMacro.ts";
import { BulletGauge, Panel, PanelHeading } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";
import { seriesDelta, ratioDelta, formatDelta } from "../lib/series-delta.ts";
import type { Delta, DeltaKind } from "../lib/series-delta.ts";
import { bandVixTermStructure, bandVvix, bandVix9dRatio } from "@morai/core";
import type {
  RegimeBand,
  RegimeIndicator,
  PickerGate,
  MacroResponse,
  MacroSeriesId,
  StreamIndicesEvent,
} from "@morai/contracts";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";

/**
 * RegimeBoard — the "Market regime" rail panel. Reworked (market-rail-ux.md) into ONE
 * scannable typographic column instead of card-per-datum, after the earlier card/pill
 * rendering was rejected twice for having no hierarchy (everything large/bold/teal) and
 * metadata spam ("as of" on every tile).
 *
 * Top → bottom, three visual tiers (loud → quiet):
 *   - Entry gate (28-06): the SIGNAL — a framed compact tile, state word colored by state,
 *     VIX·ratio·as-of on a dim second line. `state: "blind"` keeps the filled `bg-downd`
 *     alarm treatment (loudest thing in the rail). Read straight from `usePicker().gate`.
 *   - Regime indicators: compact label-left / value-right ROWS. Band is signaled by VALUE
 *     COLOR only-when-abnormal — calm = quiet `text-txt`, warning = amber, crisis = down —
 *     so the eye lands on the one deviating value. ⓘ provenance tooltip kept, visually quiet.
 *   - Rates (former MacroCard): a 2-col label/value grid, dimmer + smaller than regime
 *     values (backdrop tier). Pills removed — they were the rejected look.
 * A single freshness footer dedupes the four repeated per-indicator "as of" captions.
 *
 * Banding logic, GATE BLIND independence (WR-02), tooltip provenance, and a11y are
 * unchanged — this is a density/hierarchy rework, not a data change.
 */

/** Value color is the band signal, ONLY when abnormal (NN/g: color marks what warrants
 *  attention). Calm stays quiet (default text); warning/amber, crisis/down. */
const BAND_CLASSES: Record<RegimeBand, { text: string }> = {
  calm: { text: "text-txt" },
  warning: { text: "text-amber" },
  crisis: { text: "text-down" },
};

/** Gauge marker color reads the server-computed band — never recomputed from value/thresholds
 *  client-side (T-31-05), EXCEPT the scoped Phase-38 live-display override below (CONTEXT
 *  Area 2 Q1): while live, the 3 broker-quotable rows recompute this from the live value.
 *  Not BAND_CLASSES.dot (removed): calm needs a visible-but-unaccented color to read as a
 *  positioned marker, not the old dim `bg-line2` dot's near-invisible calm. */
const MARKER_CLASSES: Record<RegimeBand, string> = {
  calm: "bg-txt",
  warning: "bg-amber",
  crisis: "bg-down",
};

/** id → live-band function (T-31-05 scoped display-only exception, CONTEXT Area 2 Q1).
 *  Mirrors useRuleSettingsPreview.ts's REGIME_BAND_FNS lookup, restricted to the 3
 *  broker-quotable ids — hy-oas is deliberately absent, it stays FRED-only, never live. */
const LIVE_BAND_FNS: Record<string, (value: number, thresholds: { warn: number; crisis: number }) => RegimeBand> = {
  "vix-term-structure": bandVixTermStructure,
  vvix: bandVvix,
  "vix9d-vix": bandVix9dRatio,
};

/** Live value for one broker-quotable id from the batched indices frame. Null on a
 *  per-symbol Schwab failure or a non-finite ratio (divide-by-zero) — never fabricated;
 *  the row degrades to its EOD value alone. Ids outside the 3 broker-quotable rows
 *  (hy-oas) always return null — not broker-quotable, stays FRED. */
function liveValueFor(id: string, liveIndices: StreamIndicesEvent): number | null {
  switch (id) {
    case "vix-term-structure": {
      if (liveIndices.vix === null || liveIndices.vix3m === null) return null;
      const ratio = liveIndices.vix / liveIndices.vix3m;
      return Number.isFinite(ratio) ? ratio : null;
    }
    case "vvix":
      return liveIndices.vvix;
    case "vix9d-vix": {
      if (liveIndices.vix9d === null || liveIndices.vix === null) return null;
      const ratio = liveIndices.vix9d / liveIndices.vix;
      return Number.isFinite(ratio) ? ratio : null;
    }
    default:
      return null;
  }
}

/** Fixed per-indicator visual axis (where the ruler starts/ends) — NOT semantic thresholds.
 *  Warn/crisis band positions come from the response (indicator.bandWarn/bandCrisis), Phase-29
 *  overrides-aware; this map only bounds the gauge's min/max (31-UI-SPEC.md §2). */
const GAUGE_SCALE: Record<string, { min: number; max: number }> = {
  "vix-term-structure": { min: 0.6, max: 1.2 },
  vvix: { min: 70, max: 150 },
  "vix9d-vix": { min: 0.7, max: 1.3 },
  "hy-oas": { min: 1.5, max: 8.0 },
};

/** Rate-block visual axis — NOT semantic thresholds, same discipline as GAUGE_SCALE
 *  (39-UI-SPEC.md "Gauge scale"). The 4 money-rate axes span 0-8%; the 2 yield-curve
 *  spreads get their own tighter axes sized to the modern historical extent. */
const RATE_GAUGE_SCALE: Record<string, { min: number; max: number }> = {
  DFF: { min: 0, max: 8 },
  SOFR: { min: 0, max: 8 },
  DGS1MO: { min: 0, max: 8 },
  DGS3MO: { min: 0, max: 8 },
  T10Y2Y: { min: -1.5, max: 2.5 },
  T10Y3M: { min: -2.0, max: 3.0 },
};

/** Display-only client band for the 2 yield-curve spreads — gate BLIND, never fed into
 *  usePicker/useRegimeBoard/gate resolution (T-39-04). Matches the t10y2y/t10y3m evidence
 *  rows docs/architecture/regime-board.md documents (39-01): calm > 0.0, warning ≤ 0.0,
 *  crisis ≤ -0.50 [ASSUMED]. */
const RATE_BANDS: Record<string, { warn: number; crisis: number }> = {
  T10Y2Y: { warn: 0.0, crisis: -0.5 },
  T10Y3M: { warn: 0.0, crisis: -0.5 },
};

/** Client-side display-band classifier for the 2 banded rate rows — a plain value/threshold
 *  compare against RATE_BANDS, never touching a gate. */
function rateBand(value: number, bands: { warn: number; crisis: number }): RegimeBand {
  if (value <= bands.crisis) return "crisis";
  if (value <= bands.warn) return "warning";
  return "calm";
}

// ─── Trend deltas (2026-07-16, user ask: "% change since last so we can see the trend") ──
//
// Each regime indicator's change vs its PRIOR EOD observation, derived client-side from
// the macro history useMacro already fetches — no backend change. Unit-appropriate per
// metric (a % of a ratio misleads): ratios raw Δ, VVIX %, HY OAS + rates in bp. Missing
// history → null → no chip (never fabricated).

/** indicator id → delta + display kind from the macro series history. */
function regimeDelta(id: string, macro: MacroResponse | undefined): { d: Delta; kind: DeltaKind } | null {
  if (macro === undefined) return null;
  switch (id) {
    case "vix-term-structure": {
      const d = ratioDelta(macro["VIXCLS"], macro["VXVCLS"]);
      return d === null ? null : { d, kind: "ratio" };
    }
    case "vix9d-vix": {
      const d = ratioDelta(macro["VIX9D"], macro["VIXCLS"]);
      return d === null ? null : { d, kind: "ratio" };
    }
    case "vvix": {
      const d = seriesDelta(macro["VVIX"]);
      return d === null ? null : { d, kind: "level-pct" };
    }
    case "hy-oas": {
      const d = seriesDelta(macro["BAMLH0A0HYM2"]);
      return d === null ? null : { d, kind: "bp" };
    }
    default:
      return null;
  }
}

/** The quiet trend chip next to a value — direction + magnitude, deliberately neutral
 *  color (the band already carries the verdict; the chip is information, not alarm). */
function DeltaChip({ id, delta }: { id: string; delta: { d: Delta; kind: DeltaKind } | null }): React.ReactElement | null {
  if (delta === null) return null;
  return (
    <span
      className="font-mono text-[9px] tabular-nums text-dim"
      data-testid={`regime-delta-${id}`}
      title={`vs ${delta.d.vsDate} (prev observation): ${delta.d.prev.toFixed(2)} → ${delta.d.latest.toFixed(2)}`}
    >
      {formatDelta(delta.kind, delta.d)}
    </span>
  );
}

/** Dense-mode label shortening (keeps rows single-line) — also used for the freshness
 *  footer's date-exception tags. The full name stays legible at non-dense width. */
const SHORT_LABELS: Record<string, string> = {
  "vix-term-structure": "VIX/VIX3M",
  "hy-oas": "HY OAS",
};

function shortLabel(indicator: RegimeIndicator, dense: boolean): string {
  return dense ? (SHORT_LABELS[indicator.id] ?? indicator.label) : indicator.label;
}

/** Teaching-tooltip copy (39-UI-SPEC.md "Tooltip Copy (LOCKED)", rev 3 — condensed to a 3-line
 *  scan per user feedback: "too large ... should be quick and easy to read"), rendered verbatim,
 *  never paraphrased. Keyed by every regime id AND every rate id (GAUGE-04). Regime rows layer
 *  this in front of the server's own source/rationale (unchanged, appended below META); rate
 *  rows have no server source, so their META bakes provenance in directly (no separate line). */
const TOOLTIP_COPY: Record<string, { what: string; why: string; meta: string }> = {
  "vix-term-structure": {
    what: `VIX ÷ VIX3M — near-term vs 3-month vol ratio`,
    why: `Backwardation = near-term fear spike; hurts calendars most`,
    meta: `Calm <0.90 · warn 0.90–0.95 · crisis ≥0.95`,
  },
  vvix: {
    what: `VVIX — implied volatility of VIX options`,
    why: `High VVIX = vol-of-vol risk the VIX level misses`,
    meta: `Calm <100 · warn 100–115 · crisis ≥115`,
  },
  "vix9d-vix": {
    what: `VIX9D ÷ VIX — 9-day vs 30-day vol ratio`,
    why: `Rising ratio = near-term fear building fast`,
    meta: `Calm <1.0 · warn 1.0–1.1 · crisis ≥1.1 (unbacktested analogy)`,
  },
  "hy-oas": {
    what: `HY OAS — junk-bond yield premium over Treasuries`,
    why: `Widening spreads = credit stress, often leads risk-off`,
    meta: `Calm <3.0% · warn 3.0–5.0% · crisis ≥5.0%`,
  },
  DFF: {
    what: `Fed's overnight bank lending rate — sets everything else`,
    why: `Sets the backdrop for options carry & hedge cost`,
    meta: `0–8% range · FRED DFF, daily`,
  },
  SOFR: {
    what: `SOFR — repo rate that replaced LIBOR`,
    why: `Gap vs Fed funds = money-market funding stress`,
    meta: `0–8% range · FRED SOFR, daily`,
  },
  DGS1MO: {
    what: `1-month T-bill yield — shortest US gov't rate`,
    why: `Fast moves price in an imminent rate decision`,
    meta: `0–8% range · FRED DGS1MO, daily`,
  },
  DGS3MO: {
    what: `3-month T-bill yield — short leg of 10Y-3M`,
    why: `Reflects near-term Fed policy expectations`,
    meta: `0–8% range · FRED DGS3MO, daily`,
  },
  T10Y2Y: {
    what: `10Y minus 2Y Treasury yield — the curve slope`,
    why: `Inverted = historical recession precursor, 6–12mo lead`,
    meta: `Calm >0 · warn ≤0 · crisis ≤−0.50 · FRED T10Y2Y, daily`,
  },
  T10Y3M: {
    what: `10Y minus 3M Treasury yield — a faster curve spread`,
    why: `Inverting with 10Y-2Y = stronger recession signal`,
    meta: `Calm >0 · warn ≤0 · crisis ≤−0.50 · FRED T10Y3M, daily`,
  },
};

/** ⓘ tooltip trigger + condensed WHAT/WHY/META content (39-UI-SPEC.md "Tooltip layout", rev 3),
 *  shared by regime rows and rate rows — one badge/tooltip idiom, one render path so the locked
 *  copy is single-sourced. WHAT at `text-txt`, WHY at `text-dim` (both 11px); META (bands, with
 *  provenance baked in for rate rows) at the quietest `text-dim/70` (10px). Regime rows append
 *  the server's own source/rationale below META via `source`, unchanged content/behavior. */
function InfoTooltip({
  testId,
  ariaLabel,
  what,
  why,
  meta,
  source,
}: {
  testId: string;
  ariaLabel: string;
  what: string;
  why: string;
  meta: string;
  source?: React.ReactNode;
}): React.ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          data-testid={testId}
          aria-label={ariaLabel}
          style={{
            display: "inline-flex",
            cursor: "default",
            background: "transparent",
            border: "none",
            padding: 0,
          }}
        >
          <Badge variant="outline" className="border-line2 px-1 py-0 font-mono text-[10px] text-dim">
            ⓘ
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex max-w-[15rem] flex-col gap-1 font-mono">
            <span className="text-[11px] text-txt">{what}</span>
            <span className="text-[11px] text-dim">{why}</span>
            <div className="flex flex-col gap-0.5 text-[10px] text-dim/70">
              <span>{meta}</span>
              {source}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** One regime indicator = one compact two-line row: label + value (mono tabular, only an
 *  abnormal band adds color + weight), then a banded bullet gauge — value marker on a
 *  warn/crisis-banded track — so proximity to the edge reads at a glance (DEFECT-2). Band
 *  edges come from the response's bandWarn/bandCrisis (Phase-29 effective config, threaded
 *  by getRegimeBoard.ts); GAUGE_SCALE is only the client-side visual axis. */
function Row({
  indicator,
  dense,
  liveValue = null,
  liveBand = null,
  delta = null,
}: {
  indicator: RegimeIndicator;
  dense: boolean;
  /** Live-tinted value for the 3 broker-quotable rows while the stream is live — null
   *  (quiet/stalled, non-broker-quotable id, or a per-symbol failure) falls back to the
   *  stored EOD `indicator.value` (honest, never fabricated). */
  liveValue?: number | null;
  /** Client-recomputed band for `liveValue` (T-31-05 scoped display-only exception) —
   *  null falls back to the stored EOD `indicator.band`. */
  liveBand?: RegimeBand | null;
  /** Trend vs prior EOD observation (2026-07-16) — null renders no chip. Always the
   *  EOD-vs-EOD delta, even while the value itself displays live. */
  delta?: { d: Delta; kind: DeltaKind } | null;
}): React.ReactElement {
  const value = liveValue ?? indicator.value;
  const displayBand = liveBand ?? indicator.band;
  const band = BAND_CLASSES[displayBand];
  const abnormal = displayBand !== "calm";
  // ponytail: all 4 live regimeIndicator ids are in GAUGE_SCALE; this fallback only guards a
  // future 5th indicator id shipping before its GAUGE_SCALE entry does.
  const scale = GAUGE_SCALE[indicator.id] ?? { min: 0, max: Math.max(indicator.bandCrisis, value, 1) };
  const copy = TOOLTIP_COPY[indicator.id] ?? { what: "", why: "", meta: "" };

  return (
    <div className="flex flex-col gap-1 py-1.5" data-testid={`regime-chip-${indicator.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
            {shortLabel(indicator, dense)}
          </span>
          <InfoTooltip
            testId={`regime-why-${indicator.id}`}
            ariaLabel={`${indicator.label} source and rationale`}
            what={copy.what}
            why={copy.why}
            meta={copy.meta}
            source={
              <>
                <span>{indicator.source}</span>
                <span>{indicator.rationale}</span>
              </>
            }
          />
        </div>
        <span className="flex items-baseline gap-1.5">
          <DeltaChip id={indicator.id} delta={delta} />
          <span
            className={cn(
              "font-mono text-[13px] tabular-nums",
              band.text,
              abnormal && "font-semibold",
            )}
            data-testid={`regime-value-${indicator.id}`}
          >
            {value.toFixed(2)}
          </span>
        </span>
      </div>
      <BulletGauge
        variant="banded"
        min={scale.min}
        max={scale.max}
        value={value}
        bandWarn={indicator.bandWarn}
        bandCrisis={indicator.bandCrisis}
        markerColorClass={MARKER_CLASSES[displayBand]}
        ariaLabel={`${indicator.label} gauge`}
        ariaValueText={`${value.toFixed(2)} — ${displayBand}`}
        testId={`regime-gauge-${indicator.id}`}
        markerTestId={`regime-gauge-marker-${indicator.id}`}
      />
    </div>
  );
}

const GATE_STATE_LABEL: Record<PickerGate["state"], string> = {
  open: "OPEN",
  penalty: "PENALTY",
  blocked: "BLOCKED",
  blind: "GATE BLIND",
};

const GATE_STATE_TEXT_CLASS: Record<PickerGate["state"], string> = {
  open: "text-up",
  penalty: "text-amber",
  blocked: "text-down",
  blind: "text-down",
};

/** Names a tripped brake alongside the gate state (28-03's two anti-criteria brakes) — never
 *  both at once in the fixture data, but a maxOpen+cooldown overlap still names both. */
function brakeLabel(brakes: PickerGate["brakes"]): string | null {
  const names = [
    brakes.maxOpen ? "max-open" : null,
    brakes.cooldown ? "cooldown" : null,
  ].filter((n): n is string => n !== null);
  return names.length === 0 ? null : names.join(", ");
}

/** GateChip — the picker's entry-gate tile (28-06, PLAY-01/T-28-17), the rail's top SIGNAL.
 *  Every value is read straight from `PickerSnapshotResponse.gate` — no client-side band
 *  recomputation. Compact two-line tile: label + state on line one, VIX·ratio·as-of dim on
 *  line two. `state: "blind"` keeps the filled `bg-downd`/`ring-down` alarm treatment
 *  (louder than "blocked", which only colors the state label). */
function GateChip({ gate }: { gate: PickerGate }): React.ReactElement {
  const isBlind = gate.state === "blind";
  const brake = brakeLabel(gate.brakes);

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg px-2.5 py-2 ring-1",
        isBlind ? "bg-downd ring-down/40" : "bg-raise/40 ring-line",
      )}
      data-testid="gate-chip"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
          Entry gate
        </span>
        <span
          className={cn(
            "font-display text-sm font-bold tabular-nums uppercase",
            GATE_STATE_TEXT_CLASS[gate.state],
          )}
          data-testid="gate-state"
        >
          {GATE_STATE_LABEL[gate.state]}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-dim">
        <span data-testid="gate-metrics">
          {`VIX ${gate.vix === null ? "—" : gate.vix.toFixed(2)} · ratio ${gate.ratio === null ? "—" : gate.ratio.toFixed(2)}`}
        </span>
        <span data-testid="gate-asof">{`as of ${gate.asOf ?? "—"}`}</span>
      </div>
      {brake !== null && (
        <span className="font-mono text-[10px] text-amber" data-testid="gate-brake">
          {`brake: ${brake}`}
        </span>
      )}
    </div>
  );
}

// ─── Rates row (former MacroCard, absorbed into this panel) ──────────────────

/** Raw FRED rates/curve backdrop — VIX/VVIX are dropped here (already covered by the
 *  banded VVIX indicator above and the entry-gate chip's VIX reading). `variant` picks the
 *  gauge shape: the 4 money rates are position-only NEUTRAL tracks (no verdict, ever); the
 *  2 yield-curve spreads are BANDED from RATE_BANDS (display-only, gate stays blind). */
const RATES: ReadonlyArray<{ id: MacroSeriesId; label: string; variant: "neutral" | "banded" }> = [
  { id: "DFF", label: "Fed Funds", variant: "neutral" },
  { id: "SOFR", label: "SOFR", variant: "neutral" },
  { id: "DGS1MO", label: "1M", variant: "neutral" },
  { id: "DGS3MO", label: "3M", variant: "neutral" },
  { id: "T10Y2Y", label: "10Y−2Y", variant: "banded" },
  { id: "T10Y3M", label: "10Y−3M", variant: "banded" },
];

/** Latest observation value for one macro series — the single source both the printed
 *  value line and the gauge read from (no double parse, no `!`). Null when the series has
 *  no data point yet (never fabricated). */
function latestValue(data: MacroResponse, id: MacroSeriesId): number | null {
  const points = data[id];
  const latest = points?.[points.length - 1];
  return latest === undefined ? null : latest.value;
}

function fmtRate(data: MacroResponse, id: MacroSeriesId): string {
  const value = latestValue(data, id);
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

/** RateGaugeRow — a backdrop value as a compact label/value row (not a pill), plus a bullet
 *  gauge track below. Dimmer + smaller than the regime values above so the rates read as
 *  context, not signal. A row with no macro point renders the value dash and omits the
 *  gauge entirely — never a marker at a fabricated 0 (catch #26 honesty). */
function RateGaugeRow({
  id,
  label,
  variant,
  data,
}: {
  id: MacroSeriesId;
  label: string;
  variant: "neutral" | "banded";
  data: MacroResponse;
}): React.ReactElement {
  const value = latestValue(data, id);
  const valueText = fmtRate(data, id);
  const scale = RATE_GAUGE_SCALE[id] ?? null;
  const bands = RATE_BANDS[id] ?? null;
  const copy = TOOLTIP_COPY[id] ?? { what: "", why: "", meta: "" };
  // Trend vs prior observation (2026-07-16) — rates and curve spreads move in bp.
  const rawDelta = seriesDelta(data[id]);
  const delta = rawDelta === null ? null : { d: rawDelta, kind: "bp" as const };

  let gauge: React.ReactElement | null = null;
  if (value !== null && scale !== null) {
    if (variant === "neutral") {
      gauge = (
        <BulletGauge
          variant="neutral"
          min={scale.min}
          max={scale.max}
          value={value}
          markerColorClass="bg-dim"
          ariaLabel={`${label} gauge`}
          ariaValueText={`${value.toFixed(2)}% — position`}
          testId={`rate-gauge-${id}`}
          markerTestId={`rate-gauge-marker-${id}`}
        />
      );
    } else if (bands !== null) {
      const band = rateBand(value, bands);
      gauge = (
        <BulletGauge
          variant="banded"
          min={scale.min}
          max={scale.max}
          value={value}
          bandWarn={bands.warn}
          bandCrisis={bands.crisis}
          markerColorClass={MARKER_CLASSES[band]}
          ariaLabel={`${label} gauge`}
          ariaValueText={`${value.toFixed(2)}% — ${band}`}
          testId={`rate-gauge-${id}`}
          markerTestId={`rate-gauge-marker-${id}`}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-1 py-1.5" data-testid={`rate-chip-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
            {label}
          </span>
          <InfoTooltip
            testId={`rate-why-${id}`}
            ariaLabel={`${label} explanation`}
            what={copy.what}
            why={copy.why}
            meta={copy.meta}
          />
        </div>
        <span className="flex items-baseline gap-1.5">
          <DeltaChip id={id} delta={delta} />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{valueText}</span>
        </span>
      </div>
      {gauge}
    </div>
  );
}

/** `dense` shortens long indicator labels for the narrow left MarketRail; layout is the
 *  same scannable row column at every width now (the old 2×2 / 4-across card grid is gone).
 *  `liveIndices`/`liveStatus` (Phase 38, LIVE-05) are the display-live/gate-EOD overlay: while
 *  `liveStatus==="live"`, the 3 broker-quotable rows show a live value + client-recomputed
 *  band; the entry gate, stored `indicator.band`, and hy-oas never read them. */
function RegimeBoardImpl({
  dense = false,
  liveIndices = null,
  liveStatus,
}: {
  dense?: boolean;
  liveIndices?: StreamIndicesEvent | null;
  liveStatus?: LiveStreamStatus | undefined;
} = {}): React.ReactElement {
  const { data, isPending, isError } = useRegimeBoard();
  // The entry-gate tile (28-06) is a separate data source (usePicker) from the regime
  // indicators — silently omitted (T-24-09 "never a fabricated chip") when no snapshot
  // exists yet, and rendered in EVERY branch below (WR-02: never suppressed by the regime
  // board's own unrelated loading/error/empty state).
  const { data: pickerSnapshot } = usePicker();
  const gate = pickerSnapshot?.gate ?? null;
  const gateChip = gate !== null ? <GateChip gate={gate} /> : null;

  // The rates row (former MacroCard) is a third, independent data source (useMacro) —
  // same "silently omit, never fabricate" treatment, rendered in EVERY branch below.
  const { data: macro } = useMacro();
  const ratesRow =
    macro !== undefined && Object.keys(macro).length > 0 ? (
      <div
        className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-2"
        data-testid="regime-rates-row"
      >
        {RATES.map((r) => (
          <RateGaugeRow key={r.id} id={r.id} label={r.label} variant={r.variant} data={macro} />
        ))}
      </div>
    ) : null;

  if (isPending && data === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Market regime" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-loading"
        >
          Loading regime board…
        </div>
        {gateChip}
        {ratesRow}
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Market regime" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-error"
        >
          Regime board unavailable — check the FRED/CBOE fetch job.
        </div>
        {gateChip}
        {ratesRow}
      </Panel>
    );
  }

  if (data === undefined || data.length === 0) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Market regime" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-empty"
        >
          Regime data unavailable — run fetch-rates to populate.
        </div>
        {gateChip}
        {ratesRow}
      </Panel>
    );
  }

  // Freshness footer: dedupe the per-indicator "as of" captions into one line. Newest date
  // is the headline; any indicator on an older date is noted inline (honest about the mix).
  const newest = data.map((i) => i.asOf).reduce((m, d) => (d > m ? d : m));
  const stale = data.filter((i) => i.asOf !== newest);
  const freshness =
    `EOD · as of ${newest}` +
    stale.map((i) => ` · ${SHORT_LABELS[i.id] ?? i.label} ${i.asOf}`).join("");

  // Live-tint overlay (LIVE-05, display-live/gate-EOD LAW): a per-row live value gated on
  // liveStatus==="live"; a per-symbol null (Schwab failure for that one input) degrades only
  // that row to EOD — never a silent live/EOD mix hidden as "live" (catch #26).
  const liveById =
    liveStatus === "live" && liveIndices !== null
      ? new Map(data.map((indicator) => [indicator.id, liveValueFor(indicator.id, liveIndices)]))
      : new Map<string, number | null>();
  const anyLive = Array.from(liveById.values()).some((v) => v !== null);
  const showLiveFooter = liveStatus === "live" && anyLive;

  return (
    <Panel className="flex flex-col gap-2" data-testid="regime-board">
      <PanelHeading title="Market regime" />
      {gateChip}
      <div className="flex flex-col divide-y divide-line/60">
        {data.map((indicator) => {
          const liveValue = liveById.get(indicator.id) ?? null;
          const bandFn = LIVE_BAND_FNS[indicator.id];
          const liveBand =
            liveValue !== null && bandFn !== undefined
              ? bandFn(liveValue, { warn: indicator.bandWarn, crisis: indicator.bandCrisis })
              : null;
          return (
            <Row
              key={indicator.id}
              indicator={indicator}
              dense={dense}
              liveValue={liveValue}
              liveBand={liveBand}
              delta={regimeDelta(indicator.id, macro)}
            />
          );
        })}
      </div>
      {ratesRow}
      <span
        className="flex items-center gap-1 font-mono text-[10px] text-dim"
        data-testid="regime-freshness"
      >
        {showLiveFooter ? (
          <>
            <span className="live-dot" aria-hidden="true" />
            LIVE
          </>
        ) : (
          freshness
        )}
      </span>
    </Panel>
  );
}

/** Memoized (RESEARCH Pitfall 4): MarketRail passes `liveIndices`/`liveStatus` straight
 *  through from the model without allocating a new object per render, so a 1/sec spot
 *  tick elsewhere on the Overview tree does not force this rail to re-render — only an
 *  actual VIX-family poll frame (~20s) changes these props by reference. */
export const RegimeBoard = memo(RegimeBoardImpl);
