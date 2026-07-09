---
phase: 26-exit-advisor
verified: 2026-07-09T10:58:32Z
gap_closed: 2026-07-09T11:07:51Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Phase 26: Exit Advisor Verification Report

**Phase Goal:** Every open calendar gets one clear, explainable verdict each picker cycle — from
the user's own playbook ladder, never a bare or fabricated-confidence call.
**Verified:** 2026-07-09T10:58:32Z
**Status:** passed
**Re-verification:** Yes — gap closure applied 2026-07-09T11:07:51Z (see "Gap Closure" section below); original verification body left intact above the closure note for audit trail

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every open calendar shows a verdict each cycle (HOLD/TAKE rung/STOP rung/EXIT-pre-event), naming the rule + raw metric, no confidence | ✓ VERIFIED | `evaluateExit` always resolves via `EXIT_PRECEDENCE` walk terminating on `hold` (assertDefined guard, exit-rules.ts/evaluate-exit.ts); every `ExitVerdict` carries `ruleId` + `metric:{name,value,threshold}`; `exitsResponse`/`heldPositionVerdict` Zod schema has no confidence/probability field anywhere (packages/contracts/src/exits.ts, exits.test.ts asserts a `confidence` key is stripped) |
| 2 | Verdicts derive from validated ledger P&L + latest snapshot, session/staleness-gated, hysteresis, no flapping | ✓ VERIFIED | `evaluateExit` derives `pnlPct = (netMark − openNetDebit)/openNetDebit` only from passed fields (evaluate-exit.ts:225); indicative gate (AH / >45min stale / NaN) runs FIRST and forces `escalate:false` (evaluate-exit.ts:230-234); hysteresis arm/disarm bands (TAKE +5/+10/+15 disarm 2pp below, STOP −25/−50 disarm 2pp above, TERM 0.005/0.003, GAMMA 0.02/0.015) implemented via `wasArmed()` keyed on `previousVerdict.ruleId+rung`; fast-check properties for both directions pass (26-02 suite, 37/37 green) |
| 3 | TERM ≥0.5pp / GAMMA >2%+<7DTE / EVT ≤3d fire at documented thresholds; ROLL suggests haircut-priced replacement | ✓ VERIFIED | exit-rules.ts constants match 26-CONTEXT.md verbatim: `TERM_INVERSION_MIN=0.005`, `GAMMA_OFF_STRIKE=0.02`+`GAMMA_FRONT_DTE_MAX=7`, `EVT_BLACKOUT_DAYS=3`, `ROLL_FRONT_DTE_MAX=14`/`ROLL_SPOT_BAND=0.01`/`ROLL_PROFIT_MAX=0.15`/`ROLL_REPLACEMENT_DTE_MIN/MAX=14/21`; ROLL prices via `haircutFill(best, "sell")` imported from picker's extracted, exported `haircutFill` (candidate-selection.ts:131) — not a re-derived formula |
| 4 | Analyzer held-positions panel + exit ruleSet rendered from engine; MCP tool answers with same payloads | ✓ VERIFIED | `HeldPositionsPanel.tsx`/`ExitRulesPanel.tsx` render `useExits()`'s payload verbatim (Analyzer.test.tsx, 63/63 passing); `GET /api/exits` and `get_exit_advice` both call `getExitAdvice` and emit the one `exitsResponse` schema; MCP-02 parity test drives BOTH a real `McpServer`+`InMemoryTransport` client AND the HTTP route via `app.request` against the same use-case double and asserts `toolPayload toStrictEqual routePayload` (tools.test.ts:421-435) — literal equality, not two independent schema parses |
| 5 | Only verdict changes surface as alerts; STOP/EXIT-pre-event escalate distinctly; advisor never executes | ✓ VERIFIED (gap closed 2026-07-09T11:07:51Z) | **Escalation half verified:** `escalate:true` is set only for STOP/EXIT_PRE_EVENT (evaluate-exit.ts:280), persisted in the verdict blob, and flows correctly through both surfaces to the UI's distinct red-fill (STOP) vs filled-amber (EXIT-pre-event) chips (Analyzer.test.tsx). **Never-executes half verified:** EXIT-10 static guard scans every non-test file under `exits/` for an order-placement/brokerage-write port import and is itself exercised (computeExitAdvice.test.ts "EXIT-10 — never-execute guard"); the Analyzer panel has zero button/onSelect affordance (Analyzer.test.tsx "EXIT-10: the held-positions panel has no button/order affordance"). **Changes-surface-as-alerts half FIXED:** `getExitAdvice.ts` now reads the real write-time `changed` flag `computeExitAdvice.ts` persists on the `exit_verdicts` row instead of a hardcoded `false` — see "Gap Closure" section below |

**Score:** 5/5 truths fully verified (gap closed 2026-07-09T11:07:51Z; see "Gap Closure" section below)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/architecture/exit-rules.md` | Ladder + precedence + hysteresis doc, docs-before-code | ✓ VERIFIED | Contains `STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD` verbatim (line 39) |
| `packages/core/src/exits/domain/exit-rules.ts` | Registry + EXIT_PRECEDENCE + threshold constants | ✓ VERIFIED | All 7 rules present, precedence array matches doc exactly, thresholds match CONTEXT verbatim |
| `packages/core/src/exits/domain/evaluate-exit.ts` | Pure 3-arg evaluator | ✓ VERIFIED | `evaluateExit(position, context, previousVerdict)`, gate-first, precedence walk, pure (no I/O, no Date.now()) |
| `packages/adapters/src/postgres/migrations/0020_exit_verdicts.sql` | Append-only, composite PK, no FK | ✓ VERIFIED | `PRIMARY KEY(observed_at, calendar_id)`, no FK on calendar_id (matches calendar_snapshots convention), RLS enabled |
| `packages/core/src/exits/application/computeExitAdvice.ts` | Read order → evaluate → persist, single ledger read | ✓ VERIFIED | Read order matches locked sequence; `observedAt` keyed to snapshot's own time (retry-safe, documented deviation 1) |
| `apps/worker/src/main.ts` chain-for-roll closure | ×1000 strike unit conversion | ✓ VERIFIED | `readChainForRollForExits` divides `quote.strike / 1000` (main.ts:652), documented deviation 2 |
| `apps/server/src/adapters/http/exits.routes.ts` + `mcp/tools.ts` | GET /api/exits + get_exit_advice, same schema | ✓ VERIFIED | Both wired, MCP-02 parity test passes with literal payload equality |
| `apps/web/src/screens/HeldPositionsPanel.tsx` + `ExitRulesPanel.tsx` | Verdict chips + ruleSet panel | ✓ VERIFIED | Present, wired into Analyzer.tsx below the unchanged 3-col grid, 63/63 tests green |
| `packages/core/src/exits/application/getExitAdvice.ts` | Read use-case backing both surfaces | ⚠️ HOLLOW (partial) | Structurally correct and wired, but `changed` field is a dead constant (`false`) — see Gaps |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| haircutFill export | ROLL pricing (evaluate-exit.ts) | direct import, `haircutFill(best, "sell")` | ✓ WIRED | Confirmed by import + call site; picker's own 18/18 candidate-selection tests stay green post-extraction |
| contracts/exits.ts exitsResponse | repo write+read, HTTP route, MCP tool, Analyzer panel | shared Zod schema | ✓ WIRED | Single schema imported by all four consumers; typecheck enforces one-sided drift |
| compute-picker → compute-exit-advice | boss.send singletonKey chain trigger | `apps/worker/src/handlers/compute-picker.ts` | ✓ WIRED | Mirrors compute-gex-snapshot precedent; schedule.ts registers chain-triggered-only queue (16 queues total) |
| computeExitAdvice hasChanged() | getExitAdvice `changed` field (UI CHANGED marker) | *(no path — never persisted)* | ✗ NOT WIRED | `hasChanged()`'s boolean is used only for a `console.warn` side-effect and discarded; `getExitAdvice.ts:76` hardcodes `changed: false` regardless of real state — confirmed by the use-case's own test (`getExitAdvice.test.ts:121`) |
| evaluateExit escalate | UI escalated chip (STOP red-fill / EXIT-pre-event amber-fill) | `ExitVerdict.escalate` persisted + flattened at route/MCP boundary | ✓ WIRED | `escalate` rides inside the persisted blob (unlike `changed`) and is correctly forwarded end-to-end |

### Data-Flow Trace (Level 4) — getExitAdvice → HeldPositionsPanel

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `HeldPositionsPanel.tsx` | `position.changed` | `getExitAdvice.ts` `row.verdict.changed ?? false` (real write-time value, gap closed 2026-07-09T11:07:51Z) | Yes — real, persisted at write time by computeExitAdvice.ts | ✓ FLOWING |
| `HeldPositionsPanel.tsx` | `position.verdict` / `escalate` / `indicative` / `pnlPct` / `roll` | `getExitAdvice.ts` re-derivation from live snapshot + verdict-row reads | Yes — real DB-backed reads | ✓ FLOWING |
| `ExitRulesPanel.tsx` | `ruleSet` | `EXIT_RULE_METADATA.map(...)` in getExitAdvice.ts | Yes — real registry data | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Exit-rules registry invariants (exhaustive precedence, locked thresholds) | `bun run vitest run packages/core/src/exits` | 65 tests passed | ✓ PASS |
| Picker haircut regression (extraction behavior-identical) | `bun run vitest run packages/core/src/picker/domain/candidate-selection.test.ts` | 18/18 passed | ✓ PASS |
| Postgres/memory exit_verdicts + calendar-snapshots contracts (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts packages/adapters/src/memory/exit-verdicts.contract.test.ts packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts packages/adapters/src/memory/calendar-snapshots.contract.test.ts` | 70 tests passed | ✓ PASS |
| HTTP route + MCP tool (incl. get_exit_advice parity) | `bun run vitest run apps/server/src/adapters/http/exits.routes.test.ts apps/server/src/adapters/mcp/tools.test.ts` | 21 tests passed | ✓ PASS |
| Analyzer held-positions + exit-rules panels (incl. escalation/indicative/CHANGED/no-affordance) | `bun run vitest run apps/web/src/screens/Analyzer.test.tsx` | 63 tests passed | ✓ PASS |
| EXIT-10 never-execute static guard (real file scan, not vacuous) | inline in `computeExitAdvice.test.ts` "EXIT-10 — never-execute guard" | 1/1 passed, scans real `.ts` files via `import.meta.glob`, asserts `files.length > 0` before checking | ✓ PASS |
| Workspace typecheck | `bun run typecheck` | clean | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|-------------|-----------------|--------|----------|
| EXIT-01 | 26-01, 26-02, 26-03, 26-04 | ✓ SATISFIED | Verdict-per-calendar-per-cycle machinery verified above |
| EXIT-02 | 26-02, 26-03, 26-04 | ✓ SATISFIED | Ledger-only P&L basis, no parallel recompute |
| EXIT-03 | 26-02 | ✓ SATISFIED | TERM/GAMMA/EVT thresholds at locked values, fast-check boundary-proven |
| EXIT-04 | 26-01, 26-02 | ✓ SATISFIED | No confidence field anywhere; every verdict names ruleId + raw metric |
| EXIT-05 | 26-02 | ✓ SATISFIED | Hysteresis + session/staleness gating, fast-check no-flap both directions |
| EXIT-06 | 26-01, 26-02, 26-04 | ✓ SATISFIED | ROLL haircut-priced via shared haircutFill; unit-converted chain read |
| EXIT-07 | 26-06 | ✓ SATISFIED | Held-positions panel + exit rules panel rendered from engine payload |
| EXIT-08 | 26-05 | ✓ SATISFIED | Route + MCP parity, literal payload equality proven |
| EXIT-09 | 26-02, 26-04, 26-06 | ✓ SATISFIED (gap closed 2026-07-09T11:07:51Z) | Escalation sub-clause satisfied; changes-surface-as-alerts sub-clause now real — `changed` is persisted at write time and read straight through (see Gap Closure) |
| EXIT-10 | 26-04, 26-06 | ✓ SATISFIED | Static guard + no UI action affordance, both real and non-vacuous |

No orphaned requirements: `.planning/REQUIREMENTS.md`'s EXIT-01..10 rows all map to a plan's `requirements:` frontmatter field. (Note: REQUIREMENTS.md's own checkboxes/status column still read "Pending" — this is the known project-wide bookkeeping gap noted in prior phases' memory, not a Phase 26 code issue, and is not gated on here.)

### Anti-Patterns Found

None. Scanned all key files created/modified across 26-01..26-06 (domain, application, adapters, routes, MCP, UI) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches. No stub returns, no hardcoded empty renders backing dynamic UI (aside from the `changed:false` issue captured as a Gap, which is a discrete logic omission, not a generic stub pattern).

### TDD Deviation Scrutiny (26-04)

26-04-SUMMARY.md documents a one-pass implement+test deviation (no separate RED commit) with a manual mutation check: the `changed && escalate` console.warn gate was temporarily disabled and the "change detection" test failed as expected before being restored. Spot-checked 3 assertions in `computeExitAdvice.test.ts`'s "change detection" and "EXIT-10" blocks — they assert exact values (`toBe("STOP")`, `toEqual([])`, `toBe(true)`), not truthiness. The tests genuinely discriminate. This deviation is accepted; it does not relate to the `changed`-field gap above (that gap is a getExitAdvice.ts design omission, orthogonal to 26-04's own console.warn behavior, which IS correctly implemented and tested).

### Human Verification Required

None required to resolve the gap above — it is a concretely observable code defect (a hardcoded literal), not a behavior needing human judgment. The one item flagged by 26-06-SUMMARY.md as pending (D8: pixel-level visual UAT of chip colors against 26-UI-SPEC via chrome-devtools) remains open per that summary's own note, but is a visual-fidelity check, not a functional gap, and is not blocking this verification's gaps_found determination — it would be a `human_needed` item if EXIT-09's `changed` gap did not already force `gaps_found` (Step 9's ordered decision tree: gaps_found takes precedence).

### Gaps Summary

**RESOLVED 2026-07-09T11:07:51Z — see "Gap Closure" section below.** Phase 26 is now fully
verified: the evaluator, thresholds, precedence, hysteresis, persistence, worker chain, HTTP/MCP
parity, and Analyzer UI are all real, wired, and covered by non-vacuous tests. The one gap found
at initial verification — the "CHANGED" marker could never activate against live data because
`getExitAdvice.ts` hardcoded `changed: false` — is closed: `computeExitAdvice.ts` now persists the
same `hasChanged()` result it already used for its console.warn, and `getExitAdvice.ts` reads it
straight through instead of a hardcoded literal.

---

_Verified: 2026-07-09T10:58:32Z_
_Verifier: Claude (gsd-verifier)_

## Gap Closure (2026-07-09)

**Gap closed:** EXIT-09 — the `changed` flag the Analyzer's CHANGED marker (and the wire
`heldPositionVerdict.changed` field) depends on was hardcoded `false` in `getExitAdvice.ts`,
even though `computeExitAdvice.ts` already correctly computed it at write time via `hasChanged()`
(used only for a `console.warn` side-effect, then discarded).

**Fix (TDD red→green, `packages/core`, `packages/contracts`, `packages/adapters`):**

1. `packages/contracts/src/exits.ts` — added `changed: z.boolean().default(false)` to the
   persisted `exitVerdict` JSONB blob schema. Additive field, no SQL migration; `.default(false)`
   means a row written before this fix still parses (legacy rows read back as `changed: false`).
2. `packages/core/src/exits/application/ports.ts` — `ExitVerdictRow.verdict` type widened to
   `ExitVerdict & { readonly changed?: boolean }` (optional, for the same legacy-row reason).
3. `packages/core/src/exits/application/computeExitAdvice.ts` — `hasChanged(verdict,
   previousVerdict)` is now computed once into a `changed` local, used for the existing
   `console.warn` escalation gate (unchanged behavior) AND attached to the object passed to
   `persistExitVerdict` (`{ ...verdict, changed }`) — the value that used to be thrown away is
   now the value that gets written to `exit_verdicts`.
4. `packages/core/src/exits/application/getExitAdvice.ts` — `changed: false` (hardcoded) replaced
   with `changed: row.verdict.changed ?? false` (real value, legacy-safe fallback).
5. `packages/adapters/src/__contract__/exit-verdicts.contract.ts` — added two round-trip cases run
   against BOTH the Postgres (testcontainers) and in-memory repos: a real `changed:true` value
   round-trips through insert → read, and a legacy raw blob with no `changed` key at all still
   reads back `false` (proves the additive-field/no-migration claim on the actual storage layer,
   not just in-process).
6. `evaluate-exit.ts` (the pure evaluator) was deliberately left untouched — `hasChanged()` stays
   in `computeExitAdvice.ts` where it already lived; only its output's destination changed.

**RED confirmed before the fix:** `getExitAdvice.test.ts`'s new
`"passes the persisted row's real write-time changed:true through to the API response"` test was
run against the pre-fix code and failed with `AssertionError: expected false to be true` (an
assertion failure, not an import/type error) — the exact defect the gap report named.

**Evidence (all green after the fix):**

- `bun run vitest run packages/core/src/exits packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts packages/adapters/src/memory/exit-verdicts.contract.test.ts apps/server/src/adapters/http/exits.routes.test.ts apps/server/src/adapters/mcp/tools.test.ts` — 100/100 passed (includes 3 new getExitAdvice.ts tests, 2 new contract-suite tests run against both adapters, and extended assertions on 3 existing computeExitAdvice.ts change-detection tests asserting the persisted `verdict.changed` value, not just the console.warn side-effect)
- `bun run test` (full workspace) — 2507/2507 passed, 244/244 files
- `bun run typecheck` — clean
- `bun run lint` — clean (pre-existing config warnings only, no new findings)

**Commits:**

- `d392a3d` — `fix(26): persist and surface the exit-verdict changed flag (EXIT-09)`

**Status change:** `gaps_found` → `passed`. Score: 5/5 truths fully verified. EXIT-09: `✗ BLOCKED` → `✓ SATISFIED`.
