/**
 * CandidateCard — one ranked calendar candidate row in the picker's "Suggested calendars" rail
 * (ANLZ-01, D-01/D-05).
 *
 * Renders the header (name + score), the sub-line (DTE/debit/theta/vega + event tags), and 4
 * data-driven breakdown bars looked up from `candidate.breakdown` BY CRITERION NAME — never a
 * hard-coded array index — in the fixed display order slope → fwdEdge → gexFit →
 * eventAdjustment. The 5th breakdown entry (`beVsEm`) is present in the data but intentionally
 * never rendered as a card bar (D-05) — it surfaces only in the why-panel/scenario strip (18-05).
 *
 * Guard case (fwdIv === null, D-01a/D-06): the fwd-edge bar renders zero-width with an "n/a"
 * caption instead of a NaN/throw, regardless of what `contribution` the guard candidate carries.
 *
 * Hand-rolled bar fills (bg-violet/bg-blue/bg-up/bg-amber Tailwind tokens, no hardcoded hex)
 * mirror PayoffChart.tsx's existing hand-rolled precedent (UI-SPEC Registry Safety).
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, BreakdownEntry } from "@morai/contracts";

const BAR_ORDER = ["slope", "fwdEdge", "gexFit", "eventAdjustment"] as const;
type BarCriterion = (typeof BAR_ORDER)[number];

const BAR_LABEL: Record<BarCriterion, string> = {
  slope: "slope",
  fwdEdge: "fwd edge",
  gexFit: "GEX fit",
  eventAdjustment: "event adj",
};

const BAR_FILL_CLASS: Record<BarCriterion, string> = {
  slope: "bg-violet",
  fwdEdge: "bg-blue",
  gexFit: "bg-up",
  eventAdjustment: "bg-amber",
};

/** Per-criterion caption formatter — exhaustive over the full breakdownEntry enum (never a default). */
function formatBreakdownCaption(entry: BreakdownEntry): string {
  switch (entry.criterion) {
    case "slope":
    case "fwdEdge":
      return `${(entry.rawValue * 100).toFixed(1)}v`;
    case "gexFit":
      return `${(entry.rawValue * 100).toFixed(0)}%`;
    case "eventAdjustment":
      return entry.rawValue >= 1 ? "ok" : "−";
    case "beVsEm":
      return `${(entry.rawValue * 100).toFixed(0)}%`;
  }
}

export interface CandidateCardProps {
  readonly candidate: PickerCandidate;
  readonly selected: boolean;
  readonly compared: boolean;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onCompareToggle: (candidate: PickerCandidate) => void;
}

export function CandidateCard({
  candidate,
  selected,
  compared,
  onSelect,
  onCompareToggle,
}: CandidateCardProps): React.ReactElement {
  const guardFwdEdge = candidate.fwdIv === null;
  const hasEvents = candidate.frontEvents.length > 0 || candidate.backEvents.length > 0;

  return (
    <div
      onClick={() => onSelect(candidate)}
      className={cn(
        "cursor-pointer rounded-lg border px-2.5 py-2",
        selected ? "border-violet bg-violet/[0.06]" : "border-line bg-transparent hover:border-line2",
      )}
      data-testid={`candidate-card-${candidate.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-sm font-bold text-txt">{candidate.name}</span>
        <span className="font-display text-sm font-bold text-violet">{candidate.score}</span>
      </div>

      <div className="mt-0.5 font-mono text-[9px] text-dim">
        {`DTE ${candidate.frontLeg.dte}/${candidate.backLeg.dte} · debit $${candidate.debit.toFixed(0)} · θ +${candidate.theta.toFixed(1)}/d · vega +${candidate.vega.toFixed(0)}`}
        {candidate.frontEvents.map((ev) => (
          <span key={`f-${ev}`} className="ml-1 rounded-sm bg-raise px-1 py-0.5 text-amber">
            {`${ev}◂f`}
          </span>
        ))}
        {candidate.backEvents.map((ev) => (
          <span key={`b-${ev}`} className="ml-1 rounded-sm bg-raise px-1 py-0.5 text-amber opacity-60">
            {`${ev}◂b`}
          </span>
        ))}
        {!hasEvents && (
          <span className="ml-1 rounded-sm bg-raise px-1 py-0.5 text-dim">clean</span>
        )}
      </div>

      <div className="mt-1.5 flex flex-col gap-1">
        {BAR_ORDER.map((criterion) => {
          const entry = candidate.breakdown.find((b) => b.criterion === criterion);
          if (entry === undefined) return null;
          const isGuardBar = criterion === "fwdEdge" && guardFwdEdge;
          const width = isGuardBar ? 0 : Math.min(100, Math.max(0, entry.contribution));
          const caption = isGuardBar ? "n/a" : formatBreakdownCaption(entry);
          return (
            <div key={criterion} className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 font-mono text-[9px] text-dim">{BAR_LABEL[criterion]}</span>
              <span className="h-[5px] flex-1 rounded-full bg-raise">
                <span
                  className={cn("block h-full rounded-full", BAR_FILL_CLASS[criterion])}
                  style={{ width: `${width}%` }}
                  data-testid={`breakdown-bar-fill-${criterion}`}
                />
              </span>
              <span className="w-9 shrink-0 text-right font-mono text-[9px] text-dim">{caption}</span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCompareToggle(candidate);
        }}
        className={cn(
          "mt-1.5 cursor-pointer rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px]",
          compared ? "border-amber/60 bg-amber/10 text-amber" : "border-line2 bg-transparent text-dim",
        )}
      >
        {compared ? "✕ Remove compare" : "⊕ Compare"}
      </button>
    </div>
  );
}
