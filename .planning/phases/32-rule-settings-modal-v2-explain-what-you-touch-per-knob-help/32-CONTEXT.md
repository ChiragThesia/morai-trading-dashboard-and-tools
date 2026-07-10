# Phase 32: Rule Settings Modal v2 — Explain What You Touch - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Source:** User feedback 2026-07-10 ("That modal for RULE Setting is FUCKING ASS it doesn't tell me how things will change if I move things it does not tell me SHIT.")

<domain>
## Phase Boundary

Upgrade the Phase-29 Rule Settings modal from bare numeric inputs to an explain-what-you-touch
surface:

1. **Per-knob explainers** — every knob gets: what it gates/scores (one plain sentence),
   unit, and direction-of-effect ("higher = closer-to-ATM shorts allowed" style).
2. **Affected-surface tag** — which engine output each knob changes (Picker candidates /
   Exit verdicts / Regime board).
3. **Staged-change impact preview** — BEFORE saving, show what the staged overrides would
   do: re-score the latest picker snapshot cohort with the staged config and show deltas
   (candidate count in/out, top-N score changes, gate state change if any). Exit/regime
   groups get their applicable preview (e.g. re-evaluate current open-position verdicts /
   re-band current regime values) or an honest "affects next verdict computation" note if
   a live preview is disproportionate.

NOT in scope: changing any knob semantics, adding/removing knobs, persisting preview
results, redesigning modal layout beyond what the explainers/preview require.
</domain>

<decisions>
## Implementation Decisions

### USER LOCKED
- The modal must tell the user what each knob does and how things will change before save.
- Preview happens BEFORE commit (staged values), not after.

### ORCHESTRATOR RESOLVED (do not reopen)
- Picker preview = server-side dry-run: re-score the LATEST STORED snapshot cohort with
  staged overrides (Phase 30's analyze pattern: bounded reads, never recompute the chain,
  never persist — T-19-17-compatible). Response: per-candidate old→new score, entered/left
  top set, gate/sizing changes. One request per explicit "Preview" click (no keystroke
  spam).
- Regime preview can be computed client-side or server-side from current values + staged
  bands (values already on screen) — planner picks the smaller-diff path but the numbers
  must come from the same effective-config semantics as prod (no duplicated band logic in
  the client if avoidable; a tiny pure shared function is acceptable ONLY via contracts/
  core export, never a hand-copy — the CORS lesson: hand-copies rot).
- Exit preview: re-evaluating live verdicts requires worker-path data (marks, staleness);
  if disproportionate, ship the honest static note "applies to the next verdict cycle"
  + show current rung values vs staged side-by-side. Planner decides with evidence.
- Knob explainer copy lives in ONE typed registry (single source of truth) keyed by the
  contract's knob paths; rendered in the modal; NOT scattered inline strings. Hemingway
  style, trader-facing (this user trades SPX calendars; write for him).

### Claude's Discretion
- Explainer UI: inline caption under each field vs info-icon popover vs both (space-aware
  — the modal is long; consider group intros + short per-field captions).
- Preview endpoint shape/naming (e.g. POST /api/settings/rules/preview) + contract schema;
  MCP twin per rule 9.
- Delta presentation (table of top movers, count chips, gate before→after chip).
- Loading/error states; preview staleness note (snapshot asOf).
- Whether weight-sum/hysteresis validation errors surface inline per-field in v2 (they
  currently render as a single group error) — improve if cheap.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The modal (v1, Phase 29)
- apps/web/src/screens/RuleSettingsModal.tsx + .test.tsx
- apps/web/src/hooks/useRuleSettings.ts (+ useAnalyzeCalendar.ts for the mutation/refetch pattern)
- packages/contracts/src/rule-settings.ts (knob whitelist — explainer registry keys off these paths)

### Knob semantics (source for explainer copy — read the actual code + rationale strings)
- packages/core/src/picker/domain/rules.ts (weights, debitFit band + RULE_SET_METADATA rationale strings — reuse this prose where good)
- packages/core/src/picker/domain/candidate-selection.ts (delta band, DTE windows)
- packages/core/src/picker/domain/entry-gate.ts (VIX ladder), brakes.ts (max open), sizing.ts (tiers)
- packages/core/src/exits/domain/exit-rules.ts (TAKE/STOP rungs + EXIT_RULE_METADATA)
- packages/core/src/analytics/domain/regime.ts (band rationale)

### Dry-run scoring precedent (Phase 30)
- packages/core/src/picker/application/analyzeAdHocCalendar.ts (bounded-read compute pattern)
- packages/core/src/picker/application/computePickerSnapshot.ts (scoring path + exported helpers)
- apps/server/src/adapters/http/picker.routes.ts + settings.routes.ts (route patterns)
- Latest snapshot read: getPicker / readPickerSnapshot port

### Rules
- .claude/rules/* (hexagon: preview use-case in core behind ports, thin route, MCP twin;
  TDD; no any/as/!)
- Phase 29 lesson (memory): ruleSet stamps effective weights only — preview must compute
  from staged EFFECTIVE config via resolvePickerRuleConfig, same merge semantics as prod.
</canonical_refs>

<specifics>
## Specific Ideas

- Preview must reuse resolve* functions with staged overrides — byte-parity property test:
  preview with empty staged overrides == current snapshot scores exactly.
- Explainer registry completeness test: every knob path in the contract has an entry
  (no silent gaps when knobs are added later).
- Copy tone examples: deltaBandMax — "Upper edge of the short-put delta band. Higher
  (toward −0.30) = closer-to-the-money candidates allowed. Affects: Picker universe.";
  takePlus15Arm — "Profit % that arms the TAKE +15% exit rung. Affects: Exit verdicts."
</specifics>

<deferred>
## Deferred Ideas

- Live per-keystroke preview (explicit button only this phase)
- Preview history/audit
- Exit-verdict full live dry-run if it proves disproportionate (honest-note fallback)
- Band/ladder label regeneration in snapshot ruleSet stamps (noted in Phase 29 UAT)
</deferred>

---

*Phase: 32-rule-settings-modal-v2*
*Context gathered: 2026-07-10 from user feedback*
