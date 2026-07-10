/** ponytail: RED stub — filled in by the immediately-following GREEN commit. */
export type RuleAffectedSurface = "Picker candidates" | "Exit verdicts" | "Regime board";

export type RuleExplainer = {
  readonly summary: string;
  readonly unit: string;
  readonly direction: string;
  readonly affects: RuleAffectedSurface;
};

export const RULE_EXPLAINERS: Readonly<Record<string, RuleExplainer>> = {};
