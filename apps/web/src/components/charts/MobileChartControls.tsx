/**
 * MobileChartControls — the shared mobile chart chrome row (Phase 36, D-05): the slim
 * `‹ [date pill] › … ⋯` control row above a full-bleed PayoffChart, extracted VERBATIM
 * out of MobileRiskPanel so both the Overview (MobileRiskPanel) and Analyzer mobile trees
 * mount the exact same chrome (desktop sibling: PayoffControls.tsx).
 *
 * ONE slim control row: ghost `‹ › ` steppers around a date PILL + a `⋯` overflow Dialog.
 * The pill opens a Projection dialog (quick jump chips + day slider + exact date input);
 * the ⋯ Dialog holds ALL series toggles (@ exp/Fan/Walls/Profit zone — the same toggle
 * state object the desktop uses, no second store). Fully controlled — every prop comes
 * from the parent's model hook.
 *
 * D-05 guard: the rendered DOM is byte-identical to the pre-extraction MobileRiskPanel row
 * (MobileRiskPanel.test.tsx passes with zero test edits). All date math anchors on
 * LOCAL-constructed dates (catch #22 / RESEARCH Pitfall 1).
 *
 * No any/as/!.
 */
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "../system/index.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import type { PayoffChartToggles } from "./PayoffChart.tsx";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import {
  parseLocalDateInput,
  toDateInputValue,
  daysBetween,
} from "../../lib/date-projection.ts";

const DIALOG_TITLE_CLASS =
  "font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase";

/** Quick projection jumps: label → whole-day offset from today. */
const QUICK_JUMPS: ReadonlyArray<{ readonly label: string; readonly offset: number }> = [
  { label: "+1w", offset: 7 },
  { label: "+2w", offset: 14 },
  { label: "+1m", offset: 30 },
];

export interface MobileChartControlsProps {
  readonly dateControl: PayoffDateControl;
  /** bounds.minIso IS today's ISO by the usePayoffDateControl/computeProjectionBounds
   *  contract — offsets and the slider range derive from it, dependency-free. */
  readonly bounds: { readonly minIso: string; readonly maxIso: string };
  readonly toggles: PayoffChartToggles;
  readonly onToggle: (key: keyof PayoffChartToggles) => void;
}

export function MobileChartControls({
  dateControl,
  bounds,
  toggles,
  onToggle,
}: MobileChartControlsProps): React.ReactElement {
  // All date math anchors on LOCAL-constructed dates (catch #22 / RESEARCH Pitfall 1).
  const todayLocal = parseLocalDateInput(bounds.minIso);
  const maxLocal = parseLocalDateInput(bounds.maxIso);
  const maxDays = todayLocal !== null && maxLocal !== null ? daysBetween(todayLocal, maxLocal) : 0;

  const isoAtOffset = (n: number): string => {
    if (todayLocal === null) return bounds.minIso;
    return toDateInputValue(
      new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate() + n),
    );
  };

  // daysForward is the CLAMPED offset — the pill always tells the truth the chart shows.
  const offset = dateControl.daysForward;
  const projected = offset !== 0;
  const pillDate =
    todayLocal === null
      ? dateControl.dateInputValue
      : new Date(
          todayLocal.getFullYear(),
          todayLocal.getMonth(),
          todayLocal.getDate() + offset,
        ).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const pillLabel = `${pillDate} · ${projected ? `+${String(offset)}d` : "today"}`;

  return (
    /* ONE slim control row: ghost ‹ [date pill] › left, ⋯ right. */
    <div className="flex items-center gap-1 px-4">
      <Button
        size="touch"
        variant="ghost"
        className="px-2 text-txt"
        onClick={() => { dateControl.stepDate(-1); }}
        aria-label="Previous day"
      >
        ‹
      </Button>
      {/* Projection dialog (D-09: real portal state, never a CSS reveal). */}
      <Dialog>
        <DialogTrigger
          data-testid="date-pill"
          aria-label="Projection date"
          className={cn(
            buttonClass({ size: "touch", variant: "ghost" }),
            "px-2 font-mono text-[11px] text-txt",
            projected && "text-violet ring-1 ring-violet",
          )}
        >
          {pillLabel}
        </DialogTrigger>
        <DialogContent className="max-w-xs">
          <DialogTitle className={DIALOG_TITLE_CLASS}>Projection</DialogTitle>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="touch"
                variant="secondary"
                disabled={!projected}
                onClick={dateControl.resetDate}
              >
                Today
              </Button>
              {QUICK_JUMPS.map(({ label, offset: jump }) => (
                <Button
                  key={label}
                  size="touch"
                  variant="secondary"
                  disabled={jump > maxDays}
                  onClick={() => { dateControl.setDate(isoAtOffset(jump)); }}
                >
                  {label}
                </Button>
              ))}
              <Button
                size="touch"
                variant="secondary"
                disabled={maxDays === 0}
                onClick={() => { dateControl.setDate(bounds.maxIso); }}
                className="col-span-2"
              >
                Expiry
              </Button>
            </div>
            <div data-testid="date-readout" className="font-mono text-[11px] text-txt">
              {pillLabel}
            </div>
            <input
              type="range"
              data-testid="date-slider"
              aria-label="Days forward"
              min={0}
              max={maxDays}
              value={offset}
              onChange={(e) => {
                const n = Number(e.target.value);
                dateControl.setDate(isoAtOffset(Number.isFinite(n) ? n : 0));
              }}
              className="w-full accent-violet"
            />
            <input
              type="date"
              data-testid="date-picker-input"
              min={bounds.minIso}
              max={bounds.maxIso}
              value={dateControl.dateInputValue}
              onChange={(e) => { dateControl.setDate(e.target.value); }}
              style={{ colorScheme: "dark" }}
              className="min-h-11 w-full rounded-[3px] border border-line2 bg-raise px-[7px] py-0.5 font-mono text-[11px] text-txt focus-visible:border-violet focus-visible:ring-2 focus-visible:ring-violet/40 focus-visible:outline-none"
            />
          </div>
        </DialogContent>
      </Dialog>
      <Button
        size="touch"
        variant="ghost"
        className="px-2 text-txt"
        onClick={() => { dateControl.stepDate(1); }}
        aria-label="Next day"
      >
        ›
      </Button>
      <div className="ml-auto">
        {/* ⋯ overflow Dialog — ALL series toggles live here (D-09). */}
        <Dialog>
          <DialogTrigger
            aria-label="More chart options"
            className={buttonClass({ size: "touch" })}
          >
            ⋯
          </DialogTrigger>
          <DialogContent className="max-w-xs">
            <DialogTitle className={DIALOG_TITLE_CLASS}>Chart</DialogTitle>
            <div className="flex flex-col gap-2">
              <Button
                size="touch"
                variant="toggle"
                active={toggles.showExpiration}
                aria-pressed={toggles.showExpiration}
                onClick={() => { onToggle("showExpiration"); }}
                className="w-full"
              >
                @ exp
              </Button>
              <Button
                size="touch"
                variant="toggle"
                active={toggles.showFan}
                aria-pressed={toggles.showFan}
                onClick={() => { onToggle("showFan"); }}
                className="w-full"
              >
                Fan
              </Button>
              <Button
                size="touch"
                variant="toggle"
                active={toggles.showWalls}
                aria-pressed={toggles.showWalls}
                onClick={() => { onToggle("showWalls"); }}
                className="w-full"
              >
                Walls
              </Button>
              <Button
                size="touch"
                variant="toggle"
                active={toggles.showProfitZone}
                aria-pressed={toggles.showProfitZone}
                onClick={() => { onToggle("showProfitZone"); }}
                className="w-full"
              >
                Profit zone
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
