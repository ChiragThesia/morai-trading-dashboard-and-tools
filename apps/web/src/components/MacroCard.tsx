import { useMacro } from "../hooks/useMacro.ts";
import { Panel, PanelHeading } from "./system/index.tsx";
import { cn } from "@/lib/utils";
import type { MacroResponse, MacroSeriesId } from "@morai/contracts";

/**
 * MacroCard — FRED rates/curve/vol backdrop + VVIX (Phase 14 FE, D-12).
 *
 * Renders the latest value per series as a tile grid: primary series top-billed
 * (DFF · SOFR · T10Y2Y · VIXCLS · VVIX, matching the stub's promise), secondary
 * series below (DGS1MO · DGS3MO · T10Y3M). Data via useMacro() — no props.
 *
 * Design-system only (tokens + Tailwind); layout-only inline styles for grid sizing.
 * Empty/loading → the same "run the job to populate" pattern as CotCard/Market's GEX card.
 */

const PRIMARY: ReadonlyArray<{ id: MacroSeriesId; label: string }> = [
  { id: "DFF", label: "Fed Funds" },
  { id: "SOFR", label: "SOFR" },
  { id: "T10Y2Y", label: "10Y−2Y" },
  { id: "VIXCLS", label: "VIX" },
  { id: "VVIX", label: "VVIX" },
];

const SECONDARY: ReadonlyArray<{ id: MacroSeriesId; label: string }> = [
  { id: "DGS1MO", label: "1M" },
  { id: "DGS3MO", label: "3M" },
  { id: "T10Y3M", label: "10Y−3M" },
];

// Index-level series display raw (VIX/VVIX quote points); everything else is a percent.
const INDEX_LEVEL_SERIES: ReadonlySet<MacroSeriesId> = new Set(["VIXCLS", "VVIX"]);

function fmtValue(seriesId: MacroSeriesId, value: number): string {
  return INDEX_LEVEL_SERIES.has(seriesId) ? value.toFixed(1) : `${value.toFixed(2)}%`;
}

function Tile({
  id,
  label,
  data,
  headline,
}: {
  id: MacroSeriesId;
  label: string;
  data: MacroResponse;
  headline?: boolean;
}): React.ReactElement {
  const points = data[id];
  const latest = points?.[points.length - 1];

  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-raise/40 px-2 py-1.5">
      <span
        className={cn(
          "font-display text-[10px] font-semibold tracking-[0.06em] uppercase",
          headline === true ? "text-txt" : "text-dim",
        )}
      >
        {label}
      </span>
      <span
        className="font-mono text-[11px] tabular-nums text-txt"
        data-testid={`macro-value-${id}`}
      >
        {latest === undefined ? "—" : fmtValue(id, latest.value)}
      </span>
    </div>
  );
}

export function MacroCard(): React.ReactElement {
  const { data, isPending } = useMacro();

  if (isPending && data === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 120 }}>
        <PanelHeading title="FRED macro — rates, curve & vol" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="macro-loading"
        >
          Loading macro backdrop…
        </div>
      </Panel>
    );
  }

  if (data === undefined || Object.keys(data).length === 0) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 120 }}>
        <PanelHeading title="FRED macro — rates, curve & vol" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="macro-empty"
        >
          Macro data unavailable — run the job to populate.
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid="macro-card">
      <PanelHeading
        title="FRED macro — rates, curve & vol"
        badge={
          <span className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim">
            Rates, curves & vol regime · the macro backdrop
          </span>
        }
      />

      <div className="grid grid-cols-5 gap-1.5">
        {PRIMARY.map((s) => (
          <Tile key={s.id} id={s.id} label={s.label} data={data} headline />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {SECONDARY.map((s) => (
          <Tile key={s.id} id={s.id} label={s.label} data={data} />
        ))}
      </div>
    </Panel>
  );
}
