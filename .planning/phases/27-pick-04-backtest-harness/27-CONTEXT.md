# Phase 27: PICK-04 Backtest Harness - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** User-locked milestone kickoff decisions + REQUIREMENTS BT-01..05 + .planning/research/SUMMARY.md + PITFALLS.md

<domain>
## Phase Boundary

Operator CLI replays stored chains (leg_observations since 2026-06-12) through the SAME pure
entry+exit rule functions used live, with point-in-time correctness. Refutation and
mechanics-validation tool ONLY — honest at n=13. Requirements BT-01..BT-05.

</domain>

<decisions>
## Implementation Decisions

### Identity (USER-LOCKED — the hard boundary)
- Backtest = REFUTATION TOOL ONLY. Every number stamped `n=13` (or actual n) + date range.
- NEVER writes weights. Output = directional evidence a human reads. Weight promotion
  stays gated until n≥30 real closed trades. Guard: weight-sum-100 registry test untouched;
  backtest has NO write path to rules.ts or any config.
- Must reproduce (a) live picker_snapshot scores for historical cohorts EXACTLY (leakage
  oracle — catches percentile/lookahead bugs automatically), (b) the 13 closed calendars'
  validated outcomes (direction + rough magnitude) with the same fill-haircut on entry AND
  exit.

### Form (research-locked)
- Operator CLI: `apps/worker/src/backtest.ts` following fix-pnl-reingest.ts /
  backfill-transactions.ts precedent. NOT a pg-boss job (no cadence; 900s cap fights bulk
  scans). NOT a server route. All I/O up front, then pure replay.
- Reusable predictive-power kernel (pure numeric fns) in
  `packages/core/src/backtest/domain/` — fast-check tested (~15-30 lines each, reuse
  percentileRank helper + realizedVol stdev pattern).
- `backtest_runs` table: append-only JSONB report (migration 0021), keyed by run id +
  created_at. Persist every report.
- Replays through UNTOUCHED live functions: selectCandidates/scoreCalendarCandidates
  (picker) + evaluateExit (exits, Phase 26). Zero reimplementation of scoring logic — if
  the backtest needs a helper the engine doesn't expose, EXPORT it, don't copy it.

### Point-in-time correctness (PITFALLS — the methodology core)
- No lookahead: every read filtered observedAt ≤ T for decision time T. Every
  distributional statistic (percentiles, normalizations) computed point-in-time.
- Replay per 30-min slot with the SAME per-contract-latest deduped dual-source union the
  live readers use (readLegObsForGex semantics).
- Late-solved-BSM optimism: no bsm_solved_at column exists — so explicitly FLAG the
  residual optimism in the report (documented caveat), don't silently ignore. (Decision
  from research gaps: flag, not new column — keep phase additive. Revisit only if oracle
  reproduction fails because of it.)
- Survivorship: replay the full stored universe incl. gate-dropped strikes (gate drops are
  logged in picker_snapshot payloads).
- Gap-row poisoning: skip/flag gap rows (spot=0/NaN) + report coverage % per replayed day.
- Fill model: shared haircutFill (exported in Phase 26) on entry AND exit; report P&L as
  mid→haircut range where useful, never bare mid.

### Report content (BT-04)
- Per-rule directional attribution: sign + n, never a coefficient ("high-scoring beat
  low-scoring: yes/no/insufficient").
- Leave-one-rule-out ablation: re-run scoring with each rule zeroed, report rank/outcome
  deltas.
- Bootstrap CI on every headline metric (the CI is enormous at n=13 — showing it IS the
  honesty).
- Every number: n= + date range + coverage %.

### The 13-trade oracle
- The validated closed-calendar outcomes live in the journal (fills-ledger, Phase-22
  validated vs real Schwab transactions). Direction + rough magnitude reproduction, not
  cent-exact (fills are the user's real fills = the oracle; haircut model approximates).

### Testing
- TDD; fast-check for kernel invariants (correlation/attribution edge cases: constant
  arrays, n=1, ties); testcontainers for backtest_runs repo + twin; leakage-oracle test =
  integration test replaying a stored cohort from the test DB and asserting exact score
  equality.

### Claude's Discretion
- CLI arg surface (date range, calendar filter, --report-only etc.) — keep minimal.
- Report JSONB shape.
- How the CLI resolves the 13 closed calendars (status=closed query).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `apps/worker/src/fix-pnl-reingest.ts` + `backfill-transactions.ts` — operator-CLI precedent
- `packages/core/src/picker/domain/` — rules.ts, candidate-selection.ts (haircutFill export), scoring
- `packages/core/src/exits/domain/` — evaluate-exit.ts, exit-rules.ts (Phase 26)
- `packages/adapters/src/postgres/repos/picker-chain.ts` — readLegObsForGex-style union/dedup read semantics
- `packages/adapters/src/postgres/repos/picker-snapshot.ts` + picker-history — stored live scores (the oracle)
- `packages/shared/src/percentile-rank.ts` + `packages/core/src/picker/domain/realized-vol.ts` — reusable numeric helpers
- `.planning/research/PITFALLS.md` — leakage/survivorship/fill-model/gap-poisoning taxonomy (exhaustive)
- `docs/architecture/picker-rules.md` + `docs/architecture/exit-rules.md` — the rule registries being validated

</canonical_refs>

<specifics>
## Specific Ideas

- Leakage oracle mechanics: pick N historical cohorts with stored picker_snapshot rows;
  replay chain@cohort-time through live scorer; assert score identity per candidate. A
  mismatch = hard failure printed with the diverging rule id.
- Ablation implementation: scoreCalendarCandidates already takes the registry — check if
  weights injectable; if not, minimal export of a scoring-with-registry variant (no
  behavior change to live path).
</specifics>

<deferred>
## Deferred Ideas

- Automated weight promote/demote — n≥30 gate (Future Requirements).
- bsm_solved_at column — only if oracle reproduction fails from late-BSM effects.
- Sharpe/Kelly/optimizer anything — Out of Scope table.

</deferred>

---

*Phase: 27-pick-04-backtest-harness*
*Context gathered: 2026-07-09 from user-locked milestone decisions*
