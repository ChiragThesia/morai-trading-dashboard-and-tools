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
 * Guard cases (never NaN/throw, always zero-width + "n/a" caption):
 *   - `fwdEdge` when `candidate.fwdIv === null` (D-01a/D-06, term-structure inversion).
 *   - `gexFit` when `gexContextStatus !== "ok"` (Phase 19, D-17 — degraded GEX context).
 *   - `eventAdjustment` when `eventsContextStatus !== "ok"` (Phase 19, D-17 — degraded events
 *     context). Reuses the exact fwdEdge guard-bar visual — never a new zero-state (19-UI-SPEC).
 *
 * Per-card staleness+source tag (Phase 19, D-15/D-16, PICK-02 success criterion 3): every card
 * is self-contained, repeating the snapshot-level `observedAt`/`source` fields so a stale/degraded
 * snapshot never reads as fresh/clean (T-19-21). `observedAt` is the full-ISO real instant
 * (WR-03), not the date-only `asOf` reference date.
 *
 * Hand-rolled bar fills (bg-violet/bg-blue/bg-up/bg-amber Tailwind tokens, no hardcoded hex)
 * mirror PayoffChart.tsx's existing hand-rolled precedent (UI-SPEC Registry Safety).
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, BreakdownEntry } from "@morai/contracts";
import { GEX_FRESH_MS } from "../../screens/Market.tsx";

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
      // rawValue is the penalty sum (0 = clean, higher = worse) — WR-02: a penalty present
      // must read as the warning state, not "ok".
      return entry.rawValue > 0 ? "−" : "ok";
    case "beVsEm":
      return `${(entry.rawValue * 100).toFixed(0)}%`;
  }
}

/**
 * formatAsOf — "as of {HH:MM}" (24h) + freshness, guarded against an unparseable `observedAt`.
 * Never renders "Invalid Date" — an unparseable/NaN timestamp falls back to "as of —" and is
 * treated as stale (the safe direction per T-19-21: never claim freshness you can't prove).
 *
 * WR-03: takes the snapshot's full-ISO `observedAt` instant, NOT the date-only `asOf` reference
 * date — a date-only value made the dot always amber and the HH:MM label a constant
 * timezone-offset artifact of UTC midnight, never the real snapshot instant.
 */
function formatAsOf(observedAt: string): { readonly label: string; readonly fresh: boolean } {
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) {
    return { label: "as of —", fresh: false };
  }
  const ageMs = Date.now() - ts;
  const hhmm = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return { label: `as of ${hhmm}`, fresh: ageMs >= 0 && ageMs < GEX_FRESH_MS };
}

export interface CandidateCardProps {
  readonly candidate: PickerCandidate;
  readonly selected: boolean;
  readonly combined: boolean;
  readonly copied: boolean;
  /**
   * Snapshot-level fields (D-15/D-16/D-17) — identical across every card in a given fetch.
   * `observedAt` (WR-03) is the full-ISO real instant, not the date-only `asOf` reference date.
   */
  readonly observedAt: string;
  readonly source: "schwab" | "cboe";
  readonly gexContextStatus: "ok" | "stale" | "missing";
  readonly eventsContextStatus: "ok" | "stale" | "missing";
  /**
   * True for the single user-pasted calendar (id "pasted") pinned atop the rail. Swaps the
   * numeric score for a "PASTED" pill, the sub-line for DTE/debit/IV (no θ/vega — a paste has
   * no greeks, and lean means no fabricated numbers), and suppresses the scoring-context tags
   * (freshness/GEX/events) that don't apply to an ad-hoc paste. Defaults to false.
   */
  readonly pasted?: boolean;
  readonly onSelect: (candidate: PickerCandidate) => void;
  readonly onToggleCombine: (candidate: PickerCandidate) => void;
  readonly onCopy: (candidate: PickerCandidate) => void;
  /**
   * Removes this pasted card from the rail (multi-paste redesign — each pasted card manages
   * itself independently). Only rendered when `pasted` is true AND this is provided; a
   * scored/engine candidate is never removable.
   */
  readonly onRemove?: (candidate: PickerCandidate) => void;
}

export function CandidateCard({
  candidate,
  selected,
  combined,
  copied,
  observedAt,
  source,
  gexContextStatus,
  eventsContextStatus,
  pasted = false,
  onSelect,
  onToggleCombine,
  onCopy,
  onRemove,
}: CandidateCardProps): React.ReactElement {
  const guardFwdEdge = candidate.fwdIv === null;
  const guardGexFit = gexContextStatus !== "ok";
  const guardEventAdjustment = eventsContextStatus !== "ok";
  const hasEvents = candidate.frontEvents.length > 0 || candidate.backEvents.length > 0;
  const staleness = formatAsOf(observedAt);

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
        {pasted ? (
          <span className="flex items-center gap-1">
            <span className="rounded-sm bg-violet/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-violet">
              PASTED
            </span>
            {onRemove !== undefined && (
              <button
                type="button"
                data-testid={`remove-pasted-${candidate.id}`}
                title="Remove this pasted calendar"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(candidate);
                }}
                className="cursor-pointer rounded-[3px] border border-line2 bg-transparent px-1 font-mono text-[10px] leading-none text-dim hover:text-txt"
              >
                {"×"}
              </button>
            )}
          </span>
        ) : (
          <span className="font-display text-sm font-bold text-violet">{candidate.score}</span>
        )}
      </div>

      <div className="mt-0.5 font-mono text-[9px] text-dim">
        {pasted ? (
          `DTE ${candidate.frontLeg.dte}/${candidate.backLeg.dte} · debit $${candidate.debit.toFixed(0)} · IV ${(candidate.frontLeg.iv * 100).toFixed(1)}%`
        ) : (
          <>
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
            <span className="ml-1 flex items-center gap-1 rounded-sm bg-raise px-1 py-0.5">
              <span className={cn("size-1.5 rounded-full", staleness.fresh ? "bg-up" : "bg-amber")} />
              {`${staleness.label} · ${source}`}
            </span>
            {guardGexFit && (
              <span className="ml-1 rounded-sm bg-raise px-1 py-0.5 text-amber">GEX unavailable</span>
            )}
            {guardEventAdjustment && (
              <span className="ml-1 rounded-sm bg-raise px-1 py-0.5 text-amber">events unavailable</span>
            )}
          </>
        )}
      </div>

      <div className="mt-1.5 flex flex-col gap-1">
        {BAR_ORDER.map((criterion) => {
          const entry = candidate.breakdown.find((b) => b.criterion === criterion);
          if (entry === undefined) return null;
          const isGuardBar =
            (criterion === "fwdEdge" && guardFwdEdge) ||
            (criterion === "gexFit" && guardGexFit) ||
            (criterion === "eventAdjustment" && guardEventAdjustment);
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

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          data-testid={`combine-${candidate.id}`}
          title="Add this calendar to the combined-book payoff"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCombine(candidate);
          }}
          className={cn(
            "cursor-pointer rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px]",
            combined ? "border-amber/60 bg-amber/10 text-amber" : "border-line2 bg-transparent text-dim",
          )}
        >
          {combined ? "✓ Combined" : "⊕ Combine"}
        </button>
        <button
          type="button"
          data-testid={`copy-tos-${candidate.id}`}
          title="Copy this calendar as a Thinkorswim order"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(candidate);
          }}
          className={cn(
            "cursor-pointer rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px]",
            copied ? "border-violet/60 bg-violet/10 text-txt" : "border-line2 bg-transparent text-dim",
          )}
        >
          {copied ? "Copied ✓" : "⧉ Copy"}
        </button>
      </div>
    </div>
  );
}
