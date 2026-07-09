/**
 * HeldPositionsPanel — the "Held positions" panel (EXIT-07): one non-clickable,
 * CandidateCard-style row per open calendar carrying its own exit verdict for this cycle,
 * per 26-UI-SPEC's "Held-position row anatomy". Chip severity (HOLD/TAKE/ROLL plain vs
 * STOP/EXIT_PRE_EVENT escalated-fill, distinct hues) and the indicative override (T-26-16: an
 * indicative STOP/TAKE never renders its escalated colors) plus the CHANGED marker are the
 * ENTIRE EXIT-09 alert surface — no toast, no banner. No onSelect/button/order affordance
 * anywhere in this panel (EXIT-10, T-26-17) — advise + alert only.
 *
 * Analyzer.tsx owns the Loading/Error/Cold-start/Empty states (D-18/D-19 precedent); this
 * component only renders the Loaded case's rows.
 */
import { cn } from "@/lib/utils";
import type { HeldPositionVerdict, ExitMetric, ExitVerdictEnum } from "@morai/contracts";
import { Panel, PanelHeading, MetricChip } from "../components/system/index.tsx";
import { GEX_FRESH_MS } from "./Market.tsx";

/** The verdict's OWN color — shared by the value text (when not forced INDICATIVE) and the
 * CHANGED marker (Color contract: "a changed STOP shows CHANGED in text-down..."). */
function verdictColorClass(verdict: ExitVerdictEnum): string {
  switch (verdict) {
    case "HOLD":
      return "text-txt";
    case "TAKE":
      return "text-up";
    case "ROLL":
    case "EXIT_PRE_EVENT":
      return "text-amber";
    case "STOP":
      return "text-down";
  }
}

/** Exact locked verdict strings (Copywriting Contract). STOP's server-side rung label uses an
 * ASCII hyphen (exit-rules.ts STOP_RUNGS); swapped for the UI's minus-sign glyph, display-only. */
function verdictLabel(verdict: ExitVerdictEnum, rung: string | null): string {
  switch (verdict) {
    case "HOLD":
      return "HOLD";
    case "ROLL":
      return "ROLL";
    case "EXIT_PRE_EVENT":
      return "EXIT — pre-event";
    case "TAKE":
      return rung === null ? "TAKE" : `TAKE ${rung}`;
    case "STOP":
      return rung === null ? "STOP" : `STOP ${rung.replace("-", "−")}`;
  }
}

/** "{metricName} {value}" — the raw metric only, never a fabricated confidence/probability
 * (EXIT-04). pnlPct/termInversion/gammaOffStrike are fractional (×100 reads the same at n=13);
 * daysToEvent/dteFront are already plain counts. */
function formatMetric(metric: ExitMetric): string {
  const sign = metric.value < 0 ? "−" : metric.value > 0 ? "+" : "";
  const abs = Math.abs(metric.value);
  const isFraction =
    metric.name === "pnlPct" || metric.name === "termInversion" || metric.name === "gammaOffStrike";
  return `${metric.name} ${sign}${isFraction ? `${(abs * 100).toFixed(1)}%` : abs}`;
}

/** Mirrors CandidateCard.tsx's local formatAsOf — same freshness window, same "as of HH:MM"
 * label, same never-"Invalid Date" NaN guard (unparseable falls back to stale, the safe
 * direction). Not extracted to a shared helper — this is the file-local convention CandidateCard
 * already established for this exact formatting. */
function formatAsOf(observedAt: string): { readonly label: string; readonly fresh: boolean } {
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return { label: "as of —", fresh: false };
  const ageMs = Date.now() - ts;
  const hhmm = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return { label: `as of ${hhmm}`, fresh: ageMs >= 0 && ageMs < GEX_FRESH_MS };
}

export interface HeldPositionsPanelProps {
  readonly positions: ReadonlyArray<HeldPositionVerdict>;
  /** Cohort-level instant, one per fetch, repeated per row (mirrors CandidateCard's
   * snapshot-level observedAt convention). */
  readonly observedAt: string;
  readonly marketSession: "rth" | "after-hours";
}

export function HeldPositionsPanel({
  positions,
  observedAt,
  marketSession,
}: HeldPositionsPanelProps): React.ReactElement {
  const staleness = formatAsOf(observedAt);

  return (
    <Panel>
      <PanelHeading title="Held positions" />
      <div className="flex flex-col gap-2">
        {positions.map((row) => {
          // STOP and EXIT_PRE_EVENT are the only two escalated verdicts; distinct hues at the
          // same filled weight so a fill-vs-no-fill scan reads "urgent" without color reliance.
          const isEscalatedAmber = !row.indicative && row.verdict === "EXIT_PRE_EVENT";
          return (
            <div
              key={row.calendarId}
              className="rounded-lg border border-line bg-transparent px-2.5 py-2 hover:border-line2"
              data-testid={`held-position-${row.calendarId}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className="font-display text-sm font-bold text-txt">{row.name}</span>
                  {row.changed && (
                    <span
                      className={cn(
                        "font-mono text-[9px] font-bold tracking-[0.08em] uppercase",
                        verdictColorClass(row.verdict),
                      )}
                      data-testid={`held-position-changed-${row.calendarId}`}
                    >
                      CHANGED
                    </span>
                  )}
                </span>
                <MetricChip
                  data-testid={`held-position-verdict-${row.calendarId}`}
                  alert={row.indicative || row.escalate}
                  className={cn(isEscalatedAmber && "bg-amber/15 ring-1 ring-amber/40")}
                  label="VERDICT"
                  value={
                    row.indicative ? (
                      <span className="text-amber" data-testid={`held-position-indicative-${row.calendarId}`}>
                        {marketSession === "after-hours" ? "AH — indicative" : "STALE — indicative"}
                      </span>
                    ) : (
                      <span className={verdictColorClass(row.verdict)}>{verdictLabel(row.verdict, row.rung)}</span>
                    )
                  }
                />
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-dim" data-testid={`held-position-rule-${row.calendarId}`}>
                {`${row.ruleId} · ${formatMetric(row.metric)}`}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className={cn("size-1.5 rounded-full", staleness.fresh ? "bg-up" : "bg-amber")} />
                <span className="font-mono text-[9px] text-dim">{staleness.label}</span>
              </div>
              {row.verdict === "ROLL" && row.roll !== null && (
                <div
                  className="mt-1 flex justify-between gap-2 border-t border-line/40 pt-1 font-mono text-[10px]"
                  data-testid={`held-position-roll-${row.calendarId}`}
                >
                  <span className="text-dim">Suggested roll</span>
                  <span className="text-txt">
                    {`→ ${row.roll.suggestedFrontExpiry} · est. debit $${Math.round(row.roll.estDebit)}`}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
