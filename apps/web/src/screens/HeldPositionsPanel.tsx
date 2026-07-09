/**
 * Exit-verdict display module (EXIT-07/EXIT-09/EXIT-10).
 *
 * The Overview verdict-in-row redesign joins each open calendar's exit verdict INTO its
 * positions-table row (`${strike}${optionType}` key). So the verdict badge + its expand-detail
 * body live here as reusable pieces the table imports:
 *   - `VerdictChip`          — the in-row/unlinked verdict badge (indicative override + STOP/
 *                              EXIT escalation hues, T-26-16). testid `held-position-verdict-{id}`.
 *   - `VerdictChangedMarker` — the EXIT-09 CHANGED marker in the verdict's own color.
 *   - `VerdictDetailBody`    — the row-expand detail: rule+metric line, as-of dot, ROLL detail.
 *   - `verdictLabel` / `verdictColorClass` — shared label/color helpers.
 *
 * `HeldPositionsPanel` (the standalone list panel) is retained for the unlinked-verdicts fallback
 * and composes the same three pieces — chip severity, INDICATIVE override, CHANGED marker, and the
 * absence of any onSelect/button/order affordance (EXIT-10, T-26-17) are all defined once, here.
 */
import { cn } from "@/lib/utils";
import type { HeldPositionVerdict, ExitMetric, ExitVerdictEnum } from "@morai/contracts";
import { Panel, PanelHeading, MetricChip } from "../components/system/index.tsx";
import { GEX_FRESH_MS } from "./Market.tsx";

/** The verdict's OWN color — shared by the value text (when not forced INDICATIVE) and the
 * CHANGED marker (Color contract: "a changed STOP shows CHANGED in text-down..."). */
export function verdictColorClass(verdict: ExitVerdictEnum): string {
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
export function verdictLabel(verdict: ExitVerdictEnum, rung: string | null): string {
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
 * direction). */
function formatAsOf(observedAt: string): { readonly label: string; readonly fresh: boolean } {
  const ts = new Date(observedAt).getTime();
  if (Number.isNaN(ts)) return { label: "as of —", fresh: false };
  const ageMs = Date.now() - ts;
  const hhmm = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return { label: `as of ${hhmm}`, fresh: ageMs >= 0 && ageMs < GEX_FRESH_MS };
}

/**
 * VerdictChip — the verdict badge for one held position. STOP and EXIT_PRE_EVENT are the only two
 * escalated verdicts (distinct hues at the same filled weight); an `indicative` mark is FORCED to
 * the non-actionable INDICATIVE treatment and never renders escalated STOP/TAKE colors (T-26-16).
 */
export function VerdictChip({
  row,
  marketSession,
}: {
  readonly row: HeldPositionVerdict;
  readonly marketSession: "rth" | "after-hours";
}): React.ReactElement {
  const isEscalatedAmber = !row.indicative && row.verdict === "EXIT_PRE_EVENT";
  return (
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
  );
}

/** CHANGED marker in the verdict's own value color (EXIT-09) — null when the verdict is unchanged. */
export function VerdictChangedMarker({ row }: { readonly row: HeldPositionVerdict }): React.ReactElement | null {
  if (!row.changed) return null;
  return (
    <span
      className={cn(
        "font-mono text-[9px] font-bold tracking-[0.08em] uppercase",
        verdictColorClass(row.verdict),
      )}
      data-testid={`held-position-changed-${row.calendarId}`}
    >
      CHANGED
    </span>
  );
}

/**
 * VerdictDetailBody — the row-expand detail: the firing rule + raw metric line (EXIT-04, never a
 * fabricated probability), an as-of freshness dot, and the ROLL suggestion (ROLL verdicts only).
 */
export function VerdictDetailBody({
  row,
  observedAt,
}: {
  readonly row: HeldPositionVerdict;
  readonly observedAt: string;
}): React.ReactElement {
  const staleness = formatAsOf(observedAt);
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[9px] text-dim" data-testid={`held-position-rule-${row.calendarId}`}>
        {`${row.ruleId} · ${formatMetric(row.metric)}`}
      </div>
      <div className="flex items-center gap-1">
        <span className={cn("size-1.5 rounded-full", staleness.fresh ? "bg-up" : "bg-amber")} />
        <span className="font-mono text-[9px] text-dim">{staleness.label}</span>
      </div>
      {row.verdict === "ROLL" && row.roll !== null && (
        <div
          className="flex justify-between gap-2 border-t border-line/40 pt-1 font-mono text-[10px]"
          data-testid={`held-position-roll-${row.calendarId}`}
        >
          <span className="text-dim">Suggested roll</span>
          <span className="text-txt">
            {`→ ${row.roll.suggestedFrontExpiry} · new front est. credit $${Math.round(row.roll.estNewFrontCredit)}`}
          </span>
        </div>
      )}
    </div>
  );
}

export interface HeldPositionsPanelProps {
  readonly positions: ReadonlyArray<HeldPositionVerdict>;
  /** Cohort-level instant, one per fetch, repeated per row. */
  readonly observedAt: string;
  readonly marketSession: "rth" | "after-hours";
  /** Heading override — defaults to "Held positions"; the Overview uses "Unlinked verdicts"
   *  for verdicts with no live broker row (closed calendar). */
  readonly title?: string;
}

/**
 * HeldPositionsPanel — a list of held-position verdict rows. In the verdict-in-row Overview this is
 * only the fallback for UNLINKED verdicts (a verdict whose calendar has no matching broker row);
 * matched verdicts render inline in the positions table via `VerdictChip`/`VerdictDetailBody`.
 * No onSelect/button/order affordance anywhere (EXIT-10, T-26-17) — advise + alert only.
 */
export function HeldPositionsPanel({
  positions,
  observedAt,
  marketSession,
  title = "Held positions",
}: HeldPositionsPanelProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title={title} />
      <div className="flex flex-col gap-2">
        {positions.map((row) => (
          <div
            key={row.calendarId}
            className="rounded-lg border border-line bg-transparent px-2.5 py-2 hover:border-line2"
            data-testid={`held-position-${row.calendarId}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="font-display text-sm font-bold text-txt">{row.name}</span>
                <VerdictChangedMarker row={row} />
              </span>
              <VerdictChip row={row} marketSession={marketSession} />
            </div>
            <div className="mt-0.5">
              <VerdictDetailBody row={row} observedAt={observedAt} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
