import { useRegimeBoard } from "../hooks/useRegimeBoard.ts";
import { usePicker } from "../hooks/usePicker.ts";
import { useMacro } from "../hooks/useMacro.ts";
import { Panel, PanelHeading } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";
import type { RegimeBand, RegimeIndicator, PickerGate, MacroResponse, MacroSeriesId } from "@morai/contracts";

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
 *  client-side (T-31-05). Not BAND_CLASSES.dot (removed): calm needs a visible-but-unaccented
 *  color to read as a positioned marker, not the old dim `bg-line2` dot's near-invisible calm. */
const MARKER_CLASSES: Record<RegimeBand, string> = {
  calm: "bg-txt",
  warning: "bg-amber",
  crisis: "bg-down",
};

/** Fixed per-indicator visual axis (where the ruler starts/ends) — NOT semantic thresholds.
 *  Warn/crisis band positions come from the response (indicator.bandWarn/bandCrisis), Phase-29
 *  overrides-aware; this map only bounds the gauge's min/max (31-UI-SPEC.md §2). */
const GAUGE_SCALE: Record<string, { min: number; max: number }> = {
  "vix-term-structure": { min: 0.6, max: 1.2 },
  vvix: { min: 70, max: 150 },
  "vix9d-vix": { min: 0.7, max: 1.3 },
  "hy-oas": { min: 1.5, max: 8.0 },
};

/** Dense-mode label shortening (keeps rows single-line) — also used for the freshness
 *  footer's date-exception tags. The full name stays legible at non-dense width. */
const SHORT_LABELS: Record<string, string> = {
  "vix-term-structure": "VIX/VIX3M",
  "hy-oas": "HY OAS",
};

/** Percent position of `value` on `[min, max]` — NOT clamped. Only `clampedAxisPct` (below)
 *  is safe for on-track positioning (marker, band segments); raw output can fall outside
 *  [0, 100] when `value` is outside `[min, max]`. */
function axisPct(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}

/** Clamped percent position — used for the marker only, so a value outside the visual axis
 *  still pins to an axis end instead of overflowing the track (the printed numeric value on
 *  line 1 is never clamped, only this marker position). */
function clampedAxisPct(value: number, min: number, max: number): number {
  return Math.min(100, Math.max(0, axisPct(value, min, max)));
}

function shortLabel(indicator: RegimeIndicator, dense: boolean): string {
  return dense ? (SHORT_LABELS[indicator.id] ?? indicator.label) : indicator.label;
}

/** One regime indicator = one compact two-line row: label + value (mono tabular, only an
 *  abnormal band adds color + weight), then a banded bullet gauge — value marker on a
 *  warn/crisis-banded track — so proximity to the edge reads at a glance (DEFECT-2). Band
 *  edges come from the response's bandWarn/bandCrisis (Phase-29 effective config, threaded
 *  by getRegimeBoard.ts); GAUGE_SCALE is only the client-side visual axis. */
function Row({ indicator, dense }: { indicator: RegimeIndicator; dense: boolean }): React.ReactElement {
  const band = BAND_CLASSES[indicator.band];
  const abnormal = indicator.band !== "calm";
  // ponytail: all 4 live regimeIndicator ids are in GAUGE_SCALE; this fallback only guards a
  // future 5th indicator id shipping before its GAUGE_SCALE entry does.
  const scale = GAUGE_SCALE[indicator.id] ?? { min: 0, max: Math.max(indicator.bandCrisis, indicator.value, 1) };
  // Clamped like the marker (CR-01): an effective bandWarn/bandCrisis outside GAUGE_SCALE
  // (Phase-29 override, or a real print past the fixed axis) must never yield a negative
  // CSS width — it saturates at the axis edge instead.
  const warnPct = clampedAxisPct(indicator.bandWarn, scale.min, scale.max);
  const crisisPct = clampedAxisPct(indicator.bandCrisis, scale.min, scale.max);
  const valuePct = clampedAxisPct(indicator.value, scale.min, scale.max);

  return (
    <div className="flex flex-col gap-1 py-1.5" data-testid={`regime-chip-${indicator.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
            {shortLabel(indicator, dense)}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                data-testid={`regime-why-${indicator.id}`}
                aria-label={`${indicator.label} source and rationale`}
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
                  className="border-line2 px-1 py-0 font-mono text-[9px] text-dim"
                >
                  ⓘ
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex max-w-xs flex-col gap-1 font-mono text-xs leading-[1.45] text-muted-foreground">
                  <span>{indicator.source}</span>
                  <span>{indicator.rationale}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            band.text,
            abnormal && "font-semibold",
          )}
          data-testid={`regime-value-${indicator.id}`}
        >
          {indicator.value.toFixed(2)}
        </span>
      </div>
      <div
        role="meter"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-line2"
        aria-valuenow={indicator.value}
        aria-valuemin={scale.min}
        aria-valuemax={scale.max}
        aria-valuetext={`${indicator.value.toFixed(2)} — ${indicator.band}`}
        aria-label={`${indicator.label} gauge`}
        data-testid={`regime-gauge-${indicator.id}`}
      >
        <div
          className="absolute inset-y-0 bg-amber/30"
          style={{ left: `${warnPct}%`, width: `${crisisPct - warnPct}%` }}
        />
        <div
          className="absolute inset-y-0 bg-down/30"
          style={{ left: `${crisisPct}%`, width: `${100 - crisisPct}%` }}
        />
        <div
          className={cn(
            "absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full",
            MARKER_CLASSES[indicator.band],
          )}
          style={{ left: `${valuePct}%` }}
          data-testid={`regime-gauge-marker-${indicator.id}`}
        />
      </div>
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
 *  banded VVIX indicator above and the entry-gate chip's VIX reading). */
const RATES: ReadonlyArray<{ id: MacroSeriesId; label: string }> = [
  { id: "DFF", label: "Fed Funds" },
  { id: "SOFR", label: "SOFR" },
  { id: "DGS1MO", label: "1M" },
  { id: "DGS3MO", label: "3M" },
  { id: "T10Y2Y", label: "10Y−2Y" },
  { id: "T10Y3M", label: "10Y−3M" },
];

function fmtRate(data: MacroResponse, id: MacroSeriesId): string {
  const points = data[id];
  const latest = points?.[points.length - 1];
  return latest === undefined ? "—" : `${latest.value.toFixed(2)}%`;
}

/** RateRow — a backdrop value as a compact label/value row (not a pill). Dimmer + smaller
 *  than the regime values above so the rates read as context, not signal. */
function RateRow({ id, label, value }: { id: MacroSeriesId; label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2" data-testid={`rate-chip-${id}`}>
      <span className="font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

/** `dense` shortens long indicator labels for the narrow left MarketRail; layout is the
 *  same scannable row column at every width now (the old 2×2 / 4-across card grid is gone). */
export function RegimeBoard({ dense = false }: { dense?: boolean } = {}): React.ReactElement {
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
          <RateRow key={r.id} id={r.id} label={r.label} value={fmtRate(macro, r.id)} />
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

  return (
    <Panel className="flex flex-col gap-2" data-testid="regime-board">
      <PanelHeading title="Market regime" />
      {gateChip}
      <div className="flex flex-col divide-y divide-line/60">
        {data.map((indicator) => (
          <Row key={indicator.id} indicator={indicator} dense={dense} />
        ))}
      </div>
      {ratesRow}
      <span className="font-mono text-[10px] text-dim" data-testid="regime-freshness">
        {freshness}
      </span>
    </Panel>
  );
}
