/**
 * MobileRiskPanel — the mobile Overview chart block (35.1, D-05/D-06/D-09/D-13).
 *
 * Exactly ONE control row above a full-bleed PayoffChart: `‹ [date] ›` stepper +
 * right-aligned `@ exp` toggle + `⋯` overflow Dialog holding Today/Fan/Walls/Profit zone
 * (same toggle state object the desktop uses — no second store). Freshness reduces to
 * one 9px caption line below the chart with a single worst-of dot. Fully controlled —
 * the model hook feeds every prop; PayoffChart internals are untouched (D-06: mobile
 * differences enter only via showBePills/aspectRatio/highlightedPositionId).
 * Copy/classes verbatim from 35.1-UI-SPEC.md §3 + §Copywriting Contract.
 */
import { cn } from "@/lib/utils";
import type { GexSnapshotEntry } from "@morai/contracts";
import { Button, buttonClass } from "../../components/system/index.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { PayoffChart } from "../../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";
import type { PayoffPoint, SpotDomain } from "../../lib/scenario-engine.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import { relAge } from "../Market.tsx";

const noop = (): void => {};

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
   *  contract — the projected-state comparison stays dependency-free. */
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
  // Projected-state signal (UI-SPEC Open Question 2): violet ring on the date input
  // whenever the picked date is not today.
  const projected = dateControl.dateInputValue !== bounds.minIso;
  // Same {callWall,putWall,flip} mapping as the desktop call site.
  const gexWalls =
    gex !== undefined ? { callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip } : null;
  const bothFresh = freshness.gexFresh && freshness.markFresh;
  const gexAgeSegment = freshness.gexAgeMs !== null ? ` · ${relAge(freshness.gexAgeMs)}` : "";
  const markAgeSegment = freshness.markAgeMs !== null ? ` · ${relAge(freshness.markAgeMs)}` : "";

  return (
    <section>
      {/* ONE control row (D-05): ‹ [date] › left, @ exp + ⋯ right. */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex items-center gap-1">
          <Button
            size="touch"
            onClick={() => { dateControl.stepDate(-1); }}
            aria-label="Previous day"
          >
            ‹
          </Button>
          <input
            type="date"
            data-testid="date-picker-input"
            min={bounds.minIso}
            max={bounds.maxIso}
            value={dateControl.dateInputValue}
            onChange={(e) => { dateControl.setDate(e.target.value); }}
            style={{ colorScheme: "dark" }}
            className={cn(
              "min-h-11 shrink-0 snap-start rounded-[3px] border border-line2 bg-raise px-[7px] py-0.5 font-mono text-[11px] text-txt focus-visible:border-violet focus-visible:ring-2 focus-visible:ring-violet/40 focus-visible:outline-none",
              projected && "ring-1 ring-violet",
            )}
          />
          <Button
            size="touch"
            onClick={() => { dateControl.stepDate(1); }}
            aria-label="Next day"
          >
            ›
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="touch"
            variant="toggle"
            active={toggles.showExpiration}
            aria-pressed={toggles.showExpiration}
            onClick={() => { onToggle("showExpiration"); }}
          >
            @ exp
          </Button>
          {/* ⋯ overflow Dialog (D-09: real portal state, never a CSS reveal). */}
          <Dialog>
            <DialogTrigger
              aria-label="More chart options"
              className={buttonClass({ size: "touch" })}
            >
              ⋯
            </DialogTrigger>
            <DialogContent className="max-w-xs">
              <DialogTitle className="font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
                Chart
              </DialogTitle>
              <div className="flex flex-col gap-2">
                <Button
                  size="touch"
                  variant="secondary"
                  disabled={!projected}
                  onClick={dateControl.resetDate}
                  className="w-full"
                >
                  Today
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
