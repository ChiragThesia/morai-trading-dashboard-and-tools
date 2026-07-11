/**
 * MobileRiskPanel — the mobile Overview chart block (35.1, D-05/D-06/D-09/D-13; row
 * slimmed per user UAT feedback 2026-07-11).
 *
 * ONE slim control row above a full-bleed PayoffChart: ghost `‹ › ` steppers around a
 * date PILL + a `⋯` overflow Dialog. The pill opens a Projection dialog (quick jump
 * chips + day slider + exact date input); the ⋯ Dialog holds ALL series toggles
 * (@ exp/Fan/Walls/Profit zone — same toggle state object the desktop uses, no second
 * store). Freshness reduces to one 9px caption line below the chart with a single
 * worst-of dot. Fully controlled — the model hook feeds every prop; PayoffChart
 * internals are untouched (D-06: mobile differences enter only via
 * showBePills/aspectRatio/highlightedPositionId).
 */
import { cn } from "@/lib/utils";
import type { GexSnapshotEntry } from "@morai/contracts";
import { Button, buttonClass } from "../../components/system/index.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { PayoffChart } from "../../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";
import type { PayoffPoint, SpotDomain } from "../../lib/scenario-engine.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import {
  parseLocalDateInput,
  toDateInputValue,
  daysBetween,
} from "../../lib/date-projection.ts";
import { relAge } from "../Market.tsx";

const noop = (): void => {};

const DIALOG_TITLE_CLASS =
  "font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase";

/** Quick projection jumps: label → whole-day offset from today. */
const QUICK_JUMPS: ReadonlyArray<{ readonly label: string; readonly offset: number }> = [
  { label: "+1w", offset: 7 },
  { label: "+2w", offset: 14 },
  { label: "+1m", offset: 30 },
];

export interface MobileRiskPanelProps {
  readonly scenario: {
    readonly payoffCurve: ReadonlyArray<PayoffPoint>;
    readonly expirationCurve: ReadonlyArray<PayoffPoint>;
  };
  readonly payoffDomain: SpotDomain;
  readonly spot: number;
  readonly gex: GexSnapshotEntry | undefined;
  readonly toggles: PayoffChartToggles;
  readonly onToggle: (key: keyof PayoffChartToggles) => void;
  readonly dateControl: PayoffDateControl;
  /** bounds.minIso IS today's ISO by the usePayoffDateControl/computeProjectionBounds
   *  contract — offsets and the slider range derive from it, dependency-free. */
  readonly bounds: { readonly minIso: string; readonly maxIso: string };
  readonly positionSetSignature: string;
  readonly excludedFromT0Count: number;
  readonly freshness: {
    readonly gexFresh: boolean;
    readonly gexAsOf: string;
    readonly gexAgeMs: number | null;
    readonly markFresh: boolean;
    readonly markAsOf: string;
    readonly markAgeMs: number | null;
  };
}

export function MobileRiskPanel({
  scenario,
  payoffDomain,
  spot,
  gex,
  toggles,
  onToggle,
  dateControl,
  bounds,
  positionSetSignature,
  excludedFromT0Count,
  freshness,
}: MobileRiskPanelProps): React.ReactElement {
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

  // Same {callWall,putWall,flip} mapping as the desktop call site.
  const gexWalls =
    gex !== undefined ? { callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip } : null;
  const bothFresh = freshness.gexFresh && freshness.markFresh;
  const gexAgeSegment = freshness.gexAgeMs !== null ? ` · ${relAge(freshness.gexAgeMs)}` : "";
  const markAgeSegment = freshness.markAgeMs !== null ? ` · ${relAge(freshness.markAgeMs)}` : "";

  return (
    <section>
      {/* ONE slim control row: ghost ‹ [date pill] › left, ⋯ right. */}
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

      {/* Chart — full-bleed (the section owns px-0; row and caption own px-4, D-05/D-06). */}
      <div data-testid="mobile-payoff" className="mt-2 w-full">
        <PayoffChart
          todayCurve={scenario.payoffCurve}
          fanCurves={[]}
          expirationCurve={scenario.expirationCurve}
          rollCurve={null}
          gex={gexWalls}
          domain={payoffDomain}
          spot={spot}
          toggles={toggles}
          fitY={false}
          onFitYConsumed={noop}
          positionSetSignature={positionSetSignature}
          baseExpirationCurve={scenario.expirationCurve}
          excludedFromT0Count={excludedFromT0Count}
          highlightedPositionId={null}
          showBePills={false}
          aspectRatio={1.3}
        />
      </div>

      {/* Single worst-of freshness caption (D-05). */}
      <div
        data-testid="mobile-freshness"
        className="flex items-center gap-1.5 px-4 mt-1.5 font-mono text-[9px] text-dim"
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", bothFresh ? "bg-up" : "bg-amber")}
        />
        <span className="truncate">
          GEX {freshness.gexAsOf}
          {gexAgeSegment} · mark {freshness.markAsOf}
          {markAgeSegment}
        </span>
      </div>
    </section>
  );
}
