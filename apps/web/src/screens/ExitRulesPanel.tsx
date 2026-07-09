/**
 * ExitRulesPanel — the "Exit rules" panel (EXIT-07, entry-methodology symmetry with the
 * picker's ScoringMethodologyPanel). Renders the exitsResponse payload's `ruleSet` verbatim, in
 * the engine's own precedence order (the payload's array order) — never a client-side copy or
 * re-sort (T-26-18). Unlike the picker's weighted score checklist, exit rules are a precedence
 * ladder with no score weight, so this is a flat list, not scored chips.
 */
import type { ExitRuleSetEntry } from "@morai/contracts";
import { Panel, PanelHeading, SectionLabel } from "../components/system/index.tsx";

export interface ExitRulesPanelProps {
  readonly ruleSet: ReadonlyArray<ExitRuleSetEntry>;
}

export function ExitRulesPanel({ ruleSet }: ExitRulesPanelProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title="Exit rules" />
      <div className="flex flex-col gap-1.5" data-testid="exit-rules-list">
        {ruleSet.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-0.5 border-b border-line/40 pb-1.5 last:border-b-0"
            data-testid={`exit-rule-${entry.id}`}
          >
            <SectionLabel>{`${entry.id} · ${entry.kind}`}</SectionLabel>
            <p className="m-0 font-mono text-[10px] text-dim">{entry.rationale}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
