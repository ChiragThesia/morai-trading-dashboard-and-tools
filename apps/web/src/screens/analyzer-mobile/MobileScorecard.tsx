/**
 * MobileScorecard — the mobile Analyzer verdict hero (Phase 36, D-08).
 *
 * Once a candidate is selected, this renders the scorecard as a phone-native block: a 32px mono
 * score, the verbatim desktop context line (name + debit/θ/vega, plus the combined-book summary
 * when 2+ calendars are combined), and the scoring checklist as stacked ROWS — one per active
 * score rule. Every string and every status derivation mirrors the desktop
 * `ScoringMethodologyPanel` row-for-row; the row derivation reuses `scoreStatus`/`CHIP_LABELS`/
 * `FALLBACK_SCORE_ITEMS`/`EXPERIMENTAL_SHORT` from the model module — never re-implemented.
 * `MetricChip` is NOT mounted here (D-08 — the chip strip is the desktop tree's shape).
 *
 * Gating (catch #23 heritage, same as desktop): `candidate === null` renders nothing (the rail
 * states carry the messaging — no hollow shells); a `breakdown.length === 0` candidate shows the
 * label + not-scored note only (the gate is breakdown length, never the pasted id).
 *
 * No any/as/!.
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, RuleSetEntry } from "@morai/contracts";
import { exactAbs } from "../../lib/position-format.ts";
import { SectionLabel } from "../../components/system/index.tsx";
import {
  scoreStatus,
  CHIP_LABELS,
  FALLBACK_SCORE_ITEMS,
  EXPERIMENTAL_SHORT,
  PASTED_NOT_SCORED_NOTE,
} from "./useAnalyzerModel.ts";

export interface MobileScorecardProps {
  readonly candidate: PickerCandidate | null;
  /** The engine's rule registry from the snapshot (empty on pre-registry snapshots). */
  readonly ruleSet: ReadonlyArray<RuleSetEntry>;
  /** Per-gate drop counts for the snapshot's compute run. */
  readonly gateDrops: { readonly liquidity: number; readonly netTheta: number };
  /** "after-hours" renders the indicative-marks SESSION row first. */
  readonly marketSession: "rth" | "after-hours";
  readonly bookCount: number;
  readonly bookDebit: number;
  readonly bookTheta: number;
  readonly bookVega: number;
}

export function MobileScorecard({
  candidate,
  ruleSet,
  gateDrops,
  marketSession,
  bookCount,
  bookDebit,
  bookTheta,
  bookVega,
}: MobileScorecardProps): React.ReactElement | null {
  // No candidate → render nothing (the rail states carry the messaging, no hollow shell).
  if (candidate === null) return null;

  // Not-scored (pasted) → label + honest note only (gate is breakdown length, never the id).
  if (candidate.breakdown.length === 0) {
    return (
      <section className="px-4">
        <SectionLabel>Scorecard</SectionLabel>
        <p className="mt-1 font-mono text-[11px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
      </section>
    );
  }

  // Score rows from the engine's registry when available; legacy fallback otherwise (identical
  // derivation to ScoringMethodologyPanel).
  const scoreRules = ruleSet.filter((r) => r.kind === "score" && r.status === "active");
  const scoreItems =
    scoreRules.length > 0
      ? scoreRules.map((r) => ({ key: r.id, label: CHIP_LABELS[r.id] ?? r.label, weight: r.weight }))
      : FALLBACK_SCORE_ITEMS.map((item) => ({
          key: item.key,
          label: CHIP_LABELS[item.key] ?? item.label,
          weight: null,
        }));

  return (
    <section className="px-4">
      <SectionLabel>Scorecard</SectionLabel>

      {/* 32px hero score — no sign color (a score is not a P&L). */}
      <div
        data-testid="mobile-score"
        className="mt-1 font-mono text-[32px] font-bold tabular-nums leading-none text-txt"
      >
        {Math.round(candidate.score)}
      </div>

      {/* Context line — strings verbatim from the desktop selected-name line. */}
      <p className="mt-1 font-mono text-[11px] text-dim">
        <span className="text-violet" data-testid="risk-profile-selected-name">
          {candidate.name}
        </span>
        {` · debit $${exactAbs(candidate.debit)} · θ ${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d · vega +${exactAbs(candidate.vega)}`}
        {bookCount > 1 && (
          <span className="ml-2 text-amber" data-testid="combined-book-summary">
            {`+ ${bookCount - 1} more → combined debit $${exactAbs(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${exactAbs(bookVega)}`}
          </span>
        )}
      </p>

      {/* Checklist as stacked rows (D-08). */}
      <div className="mt-2 flex flex-col gap-1">
        {marketSession === "after-hours" && (
          <div
            data-testid="checklist-session"
            className="flex items-center justify-between font-mono text-[11px]"
          >
            <span className="text-muted-foreground">SESSION</span>
            <span className="text-amber">AH — indicative</span>
          </div>
        )}

        {scoreItems.map((item) => {
          const entry = candidate.breakdown.find((b) => b.criterion === item.key);
          const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
          const contribution = entry?.contribution ?? 0;
          const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(contribution);
          return (
            <div
              key={item.key}
              data-testid={`checklist-${item.key}`}
              className="flex items-center justify-between font-mono text-[11px]"
            >
              <span>
                <span className={st.cls}>{st.icon}</span>{" "}
                <span className="text-muted-foreground">{item.label}</span>
                {item.weight !== null && (
                  <span className="ml-1 text-dim" data-testid={`checklist-${item.key}-weight`}>
                    w{item.weight}
                  </span>
                )}
              </span>
              <span className={cn("text-right", st.cls)}>
                {guard ? "n/a" : `${Math.round(contribution)}%`}
              </span>
            </div>
          );
        })}

        {/* θ GATE — the sign-colored net-theta constraint. */}
        <div
          data-testid="checklist-theta"
          className="flex items-center justify-between font-mono text-[11px]"
        >
          <span className="text-muted-foreground">θ GATE</span>
          <span className={candidate.theta >= 0 ? "text-up" : "text-down"}>
            {candidate.theta >= 0 ? "✓" : "✗"}{" "}
            {`${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`}
          </span>
        </div>

        {candidate.context.length > 0 && (
          <div
            data-testid="checklist-experimental"
            className="flex items-center justify-between font-mono text-[11px] opacity-60"
          >
            <span className="text-muted-foreground">CALIBRATING</span>
            <span className="text-dim">
              {candidate.context
                .map(
                  (entry) =>
                    `${EXPERIMENTAL_SHORT[entry.id] ?? entry.id} ${
                      entry.value === null
                        ? "—"
                        : entry.value.toFixed(entry.id === "slopePercentile" ? 0 : 3)
                    }`,
                )
                .join(" · ")}
            </span>
          </div>
        )}

        {(gateDrops.liquidity > 0 || gateDrops.netTheta > 0) && (
          <p className="font-mono text-[9px] text-dim" data-testid="checklist-gate-drops">
            {gateDrops.liquidity} illiquid quote{gateDrops.liquidity === 1 ? "" : "s"} ·{" "}
            {gateDrops.netTheta} negative-θ pair{gateDrops.netTheta === 1 ? "" : "s"} dropped this run
          </p>
        )}
      </div>
    </section>
  );
}
