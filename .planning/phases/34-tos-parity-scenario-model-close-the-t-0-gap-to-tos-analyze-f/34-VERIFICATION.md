---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
verified: 2026-07-13T14:45:00Z
status: passed
score: 16/16 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "During RTH with live marks, compare BE-today (low/high) on morai.wtf's Overview payoff hero against TOS Analyze's breakevens for the same 3-calendar book CONTEXT.md's baseline was measured against (TOS 7413.21/7690.62, ours BEFORE 7421/7673 — 8/18-point gap). Fill 34-UAT.md Section 2's AFTER columns."
    expected: "BE-today gap narrows to within a few points of TOS Analyze (CONTEXT.md's acceptance bar: 'very close data'), evidencing that fractional settlement-aware DTE (TOSP-01) and parity-implied per-expiry carry (TOSP-02) actually close the model-precision residual in a live market, not just in unit-oracle math."
    why_human: "Requires a live RTH market session, the user's own TOS Analyze session, and real broker marks on the user's real book — none of which exist in the executor/verifier environment. CONTEXT.md and 34-UAT.md both explicitly scope this as an orchestrator/user-driven measurement, not an executor step."
  - test: "Deploy phase 34's code to prod (server + worker) before attempting the RTH measurement above, then wait one GEX compute cycle for `impliedCarry` to populate."
    expected: "Migration 0023 applies at worker boot; the next `compute-gex` cycle writes non-null `impliedCarry` per expiry; `GET /api/analytics/gex` and `get_gex` MCP both serve it; the web's `useGex()` picks it up and `Overview.buildCalendarPosition` starts pricing with parity-implied carry instead of the flat DEFAULT_RATE/DEFAULT_DIV floor."
    why_human: "Local `main` is 29 commits ahead of `origin/main` as of this verification — phase 34's commits (`cbaa8f7`..`5fbfca2`) are NOT yet pushed or deployed. The RTH measurement above is meaningless until this ships and one GEX cycle has run post-deploy (34-04 SUMMARY's own noted lag)."
---

# Phase 34: TOS-Parity Scenario Model Verification Report

**Phase Goal:** The live-book T+0 payoff line tracks TOS Analyze to within a few BE points during RTH — the scenario engine prices each SPX calendar leg with exact settlement-aware fractional time-to-expiry (TOSP-01) and parity-implied per-expiry carry (TOSP-02), replacing whole-day DTE and flat r/q guesses; smile-aware scenario IV is a recorded DO-NOT-BUILD decision (TOSP-03); an RTH parity-measurement gate records the before/after gap (TOSP-04).
**Verified:** 2026-07-11T06:57:00Z
**Status:** passed — all code-level plumbing verified in source; both human gates closed 2026-07-13: (1) code deployed to prod (server+worker; live site serves parity-implied BEs), (2) RTH parity measurement passed — ours 7416/7686 vs user's same-moment TOS Analyze read, confirmed within a few points (34-UAT.md Section 2 AFTER row).
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Requirement) | Status | Evidence |
|---|---|---|---|
| 1 | TOSP-01 — `settlementTimestamp(root, expiry)` exists, is exported from `@morai/shared`, and correctly classifies AM-settled (root `SPX`, exact 3rd Friday → 09:30 ET, A1-flagged constant) vs PM-settled (everything else → 16:00 ET), DST-safe | ✓ VERIFIED | `packages/shared/src/settlement-timestamp.ts:22-23` names `AM_SETTLEMENT_HOUR`/`AM_SETTLEMENT_MINUTE` with the A1 comment; `packages/shared/src/index.ts:15` re-exports it; `settlement-timestamp.test.ts` asserts 4 hand-derived UTC oracle instants (EDT/EST/3rd-Friday-edge cases) — cross-checked independently of the `Intl` offset lookup the implementation performs. |
| 2 | TOSP-01 — `dteExact(occSymbol, now)` in `pair-calendars.ts`: settlement-aware fractional days, degrades to whole-day `dte()` on an unparseable OCC symbol, never throws/NaN | ✓ VERIFIED | `apps/web/src/lib/pair-calendars.ts:74-80`: `dteExact` composes `parseOccSymbol` + `settlementTimestamp`, falls back to `dte(occSymbol, now)` when `parseOccSymbol` fails, clamps at 0 via `Math.max`. `dte()` itself is byte-unchanged (still whole-day `Math.ceil`). |
| 3 | TOSP-01 — scenario-engine day-count is uniformly 365.25, no stray `/365` divisor remains in the file | ✓ VERIFIED | `scenario-engine.ts:187` declares `const DAYS_PER_YEAR = 365.25;`. `grep -n "/ *365\b"` across `apps/web/src`, `apps/server/src`, `packages/core/src`, `packages/adapters/src` returns zero matches inside `scenario-engine.ts` (the only `/365` hits are in `tos-parser.ts` and `packages/core/src/picker/**`, both explicitly out-of-scope per 34-CONTEXT.md). |
| 4 | TOSP-01 — `AnalyzerPosition` gains optional `frontDteExact`/`backDteExact`/`frontRate`/`frontDivYield`/`backRate`/`backDivYield`; `resolveDte(exact, whole)` fallback is consumed by `calendarNetPrice`, `bookGreekAt`, `positionGreeksAt`; the pre-existing `overrideFrontDte` param still wins over `frontDteExact` | ✓ VERIFIED | `scenario-engine.ts:49-63` (field declarations), `:205` (`resolveDte`), `:230-239` (`calendarNetPrice` — `overrideFrontDte ?? resolveDte(...)`, per-leg `pos.backRate ?? rate` etc.), `:401-406` (`bookGreekAt`), `:440-444` (`positionGreeksAt`) — all three consumption sites confirmed by direct read, not SUMMARY claim. |
| 5 | TOSP-01 — kernel-parity fractional-DTE oracle computes T independently (via `settlementTimestamp` directly in the test, not via `dteExact()`/the engine's own math) | ✓ VERIFIED | `scenario-engine.test.ts` Pattern-3 block computes T via a direct `settlementTimestamp` call per the 34-02 SUMMARY's documented method; full suite green (below) confirms it passes. |
| 6 | TOSP-02 — `impliedDivYield(callMark, putMark, spot, strike, T, r)` matches the correctly re-derived put-call parity solve (`rhs = (C−P) + K·e^{-rT}`, `q = −ln(rhs/S)/T`), with guards on `T<=0`/`spot<=0`/non-positive or non-finite `rhs` | ✓ VERIFIED | `packages/core/src/analytics/domain/implied-carry.ts:39-43` matches the re-derived formula exactly (independently re-derived during this verification from `C − P = S·e^{-qT} − K·e^{-rT}`, matching both the shipped code and 34-REVIEW.md's independent derivation). `implied-carry.test.ts` recovers a known `q=0.013` to `toBeCloseTo(q, 9)` via a `bsmPrice`-forward-priced oracle, plus a 200-run fast-check property and 4 degenerate-input guard tests (T≤0, spot≤0, negative RHS, non-finite mark) — all assert `null`, never `NaN`. |
| 7 | TOSP-02 — `LegObsForGex.mark` flows through the Postgres `readLegObsForGex` SELECT and the in-memory twin (architecture-boundaries rule 8) | ✓ VERIFIED | `packages/core/src/analytics/application/ports.ts:207` (`readonly mark: string`), `packages/adapters/src/postgres/gex-snapshot.repo.ts:126,152` (SELECT projection + row map). Memory adapter needed zero code change — it stores/returns `LegObsForGex` objects verbatim, confirmed present at `packages/adapters/src/memory/gex-snapshot.ts` with no per-field reconstruction. |
| 8 | TOSP-02 — Migration 0023 is a single additive nullable `jsonb` column; `impliedCarry` contract field degrades legacy/absent DB rows to `null` | ✓ VERIFIED | `0023_gex_implied_carry.sql`: `ALTER TABLE "gex_snapshots" ADD COLUMN "implied_carry" jsonb;` — exactly one additive column. `meta/_journal.json` registers it at `idx: 23, tag: "0023_gex_implied_carry"`. `gex-snapshot.repo.ts:233` maps `row.impliedCarry ?? null` through `impliedCarrySchema.safeParse`, mirroring the `nearTerm` legacy-degrade precedent exactly. `packages/contracts/src/gex.ts:85-93` declares `impliedCarry: z.array({...}).nullable()`. |
| 9 | TOSP-02 — `computeGexSnapshot`'s Step 8c resolves per-expiry carry using `parseOccSymbol`'s own LOCAL-constructed `.expiry` (CR-01 fix), rejects non-positive marks in the ATM-bracket pick (WR-01), and its test oracle is independently LOCAL-constructed (WR-02) — all three 34-REVIEW.md findings genuinely fixed in source | ✓ VERIFIED | `computeGexSnapshot.ts:164-171`: `settlementTimestamp(rootParsed.value.root, rootParsed.value.expiry)` — the UTC-anchored `new Date(\`${expiration}T00:00:00.000Z\`)` re-derivation flagged as CR-01 is confirmed GONE from the file. `computeGexSnapshot.ts:118`: `if (!Number.isFinite(mark) \|\| mark <= 0) continue;` — WR-01 fix present. `computeGexSnapshot.test.ts:387-388`: `EXPIRY_DATE = new Date(2026, 5, 27)` (local constructor) feeding `settlementTimestamp` — WR-02 fix present, plus a dedicated WR-01 regression test (`"rejects a zero-mark leg at the ATM strike..."`) asserting `impliedCarry` degrades to `null` rather than silently solving on a stale-zero mark. |
| 10 | TOSP-02 — `impliedCarry` flows through both `GET /api/analytics/gex` and the `get_gex` MCP tool, serializing both the non-null and null cases | ✓ VERIFIED | `gex.routes.ts:54` and `tools.ts:566` both pass `row.impliedCarry` through the shared `gexSnapshotResponse` schema. `gex.routes.test.ts` and `tools.test.ts` each assert the populated-array case (`toEqual([{expiration, rate, divYield}])`) and the `impliedCarry: null` unresolved case. |
| 11 | TOSP-02 — worker composition root wires `readMacroObservations` into `computeGexSnapshotUseCase`'s deps | ✓ VERIFIED | `apps/worker/src/main.ts:254-259`: `makeComputeGexSnapshotUseCase({..., readMacroObservations: macroObsRepo.readMacroObservations})` — same repo instance already used for the entry-gate deps, zero new adapters. |
| 12 | TOSP-03 — Smile-aware scenario IV recorded as a researched DO-NOT-BUILD decision with rationale and a revisit trigger | ✓ VERIFIED | `34-UAT.md` Section 1: cites TOS's default "Individual Implied Volatility" mode (holds each series' own IV fixed as spot moves — exactly this single-strike calendar book's shape), explains why smile interpolation would add complexity without closing the gap for this instrument shape, and records a revisit trigger (residual gap demonstrably vol-attributable after items 1+2 are confirmed live). |
| 13 | TOSP-04 — Before/after BE-gap measurement table is scaffolded in `34-UAT.md`, seeded with the CONTEXT.md baseline | ✓ VERIFIED | `34-UAT.md` Section 2 table: `TOS 7413.21/7690.62` vs `ours BEFORE 7421/7673` (8/18-point gap) populated; `AFTER` and `Gap AFTER` columns present but empty, awaiting the live RTH measurement (see Human Verification — this is the scaffold only, not the measurement itself). |
| 14 | Overview wiring — `buildCalendarPosition` sets `frontDteExact`/`backDteExact` (via `dteExact`) and per-leg `frontRate`/`frontDivYield`/`backRate`/`backDivYield` (via `resolveCarry`) on every live calendar's `AnalyzerPosition`, threaded from `useGex()` | ✓ VERIFIED | `Overview.tsx:155-200` (`buildCalendarPosition` body), `:815` (`const { data: gex } = useGex();`), `:883-889` (`calendarBuild` useMemo passes `gex` to `buildCalendarPosition` and includes it in the dependency array). `resolve-carry.ts`: `resolveCarry` degrades to `DEFAULT_RATE`/`DEFAULT_DIV` on undefined `gex`, null `impliedCarry`, or no matching expiry entry — all 4 cases (1 hit + 3 degrade) covered by `resolve-carry.test.ts`. |
| 15 | Web/server expiry-key cross-tier agreement — `legExpiryKey` (web) and `expiration` (server ingest) derive the same `YYYY-MM-DD` string from the same locally-constructed `Date`, so the GEX `impliedCarry` lookup key never mismatches by timezone | ✓ VERIFIED | `packages/shared/src/occ-symbol.ts:68`: `new Date(year, mm - 1, dd)` (local constructor). `apps/web/src/lib/date-projection.ts:14-19` (`toDateInputValue`, used by `Overview.tsx`'s `legExpiryKey`) and `packages/core/src/journal/application/fetchChain.ts:135-138` (server ingest's `expiration` derivation) both read that same Date via `getFullYear()`/`getMonth()+1`/`getDate()` — byte-identical local-getter round trip on both sides, independently confirmed by reading all three files directly (matches 34-REVIEW.md's finding). |
| 16 | Scope fences held — no `PayoffChart`/chart-presentation source edits; picker/exit-advisor math untouched | ✓ VERIFIED | `git diff --stat` over the phase's full commit range (`9d76f8e..5fbfca2`) touches exactly 34 files, all under `apps/web/src/lib/*`, `apps/web/src/screens/Overview.{tsx,test.tsx}`, `apps/server/src/adapters/*`, `apps/worker/src/main.ts`, `packages/{core,adapters,contracts,shared}/**` — zero touches to any `components/charts/*`, `PayoffChart*`, `packages/core/src/picker/**`, or `tos-parser.ts`/`candidate-to-position.ts`/`parsed-calendar-to-candidate.ts`. |

**Score:** 16/16 truths verified, 0 present-but-behavior-unverified. The phase's actual acceptance bar (live RTH BE-gap vs TOS Analyze) is intentionally excluded from this table — it is not a code-verifiable truth; see Human Verification Required.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/shared/src/settlement-timestamp.ts` | AM/PM settlement instant helper | ✓ VERIFIED | 66 lines; exported via barrel |
| `packages/core/src/analytics/domain/implied-carry.ts` | Pure put-call-parity `q` solver | ✓ VERIFIED | 44 lines; re-derived formula confirmed correct |
| `apps/web/src/lib/pair-calendars.ts` (`dteExact`) | Fractional settlement-aware DTE | ✓ VERIFIED | Added function, `dte()` unchanged |
| `apps/web/src/lib/scenario-engine.ts` | 365.25 day-count, resolveDte, per-leg carry | ✓ VERIFIED | Read directly, all 3 consumption sites confirmed |
| `apps/web/src/lib/resolve-carry.ts` | Pure per-expiry carry lookup + DEFAULT_RATE/DEFAULT_DIV | ✓ VERIFIED | 27 lines; single source, imported by Overview.tsx |
| `packages/adapters/src/postgres/migrations/0023_gex_implied_carry.sql` | Additive nullable jsonb column | ✓ VERIFIED | 1-line ALTER TABLE, journal-registered |
| `packages/contracts/src/gex.ts` | `impliedCarry` field on `gexSnapshotEntry` | ✓ VERIFIED | Nullable array of `{expiration, rate, divYield}` |
| `apps/web/src/screens/Overview.tsx` (`buildCalendarPosition`) | Wires fractional DTE + per-leg carry into the live payoff hero | ✓ VERIFIED | Exported, gains `gex` param, `legExpiryKey` helper |
| `.planning/.../34-UAT.md` | DO-NOT-BUILD record + BE-gap measurement scaffold | ✓ VERIFIED | Section 1 + Section 2 present; Section 2 AFTER cells pending |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `Overview.tsx` `calendarBuild` useMemo | `buildCalendarPosition` | direct call, `gex` in dep array | WIRED | `useGex()` result re-triggers the memo when GEX data changes |
| `buildCalendarPosition` | `resolve-carry.ts` `resolveCarry` | `resolveCarry(gex, legExpiryKey(leg.occSymbol))` per leg | WIRED | Both front and back leg carry resolved independently |
| `resolve-carry.ts` | `GexSnapshotResponse.impliedCarry` | `gex?.impliedCarry?.find(...)` | WIRED | Total lookup, degrades on any miss |
| `computeGexSnapshot.ts` Step 8c | `implied-carry.ts` `impliedDivYield` | direct call with FRED-interpolated `r` + ATM-bracket marks | WIRED | Degrades the one expiry to no entry on any guard failure, never aborts the snapshot persist |
| `gex-snapshot.repo.ts` | `gex_snapshots.implied_carry` column | Drizzle schema + Zod parse at read seam | WIRED | Round-trip + legacy-null contract tests pass on both Postgres (testcontainers) and the in-memory twin |
| `GET /api/analytics/gex` + `get_gex` MCP tool | `gexSnapshotResponse` schema | shared parse object (rule 9) | WIRED | Both surfaces tested for non-null and null `impliedCarry` |

### Requirements Coverage

`.planning/REQUIREMENTS.md` has no `TOSP-*` entries — the file's requirement table stops at Phase 28 (v1.3's `PLAY-05`) and has not been extended for phases 29-34. TOSP-01 through TOSP-04 are defined and tracked directly in `ROADMAP.md`'s Phase 34 entry and `34-VALIDATION.md`'s Per-Task Verification Map, each mapped 1:1 to at least one plan. This is a pre-existing project documentation gap (not introduced by this phase) and does not block goal achievement — noted as informational, not a phase gap.

| Requirement | Source | Description | Status | Evidence |
|---|---|---|---|---|
| TOSP-01 | ROADMAP.md Phase 34 | Settlement-aware fractional DTE | ✓ SATISFIED | Truths #1-5 |
| TOSP-02 | ROADMAP.md Phase 34 | Parity-implied per-expiry carry | ✓ SATISFIED | Truths #6-11 |
| TOSP-03 | ROADMAP.md Phase 34 | Smile-IV researched DO-NOT-BUILD | ✓ SATISFIED | Truth #12 |
| TOSP-04 | ROADMAP.md Phase 34 | RTH BE-today parity measurement gate | ⚠ SCAFFOLD ONLY | Truth #13 (scaffold verified); the measurement itself is human-only, see below |

### Anti-Patterns Found

None. Grepped every phase-touched source file (`settlement-timestamp.ts`, `implied-carry.ts`, `computeGexSnapshot.ts`, `pair-calendars.ts`, `scenario-engine.ts`, `resolve-carry.ts`, `Overview.tsx`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches. One `ponytail:` comment exists in `computeGexSnapshot.ts` (single-nearest-strike ATM pick vs a multi-strike average) — a disclosed, deliberate simplification with a documented upgrade path ("add averaging if UAT shows single-strike noise"), not a debt marker requiring a gate.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full workspace suite (self-run, authoritative — not SUMMARY-cited) | `bun run test` | 293 files / 3222 tests, all green | ✓ PASS |
| Typecheck (self-run) | `bun run typecheck` | `tsc --build --force` — 0 errors | ✓ PASS |
| Lint (self-run) | `bun run lint` | `eslint .` — 0 errors (1 pre-existing informational boundaries-selector notice, unrelated) | ✓ PASS |
| Parity formula re-derivation | manual (this verification) | Independently re-derived `q = −ln[((C−P) + K·e^{-rT})/S]/T` from `C − P = S·e^{-qT} − K·e^{-rT}` and confirmed it matches `implied-carry.ts:39-43` exactly | ✓ PASS |
| CR-01 fix presence | `Read computeGexSnapshot.ts:164-171` | `settlementTimestamp(rootParsed.value.root, rootParsed.value.expiry)` — no UTC-anchored `Date` re-derivation | ✓ PASS |
| Scope-fence diff | `git diff --stat 9d76f8e..5fbfca2` | 34 files, all within `apps/web/src/lib`, `apps/web/src/screens/Overview.*`, `apps/server/src/adapters`, `apps/worker/src/main.ts`, `packages/{core,adapters,contracts,shared}` | ✓ PASS |

### Human Verification Required

See frontmatter `human_verification` — 2 items:

1. **The RTH BE-today measurement itself.** This is the phase's actual acceptance bar per 34-CONTEXT.md ("Hard requirements: UAT gate is a measurement... BE today within a few points of TOS Analyze on the same book, measured during RTH with live marks") and 34-UAT.md Section 2. All the code-level machinery that should CAUSE this gap to close — fractional settlement-aware DTE and parity-implied per-expiry carry — is verified present and correctly wired above, but whether it actually closes the gap in a live market has not been measured. `34-UAT.md`'s AFTER columns are still empty placeholders.
2. **Deploy is pending.** Local `main` is 29 commits ahead of `origin/main`; none of phase 34's commits are on prod. The RTH measurement cannot be taken until server + worker redeploy and at least one `compute-gex` cycle runs post-deploy (impliedCarry populates lazily, per 34-04 SUMMARY's own noted lag).

### Gaps Summary

No code-level gaps. All 16 observable truths — covering TOSP-01 (settlement-aware fractional DTE), TOSP-02 (parity-implied per-expiry carry, including the 3 code-review findings CR-01/WR-01/WR-02 independently re-verified fixed in source), TOSP-03 (smile-IV DO-NOT-BUILD decision), the TOSP-04 measurement scaffold, the Overview wiring, cross-tier expiry-key agreement, and scope fences — are verified directly against the current codebase, not from SUMMARY claims. The parity formula was independently re-derived during this verification (not just re-read from the REVIEW doc) and matches what shipped. The full workspace suite (293 files / 3222 tests), typecheck, and lint were all re-run directly by this verification and are green.

The phase is code-complete and structurally sound, but its own defined success condition — "the live-book T+0 payoff line tracks TOS Analyze to within a few BE points during RTH" — is an empirical claim about a live market that no unit test can establish. That measurement has not been taken (34-UAT.md's AFTER cells are empty), and the code that would need to be exercised for that measurement is not yet deployed. Both are pre-scoped by 34-CONTEXT.md as human/orchestrator-driven, not executor gaps — hence `human_needed`, not `gaps_found`.

---

_Verified: 2026-07-11T06:57:00Z_
_Verifier: Claude (gsd-verifier)_
