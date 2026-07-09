import { useRegimeBoard } from "../hooks/useRegimeBoard.ts";
import { Panel, PanelHeading } from "./system/index.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils";
import type { RegimeBand, RegimeIndicator } from "@morai/contracts";

/**
 * RegimeBoard — the "Regime & breadth" board (Phase 24, BOARD-01/02).
 *
 * A Panel holding a `grid grid-cols-2 gap-2 md:grid-cols-4` of Tile-shaped chips, one
 * per PRESENT indicator (a missing series is silently omitted — never a fabricated
 * dash chip, T-24-09). Each chip: label + ⓘ provenance tooltip (payload's own source +
 * rationale, BOARD-02) / band dot + value / as-of date. Reuses the existing "IV n/a"
 * Badge+Tooltip interaction verbatim (Overview.tsx) — no new atom, no new token.
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

export function RegimeBoard(): React.ReactElement {
  const { data, isPending, isError } = useRegimeBoard();

  if (isPending && data === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Regime & breadth" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-loading"
        >
          Loading regime board…
        </div>
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Regime & breadth" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-error"
        >
          Regime board unavailable — check the FRED/CBOE fetch job.
        </div>
      </Panel>
    );
  }

  if (data === undefined || data.length === 0) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 96 }}>
        <PanelHeading title="Regime & breadth" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="regime-empty"
        >
          Regime data unavailable — run fetch-rates to populate.
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid="regime-board">
      <PanelHeading title="Regime & breadth" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {data.map((indicator) => (
          <Chip key={indicator.id} indicator={indicator} />
        ))}
      </div>
    </Panel>
  );
}
