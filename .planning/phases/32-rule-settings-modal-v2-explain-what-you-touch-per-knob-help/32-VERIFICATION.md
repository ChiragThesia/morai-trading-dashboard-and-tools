---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
verified: 2026-07-10T16:05:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open the Rule Settings modal on morai.wtf and skim every knob's caption, affects tag, and info-icon popover copy (all 43 RULE_EXPLAINERS entries) against how a trader would actually read it."
    expected: "Copy reads correctly and unambiguously to the user who filed the original complaint ('doesn't tell me SHIT') — no confusing jargon, no leftover ambiguity beyond the two CR-02-corrected entries already fixed."
    why_human: "Editorial/plain-English judgment on trader-facing prose; not mechanically checkable beyond the semantic-correctness assertions already run (32-VALIDATION.md's own 'Explainer copy reads right to a trader' manual-only item)."
  - test: "Stage a picker weight swap → click Preview → confirm the top-movers list is sensible against live snapshot data; stage a universe knob (delta band/DTE) → confirm the honest 'affects next compute cycle' note appears instead of a fabricated diff; stage a regime band → confirm the indicator band shifts correctly; stage a VIX-ladder/maxOpen change against a real gate → confirm gate/sizing before-after chips look right on live data."
    expected: "All four preview branches (picker score movers, universe honest-note, regime re-band, gate/sizing) show plausible, correct deltas on the live stored snapshot / live regime indicators."
    why_human: "Requires a deployed build against live picker/regime data (32-VALIDATION.md's own 'Preview deltas plausible on live data' manual-only item; 32-06-SUMMARY.md D6 explicitly defers this to the phase's live UAT pass)."
  - test: "With the live entry gate in a genuinely `blind` (macroStale) state, open the modal, stage any picker knob, and click Preview — confirm the gate chip still reads `blind`, never `open`/`penalty`/`blocked`."
    expected: "Preview reproduces the stored blind gate verbatim; sizing stays tied to the blind gate's own vix scalar."
    why_human: "CR-01 was a logic bug on a trading go/no-go signal (stale-macro-data gate silently un-blinding in preview). The fix has direct regression coverage (previewPickerRuleOverrides.test.ts's CR-01 example test + extended byte-parity fast-check, both passing — see Behavioral Spot-Checks) but the review-fix report itself explicitly flags this class of fix as 'requires human verification' given the trading-decision stakes; a live blind-gate occurrence is rare enough that a synthetic unit test, while correct, is not a substitute for seeing the real signal path once."
---

# Phase 32: Rule Settings Modal v2 — Explain What You Touch Verification Report

**Phase Goal:** Rule Settings modal v2 — every knob carries a correct explainer (what/unit/direction, affected surface) from the RULE_EXPLAINERS registry (43 paths, schema-derived completeness); explicit-click staged-change preview: picker weights/debit re-score stored candidates, gate/sizing re-resolve (stored BLIND passes through verbatim — post-fix c064009), 6 universe knobs honest note, exit rungs re-evaluate live positions, regime re-bands client-side via core fns; one POST /api/settings/rules/preview + preview_rule_overrides MCP tool; byte-parity empty==stored; never persists; v1 modal unregressed; zero new deps.
**Verified:** 2026-07-10T16:05:00Z
**Status:** passed — live items verified 2026-07-10 (see 32-UAT.md; 2 preview-honesty bugs caught+fixed live: 0d8c153, a7e4fe9)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (B-ID) | Status | Evidence |
|---|---|---|---|
| 1 | B6 — Every knob has a correct explainer (43 schema-derived paths) | ✓ VERIFIED | `packages/contracts/src/rule-explainers.ts` has exactly 43 entries; `rule-explainers.test.ts` walks `ruleConfig.shape` recursively and asserts 1:1 set-equality (no gaps/extras) — 21/21 tests pass. CR-02 review findings (deltaBandMax direction backwards; vixLadder.elevatedMin/crisisMin falsely claiming the ladder moves the fixed penalty/block hysteresis) were fixed in commit `3366fed`; source now correctly states deltaBandMax admits further-OTM (not closer-to-ATM) and explicitly disclaims the ladder moving the fixed VIX 20/25 triggers, matching `candidate-selection.ts`/`entry-gate.ts` semantics. New semantic-correctness tests deny-list the old false claims. |
| 2 | B1 — Score-only knobs re-score stored candidates, zero extra I/O | ✓ VERIFIED | `previewPickerRuleOverrides.ts`'s `rescoreCandidate` reweights stored breakdown contributions (`debitFitFraction` recompute for debitFit only), no new reads beyond the snapshot. Byte-parity fast-check + example tests pass (9/9). |
| 3 | B1 — Gate/sizing knobs re-resolve; stored BLIND gate passes through verbatim (post-CR-01) | ✓ VERIFIED | `snapshot.gate.state === "blind" ? snapshot.gate : resolveEntryGate(...)` short-circuit confirmed live in source (commit `c064009`). Regression test `CR-01: a stored blind gate (macroStale) stays blind in preview even with a staged vixLadder override` passes; byte-parity fast-check now fuzzes both `OPEN_GATE` and `STALE_BLIND_GATE` fixtures (9/9 tests green, re-ran directly). |
| 4 | B1 — 6 universe knobs (delta band ×2, DTE ×4) return honest note, never fabricated diff | ✓ VERIFIED | `UNIVERSE_KEYS` (6 entries) gate `UNIVERSE_NOTE` in `previewPickerRuleOverrides.ts`; dedicated test confirms note appears (never a fake candidate diff) when any universe key is staged. |
| 5 | B2 — Exit rungs re-evaluate live open positions (current vs staged, live not static-note) | ✓ VERIFIED | `previewExitRuleOverrides.ts`'s `makePreviewExitRuleOverridesUseCase` runs the pure `evaluateExit` twice per open position (current, staged); byte-parity fast-check + 11 example tests pass (part of the 4-file/109-test run). Deps type structurally excludes `persistExitVerdict`/chain-for-roll (port-hygiene test). |
| 6 | B3 — Regime re-bands client-side via real core band functions, no duplicated logic | ✓ VERIFIED | `useRuleSettingsPreview.ts`'s `previewRegimeBands` calls `resolveRegimeRuleConfig` + the actual `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` re-exported through `@morai/core`'s top barrel (added in this phase — commit `b3bd70a`); parity test asserts identical output to calling the core functions directly. 5/5 hook tests pass. |
| 7 | B4/B7/B8 — One combined POST /api/settings/rules/preview + preview_rule_overrides MCP tool, byte-parity, JWT/Bearer-gated, never persists | ✓ VERIFIED | `makePreviewRuleOverridesUseCase` branches per staged group, called identically by `settings.routes.ts`'s POST handler and `mcp/tools.ts`'s `registerPreviewRuleOverridesTool` (both import the same combined use-case instance from `main.ts`). Route mounted inside the existing authenticated `apiRouter`/`authReadGroup`; MCP tool mounted inside the existing bearer-gated `/mcp/*` router. 4 files / 109 tests (settings.routes.test.ts + mcp/tools.test.ts + previewExitRuleOverrides.test.ts + rule-explainers.test.ts) pass, including an explicit MCP-vs-HTTP byte-parity test and a no-persist-determinism test (two identical calls return identical results). |
| 8 | B7 — Explicit-click preview only (no keystroke spam); v1 modal unregressed | ✓ VERIFIED | `RuleSettingsModal.tsx`'s `handlePreview` fires only from the Preview button's `onClick`, never from `onChange`. All 5 pre-existing Phase-29 v1 tests (open-on-click, overridden-value display, reset, save, clear-falls-back-to-effective-value) pass unmodified; modal+hook test run: 19/19 green. No Phase-27 backtest/domain rule files were touched by any Phase-32 commit (`git log --stat` across the 4 fix commits + 6 feature commits shows zero touches to `picker/domain`, `exits/domain`, `analytics/domain`). |
| 9 | B9 — Zero new dependencies; Tooltip primitive is its first consumer | ✓ VERIFIED | `git diff` across all Phase-32 commits shows no `package.json` changes in any workspace. `RuleSettingsModal.tsx` imports the pre-existing, previously-unused `apps/web/src/components/ui/tooltip.tsx` (`Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider`) — first live consumer, per 32-05-SUMMARY.md. |
| 10 | Preview never persists (structural, not just tested) | ✓ VERIFIED | `PickerPreviewDeps`/`ExitPreviewDeps`/`PreviewRuleOverridesDeps` types structurally exclude any persist/chain/gex/events port — confirmed by dedicated "port hygiene" unit tests (exactly N fields, compile-time exclusion) in `previewPickerRuleOverrides.test.ts` and `previewExitRuleOverrides.test.ts`, both passing. |

**Score:** 9/9 truths verified (10 evidence rows map to the phase's 9 B-IDs; B1 spans 3 rows for its 3 knob-group branches), 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/contracts/src/rule-explainers.ts` | 43-entry RULE_EXPLAINERS registry | ✓ VERIFIED | 43 entries confirmed via grep; wired into `RuleSettingsModal.tsx` |
| `packages/contracts/src/rule-preview.ts` | preview request/response Zod contract | ✓ VERIFIED | Identity-reuses `ruleOverrides` for the request; strict response schema with `oldScore` inline |
| `packages/core/src/picker/application/previewPickerRuleOverrides.ts` | picker preview use-case | ✓ VERIFIED | CR-01 fix confirmed live; wired into combined use-case |
| `packages/core/src/exits/application/previewExitRuleOverrides.ts` | exit preview use-case | ✓ VERIFIED | Wired into combined use-case |
| `packages/core/src/settings/application/previewRuleOverrides.ts` | combined preview use-case | ✓ VERIFIED | Branches per staged group; wired into HTTP route + MCP tool |
| `apps/server/src/adapters/http/settings.routes.ts` | POST /api/settings/rules/preview | ✓ VERIFIED | Mounted in existing authenticated apiRouter; imports `toPreviewInput` from shared bridge (WR-01 fix) |
| `apps/server/src/adapters/mcp/tools.ts` | preview_rule_overrides MCP tool | ✓ VERIFIED | `registerPreviewRuleOverridesTool`; imports shared bridge (WR-01 fix) |
| `apps/server/src/adapters/rule-overrides-bridge.ts` | consolidated JSON-narrowing bridge | ✓ VERIFIED | `toPreviewInput` added (WR-01 fix, commit `0ea2d37`); both HTTP route and MCP tool import from here, no local duplicates remain |
| `apps/web/src/hooks/useRuleSettingsPreview.ts` | preview mutation hook + client-side regime re-band | ✓ VERIFIED | 5/5 tests pass |
| `apps/web/src/screens/RuleSettingsModal.tsx` | explainer captions/tags/popovers + Preview button + delta rendering | ✓ VERIFIED | WR-02 fix confirmed live (`previewMutation.reset()` + `setRegimePreview(undefined)` on both Save and Reset paths) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `RuleSettingsModal.tsx` | `RULE_EXPLAINERS` | direct import, keyed lookup per row | WIRED | Confirmed in 32-05-SUMMARY + source read |
| `RuleSettingsModal.tsx` | `POST /api/settings/rules/preview` | `useRuleSettingsPreview()` mutation, explicit-click only | WIRED | `handlePreview` → `previewMutation.mutateAsync(body)` |
| `settings.routes.ts` POST /preview | `previewRuleOverrides` combined use-case | direct call, `main.ts` composition | WIRED | Confirmed via grep + route test suite |
| `mcp/tools.ts` preview_rule_overrides | same `previewRuleOverrides` use-case instance | `main.ts` passes one instance to both | WIRED | Byte-parity MCP-vs-HTTP test passes |
| `previewPickerRuleOverrides.ts` | `resolveEntryGate` / `resolveSizingTier` (domain) | verbatim reuse, no hand-rolled copy | WIRED | Confirmed in source; CR-01 fix preserves this reuse |
| `useRuleSettingsPreview.ts` `previewRegimeBands` | `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas` (`@morai/core`) | direct import via newly-added top-barrel re-export | WIRED | Parity test asserts identical output to direct core calls |

### Requirements Coverage

Phase 32 has no `.planning/REQUIREMENTS.md` IDs (ROADMAP.md: "Requirements: none (user-added phase; covered by 32-CONTEXT locked decisions B1–B9)"). All 9 B-IDs (B1–B9) are covered above under Observable Truths — no orphaned requirements.

### Anti-Patterns Found

None. Grepped all 10 phase-modified core/contract/server/web files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` — zero matches.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| CR-01 regression: blind gate stays blind in preview | `vitest run previewPickerRuleOverrides.test.ts` | 9/9 pass | ✓ PASS |
| CR-02 semantic-correctness deny-list on explainer copy | `vitest run rule-explainers.test.ts` (part of combined 4-file run) | pass | ✓ PASS |
| WR-01 bridge consolidation — HTTP route + MCP tool tests | `vitest run settings.routes.test.ts mcp/tools.test.ts` (part of combined 4-file run) | 109/109 pass | ✓ PASS |
| WR-02 stale-preview-panel clear on Save/Reset | `vitest run RuleSettingsModal.test.tsx` | 19/19 pass (with hook tests) | ✓ PASS |
| Exit preview byte-parity | `vitest run previewExitRuleOverrides.test.ts` (part of combined 4-file run) | pass | ✓ PASS |
| Combined preview use-case + regime parity | `vitest run previewRuleOverrides.test.ts rule-preview.test.ts` | 19/19 pass | ✓ PASS |
| Full workspace suite (orchestrator-run, authoritative) | `bun run test` | 286 files / 3144 tests green | ✓ PASS |

### Human Verification Required

See frontmatter `human_verification` — 3 items: (1) explainer copy editorial read on live modal, (2) preview deltas plausibility against live picker/regime data, (3) a live blind-gate Preview sanity check for the CR-01 trading go/no-go fix (has full regression coverage, but the review-fix report itself flags this class of logic fix as warranting a human look given the trading-decision stakes).

### Gaps Summary

No gaps. All 9 B-IDs are verified in source with passing regression/property tests, all 4 code-review findings (2 critical, 2 warning) from `32-REVIEW.md` are confirmed fixed in the current codebase (not just claimed in `32-REVIEW-FIX.md`), zero new dependencies, zero anti-pattern markers, and the full workspace suite is green. The only open items are inherently human/live-data verifications the phase's own `32-VALIDATION.md` already scoped as manual-only, plus one CR-01-specific human sanity check recommended by the review-fix report despite its regression coverage.

---

_Verified: 2026-07-10T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
