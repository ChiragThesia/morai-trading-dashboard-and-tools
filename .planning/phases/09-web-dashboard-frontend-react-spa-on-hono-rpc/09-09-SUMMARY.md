---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "09"
subsystem: tos-parser-iv-bisection
tags: [tdd, parser, iv-bisection, quant, pure-ts, fast-check]
status: complete

dependency_graph:
  requires:
    - 09-02 (@morai/quant leaf with bsmPrice — bisection target)
  provides:
    - apps/web/src/lib/iv-bisection.ts (impliedFlatIv over @morai/quant kernel)
    - apps/web/src/lib/iv-bisection.test.ts (example + fast-check round-trip, 5 tests)
    - apps/web/src/lib/tos-parser.ts (parseTosOrder — 9 locked rules)
    - apps/web/src/lib/tos-parser.test.ts (9-rule unit suite + canonical sample + round-trip, 33 tests)
  affects:
    - Plan 10 (Analyzer screen — consumes parseTosOrder + impliedFlatIv)

tech_stack:
  added: []
  patterns:
    - TDD red→green (failing import → GREEN)
    - Pure-TS parser (no DOM, no eval — T-09-06 V5 boundary)
    - Bounded bisection (MAX_ITER=64 — T-09-07 DoS guard)
    - fast-check property testing (Math.fround() bounds, numRuns:1000)
    - noUncheckedIndexedAccess safe via nullish coalescing (??  pattern)
    - strict-boolean-expressions via explicit undefined comparisons

key_files:
  created:
    - apps/web/src/lib/iv-bisection.ts
    - apps/web/src/lib/iv-bisection.test.ts
    - apps/web/src/lib/tos-parser.ts
    - apps/web/src/lib/tos-parser.test.ts

decisions:
  - "Date regex anchored to valid month names (JAN|FEB|...) to prevent false matches on digit sequences like '00 PUT 30'"
  - "impliedFlatIv returns lo/hi bound (not null) when debit is outside [lo,hi] bracket — always finite"
  - "noUncheckedIndexedAccess: rawDates[0] ?? 0 with null guard; array access safe without !"
  - "strict-boolean-expressions: dayStr === undefined (not !dayStr) per ESLint rule"
  - "type: 'C' | 'P' extracted via === 'CALL' ternary (no char indexing, no as-cast)"
  - "q=0.013 (SPX continuous dividend yield D-01 default) hardcoded in parseTosOrder — Rule 8"

metrics:
  duration: "~10 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 09 Plan 09: TOS Calendar Paste Parser + Implied-IV Bisection (TDD)

TDD'd the TOS calendar paste parser (9 locked rules from UI-SPEC) and the implied-IV bisection over the shared `@morai/quant` BSM kernel. Parser is pure TS (no DOM, no eval) with strict type safety; bisection is bounded at MAX_ITER=64 and IV range [0.02, 2.0].

## What Was Built

**Task 1 — Implied-IV bisection (RED→GREEN)**

RED: Wrote `iv-bisection.test.ts` with an example fixture (PUT calendar at K=7550, 20d/30d, debit=5.80), a CALL variant at deep OTM K=8500, default-IV tests, and a fast-check round-trip property (generate seed IV → price spread → bisect back → assert re-price ≈ synthetic debit; numRuns:1000, Math.fround() bounds; degenerate debit<0.10 skipped). RED confirmed: "Failed to resolve import './iv-bisection.ts'".

GREEN: Wrote `iv-bisection.ts` implementing `impliedFlatIv({S,K,frontT,backT,type,r,q,debit})`. Bisects `bsmPrice(S,K,backT,iv,r,q,type) − bsmPrice(S,K,frontT,iv,r,q,type)` over [LO=0.02, HI=2.0] with MAX_ITER=64. Returns DEFAULT_IV=0.15 when debit is null/undefined. Returns closest bound (lo or hi) when debit is unbracketable. 5 tests GREEN, typecheck clean.

Initial CALL fixture used debit=3.50 with K=7600 at S=7550 — unbracketable (spread at LO already ≈4.35). Fixed to K=8500 deep OTM where debit=10.0 is bracketable. Documented as Rule 1 (auto-fix bug in test fixture).

**Task 2 — TOS parser 9 rules (RED→GREEN)**

RED: Wrote `tos-parser.test.ts` with per-rule unit tests (Rule 1: qty abs+min1+bare-N+default; Rule 2: PUT/CALL+default-P; Rule 3: strike extraction including ignoring lot size; Rule 4: debit optional; Rule 5: two-date sort; Rule 6: DTE validation; Rule 7: underlying+SPX-default+non-SPX; Rule 8: IV default 0.15 and finite on debit; Rule 9: PUT+CALL), the canonical UI-SPEC sample, null-on-failure cases (one expiry, no expiry, no strike, garbled), and a fast-check round-trip property. RED confirmed: "Failed to resolve import './tos-parser.ts'". Committed RED.

GREEN: Wrote `tos-parser.ts` implementing `parseTosOrder(text, today, spot, rate) → ParsedCalendar | null`. Key implementation decisions: date regex uses alternation `JAN|FEB|...|DEC` as the month group (not generic `[A-Z]{3}`) to prevent false matches like "00 PUT 30" from digit sequences adjacent to "7500 PUT 30 NOV". Fixed strict TypeScript errors: `noUncheckedIndexedAccess` via `rawDates[0] ?? 0` + null guard; type extraction via `=== 'CALL'` ternary (no char indexing); `strict-boolean-expressions` via `=== undefined` checks. 33 tests GREEN, typecheck + lint clean.

## Deviations from Plan

**Auto-fixed Issues**

**1. [Rule 1 - Bug] CALL fixture debit was unbracketable**
- **Found during:** Task 1 GREEN run
- **Issue:** CALL calendar K=7600, frontT=14d, backT=28d at S=7550 — spread at lo (IV=2%) is already ≈4.35; debit=3.50 < spread_lo so bisection returns LO and re-price error was 0.85 >> 1e-4
- **Fix:** Changed fixture to deep OTM K=8500, frontT=30d, backT=60d, debit=10.0 — fully bracketable
- **Files modified:** apps/web/src/lib/iv-bisection.test.ts
- **Commit:** 9b58999

**2. [Rule 1 - Bug] Date regex false-matched "00 PUT 30" from "7500 PUT 30 NOV"**
- **Found during:** Task 2 first GREEN attempt
- **Issue:** Generic `[A-Z]{3}` date regex matched "PUT" as a month name, producing invalid dates and causing parse to return null for inputs like "BUY 5 CALENDAR SPX 7500 PUT 30 NOV 26"
- **Fix:** Anchored month group to explicit alternation `JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC`
- **Files modified:** apps/web/src/lib/tos-parser.ts
- **Commit:** 9d8a821

## Verification Results

```
# iv-bisection suite
vitest run --project web -t "iv-bisection"
  Tests  5 passed (5)

# parseTosOrder suite
vitest run --project web -t "parseTosOrder"
  Tests  33 passed (33)

# Full web project
vitest run --project web
  Tests  47 passed (47)

# Type safety
bun run typecheck   → exit 0 (clean)
bun run lint        → exit 0 (0 errors)

# Key acceptance criterion checks
grep -q '@morai/quant' apps/web/src/lib/iv-bisection.ts  → found (bsmPrice import)
grep -q 'eval\|document\.' apps/web/src/lib/tos-parser.ts  → no match (pure string)
```

## Known Stubs

None — both modules are fully implemented with no placeholder/stub values.

## Threat Flags

None. Security mitigations verified in implementation:
- T-09-06 (parser DOM write / eval): parser is pure string, no DOM import, no eval. Output goes to React JSX auto-escape.
- T-09-07 (bisection DoS): MAX_ITER=64 hard cap; IV range [0.02, 2.0] bounded.

## Self-Check: PASSED

- `apps/web/src/lib/iv-bisection.ts` — exists, imports bsmPrice from @morai/quant, no any/as/!
- `apps/web/src/lib/iv-bisection.test.ts` — exists, 5 tests GREEN
- `apps/web/src/lib/tos-parser.ts` — exists, no DOM/eval, no any/as/!
- `apps/web/src/lib/tos-parser.test.ts` — exists, 33 tests GREEN
- Commit `9b58999` (iv-bisection feat) — in git log
- Commit `bb023d7` (tos-parser RED) — in git log
- Commit `9d8a821` (tos-parser feat) — in git log
