/**
 * MobileScorecard — the mobile Analyzer verdict hero (Phase 36, D-08; regrouped Phase 41, AUI-06).
 *
 * Once a candidate is selected, this renders the scorecard as a phone-native block: the
 * verdict-word headline (icon + WORD + score + Θ, reusing `verdictWord` — identical format to
 * the desktop hero), the verbatim desktop context line (name + debit/θ/vega, plus the
 * combined-book summary when 2+ calendars are combined), and the scoring checklist stacked under
 * three EDGE/RISK/FIT group blocks (single column — phone width, not the desktop's 3-col grid).
 * Every string and every status derivation mirrors the desktop hero row-for-row; both trees
 * partition by the SAME `GROUP_OF` from the model module — never re-declared per tree.
 *
 * Gating (catch #23 heritage, same as desktop): `candidate === null` renders nothing (the rail
 * states carry the messaging — no hollow shells); a `breakdown.length === 0` candidate shows the
 * label + not-scored note only (the gate is breakdown length, never the pasted id).
 *
 * No any/as/!.
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, RuleSetEntry } from "@morai/contracts";
import { SectionLabel } from "../../components/system/index.tsx";
import {
  scoreStatus,
  CHIP_LABELS,
  FALLBACK_SCORE_ITEMS,
  EXPERIMENTAL_SHORT,
  PASTED_NOT_SCORED_NOTE,
  GROUP_OF,
  verdictWord,
} from "./useAnalyzerModel.ts";

const GROUP_ORDER = ["EDGE", "RISK", "FIT"] as const;

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
  // derivation to the desktop hero).
  const scoreRules = ruleSet.filter((r) => r.kind === "score" && r.status === "active");
  const scoreItems =
    scoreRules.length > 0
      ? scoreRules.map((r) => ({ key: r.id, label: CHIP_LABELS[r.id] ?? r.label }))
      : FALLBACK_SCORE_ITEMS.map((item) => ({ key: item.key, label: CHIP_LABELS[item.key] ?? item.label }));

  const verdict = verdictWord(candidate.score);

  return (
    <section className="px-4">
      <SectionLabel>Scorecard</SectionLabel>

      {/* Verdict-word headline (icon + WORD + score + Θ) — identical format to the desktop hero. */}
      <div className="mt-1 flex flex-wrap items-baseline gap-2" data-testid="mobile-verdict-headline">
        <span
          className={cn("font-display text-[16px] font-semibold", verdict.cls)}
          data-testid="mobile-verdict-word"
        >
          {verdict.icon} {verdict.word}
        </span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-txt" data-testid="mobile-verdict-score">
          {`score ${Math.round(candidate.score)}/100`}
        </span>
        <span
          className={cn(
            "font-mono text-[13px] font-semibold tabular-nums",
            candidate.theta >= 0 ? "text-up" : "text-down",
          )}
          data-testid="mobile-verdict-theta"
        >
          {`Θ ${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d`}
        </span>
      </div>

      {/* Context line — strings verbatim from the desktop selected-name line. */}
      <p className="mt-1 font-mono text-[11px] text-dim">
        <span className="text-violet" data-testid="risk-profile-selected-name">
          {candidate.name}
        </span>
        {` · debit $${Math.round(candidate.debit)} · θ ${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d · vega +${candidate.vega.toFixed(2)}`}
        {bookCount > 1 && (
          <span className="ml-2 text-amber" data-testid="combined-book-summary">
            {`+ ${bookCount - 1} more → combined debit $${Math.round(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${bookVega.toFixed(2)}`}
          </span>
        )}
      </p>

      {/* Checklist stacked under EDGE/RISK/FIT groups (D-08/AUI-06 — single column, phone width). */}
      <div className="mt-2 flex flex-col gap-2">
        {marketSession === "after-hours" && (
          <div
            data-testid="checklist-session"
            className="flex items-center justify-between font-mono text-[11px]"
          >
            <span className="text-muted-foreground">SESSION</span>
            <span className="text-amber">AH — indicative</span>
          </div>
        )}

        {GROUP_ORDER.map((group) => {
          const groupItems = scoreItems.filter((item) => GROUP_OF[item.key] === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} data-testid={`mobile-verdict-group-${group}`}>
              <span className="font-display text-[10px] font-semibold tracking-[0.08em] text-dim uppercase">
                {group}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {groupItems.map((item) => {
                  const entry = candidate.breakdown.find((b) => b.criterion === item.key);
                  if (entry === undefined) return null;
                  const guard = item.key === "fwdEdge" && candidate.fwdIv === null;
                  const st = guard ? { icon: "—", cls: "text-dim" } : scoreStatus(entry.contribution);
                  return (
                    <div
                      key={item.key}
                      data-testid={`checklist-${item.key}`}
                      className="flex items-center justify-between font-mono text-[11px]"
                    >
                      <span>
                        <span className={st.cls}>{st.icon}</span>{" "}
                        <span className="text-muted-foreground">{item.label}</span>
                      </span>
                      <span className={cn("text-right", st.cls)}>
                        {guard ? "n/a" : `${Math.round(entry.contribution)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

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
