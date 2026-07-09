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
 * RegimeBoard — the "Market regime" board (Phase 24, BOARD-01/02; merged with the former
 * FRED macro card in the post-v1.3 tweak) plus the picker's entry-gate tile (Phase 28,
 * PLAY-01, 28-06).
 *
 * A Panel with an internal "Market regime" PanelHeading, holding two rows:
 *   - Row 1: `grid grid-cols-2 gap-2 md:grid-cols-4` of Chip-shaped regime indicators, one
 *     per PRESENT indicator (a missing series is silently omitted — never a fabricated
 *     dash chip, T-24-09), plus the entry-gate tile.
 *   - Row 2: raw FRED rates/curve backdrop chips (RateChip) — Fed Funds, SOFR, 1M, 3M,
 *     10Y−2Y, 10Y−3M. The bare VIX/VVIX chips the old MacroCard rendered are dropped —
 *     VVIX is already a banded regime indicator above and VIX lives in the entry-gate
 *     chip + pill header.
 *
 * All chips in both rows are pill-shaped (rounded-full) per the merge's visual spec.
 * Each indicator chip: label + ⓘ provenance tooltip (payload's own source + rationale,
 * BOARD-02) / band dot + value / as-of date. Reuses the existing "IV n/a" Badge+Tooltip
 * interaction verbatim (Overview.tsx) — no new atom, no new token.
 *
 * The entry-gate tile (GateChip, 28-06) reads `PickerSnapshotResponse.gate` straight
 * from `usePicker()`, and the rates row reads `useMacro()` — both separate data sources
 * from the regime indicators above, so they render independently of the regime board's
 * own loading/error/empty states and are silently omitted (never fabricated) when no
 * data is available yet. `state: "blind"` (GATE BLIND, the never-silent age-tolerance
 * fail-closed flag) reuses the same `bg-downd`/`ring-down` "genuine alarm" filled
 * treatment LiveStatusBadge's STALLED state and MetricChip's `alert` prop already
 * established — louder than the plain `text-down` "blocked" state, no new visual
 * language.
 */

const BAND_CLASSES: Record<RegimeBand, { dot: string; text: string }> = {
  calm: { dot: "bg-up", text: "text-up" },
  warning: { dot: "bg-amber", text: "text-amber" },
  crisis: { dot: "bg-down", text: "text-down" },
};

function Chip({ indicator }: { indicator: RegimeIndicator }): React.ReactElement {
  const band = BAND_CLASSES[indicator.band];

  return (
    <div
      className="flex flex-col gap-0.5 rounded-full bg-raise/40 px-2 py-1.5"
      data-testid={`regime-chip-${indicator.id}`}
    >
      <div className="flex items-center gap-1">
        <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
          {indicator.label}
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
      <div className="flex items-center gap-1.5">
        <span
          className={cn("size-1.5 rounded-full", band.dot)}
          data-testid={`regime-band-${indicator.id}`}
          aria-hidden="true"
        />
        <span
          className={cn("font-display text-base font-bold tabular-nums", band.text)}
          data-testid={`regime-value-${indicator.id}`}
        >
          {indicator.value.toFixed(2)}
        </span>
      </div>
      <span
        className="font-mono text-[10px] text-dim"
        data-testid={`regime-asof-${indicator.id}`}
      >
        as of {indicator.asOf}
      </span>
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

/** GateChip — the picker's entry-gate tile (28-06, PLAY-01/T-28-17). Every value is read
 *  straight from `PickerSnapshotResponse.gate` — no client-side band recomputation.
 *  `state: "blind"` gets the SAME filled `bg-downd`/`ring-down` alarm treatment
 *  LiveStatusBadge's STALLED state already established — louder than "blocked", which
 *  only colors the state label/dot. */
function GateChip({ gate }: { gate: PickerGate }): React.ReactElement {
  const isBlind = gate.state === "blind";
  const brake = brakeLabel(gate.brakes);

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-full px-2 py-1.5",
        isBlind ? "bg-downd ring-1 ring-down/40" : "bg-raise/40",
      )}
      data-testid="gate-chip"
    >
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
        Entry gate
      </span>
      <span
        className={cn(
          "font-display text-base font-bold tabular-nums uppercase",
          GATE_STATE_TEXT_CLASS[gate.state],
        )}
        data-testid="gate-state"
      >
        {GATE_STATE_LABEL[gate.state]}
      </span>
      <span className="font-mono text-[10px] text-dim" data-testid="gate-metrics">
        {`VIX ${gate.vix === null ? "—" : gate.vix.toFixed(2)} · ratio ${gate.ratio === null ? "—" : gate.ratio.toFixed(2)}`}
      </span>
      <span className="font-mono text-[10px] text-dim" data-testid="gate-asof">
        {`as of ${gate.asOf ?? "—"}`}
      </span>
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

/** RateChip — a raw backdrop value pill, following MetricChip's exact classes
 *  (components/system/index.tsx) but pill-shaped (rounded-full) for this merged panel. */
function RateChip({ id, label, value }: { id: MacroSeriesId; label: string; value: string }): React.ReactElement {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-raise/40 px-3 py-1.5 ring-1 ring-line"
      data-testid={`rate-chip-${id}`}
    >
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-display text-base font-bold tabular-nums text-txt">{value}</span>
    </div>
  );
}

export function RegimeBoard(): React.ReactElement {
  const { data, isPending, isError } = useRegimeBoard();
  // The entry-gate tile (28-06) is a separate data source (usePicker) from the regime
  // indicators above — silently omitted (T-24-09 "never a fabricated chip") when no
  // snapshot has been computed yet, and rendered in EVERY branch below (WR-02: never
  // suppressed by the regime board's own unrelated loading/error/empty state).
  const { data: pickerSnapshot } = usePicker();
  const gate = pickerSnapshot?.gate ?? null;
  const gateChip = gate !== null ? <GateChip gate={gate} /> : null;

  // The rates row (former MacroCard) is a third, independent data source (useMacro) —
  // same "silently omit, never fabricate" treatment as the gate chip, rendered in EVERY
  // branch below.
  const { data: macro } = useMacro();
  const ratesRow =
    macro !== undefined && Object.keys(macro).length > 0 ? (
      <div className="flex flex-wrap gap-2" data-testid="regime-rates-row">
        {RATES.map((r) => (
          <RateChip key={r.id} id={r.id} label={r.label} value={fmtRate(macro, r.id)} />
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

  return (
    <Panel className="flex flex-col gap-2" data-testid="regime-board">
      <PanelHeading title="Market regime" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {data.map((indicator) => (
          <Chip key={indicator.id} indicator={indicator} />
        ))}
        {gateChip}
      </div>
      {ratesRow}
    </Panel>
  );
}
