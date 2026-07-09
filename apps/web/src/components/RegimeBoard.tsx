import { useRegimeBoard } from "../hooks/useRegimeBoard.ts";
import { usePicker } from "../hooks/usePicker.ts";
import { Panel } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";
import type { RegimeBand, RegimeIndicator, PickerGate } from "@morai/contracts";

/**
 * RegimeBoard — the "Regime & breadth" board (Phase 24, BOARD-01/02) plus the picker's
 * entry-gate tile (Phase 28, PLAY-01, 28-06).
 *
 * A Panel holding a `grid grid-cols-2 gap-2 md:grid-cols-4` of Tile-shaped chips, one
 * per PRESENT indicator (a missing series is silently omitted — never a fabricated
 * dash chip, T-24-09). Each chip: label + ⓘ provenance tooltip (payload's own source +
 * rationale, BOARD-02) / band dot + value / as-of date. Reuses the existing "IV n/a"
 * Badge+Tooltip interaction verbatim (Overview.tsx) — no new atom, no new token.
 *
 * No internal PanelHeading — the mounting Overview section supplies the "Regime &
 * breadth" SectionLabel (avoids a duplicated title, unlike CotCard/MacroCard whose
 * internal titles differ from their section's SectionLabel).
 *
 * The entry-gate tile (GateChip, 28-06) reads `PickerSnapshotResponse.gate` straight
 * from `usePicker()` — a separate data source from the regime indicators above, so it
 * renders independently of the regime board's own loading/error/empty states and is
 * silently omitted (never a fabricated tile) when no snapshot is available yet. `state:
 * "blind"` (GATE BLIND, the never-silent age-tolerance fail-closed flag) reuses the same
 * `bg-downd`/`ring-down` "genuine alarm" filled treatment LiveStatusBadge's STALLED state
 * and MetricChip's `alert` prop already established — louder than the plain `text-down`
 * "blocked" state, no new visual language.
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
      className="flex flex-col gap-0.5 rounded-sm bg-raise/40 px-2 py-1.5"
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
        "flex flex-col gap-0.5 rounded-sm px-2 py-1.5",
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

export function RegimeBoard(): React.ReactElement {
  const { data, isPending, isError } = useRegimeBoard();
  // The entry-gate tile (28-06) is a separate data source (usePicker) from the regime
  // indicators above — silently omitted (T-24-09 "never a fabricated chip") when no
  // snapshot has been computed yet, and rendered in EVERY branch below (WR-02: never
  // suppressed by the regime board's own unrelated loading/error/empty state).
  const { data: pickerSnapshot } = usePicker();
  const gate = pickerSnapshot?.gate ?? null;
  const gateChip = gate !== null ? <GateChip gate={gate} /> : null;

  if (isPending && data === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-loading"
        >
          Loading regime board…
        </div>
        {gateChip}
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-error"
        >
          Regime board unavailable — check the FRED/CBOE fetch job.
        </div>
        {gateChip}
      </Panel>
    );
  }

  if (data === undefined || data.length === 0) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-empty"
        >
          Regime data unavailable — run fetch-rates to populate.
        </div>
        {gateChip}
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid="regime-board">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {data.map((indicator) => (
          <Chip key={indicator.id} indicator={indicator} />
        ))}
        {gateChip}
      </div>
    </Panel>
  );
}
