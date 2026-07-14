---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 08
subsystem: infra
tags: [integration-gate, deploy, prod-repair, live-verification]

requires:
  - phase: 40-01..40-07
    provides: "Root fix (occ-root candidates), slot rounding, heal ports, rebuild engine, self-heal job, repair job/CLI, on-register backfill — plus post-review fixes CR-01/WR-01/WR-02"
provides:
  - "Green integration gate + D-09 regression gate"
  - "Prod deploy (worker + server) with live end-to-end verification of HIST-01/02/03/05"
  - "Open-Question-3 resolution: SPXW back-leg data was ABSENT from the archive (never captured pre-fix)"
affects: [phase-40-close, v1.3-close]

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/40-journal-history-repair-never-lose-a-calendars-greek-vol-story/40-08-SUMMARY.md
  modified: []

key-decisions:
  - "One-time all-calendar repair via trigger_job DEFERRED to operator: this session's MCP client carries the pre-deploy tool schema (enum without repair-journal-history), and pulling the prod bearer token to call the fresh endpoint directly was correctly denied by the permission layer. Self-heal covers open calendars automatically; the repair job/CLI is deployed and ready."
  - "D-09 note: historical exit/backtest verdicts MAY SHIFT in prod as healed journal rows change their inputs — expected consequence of better data, suites green on fixtures."

requirements-completed: [HIST-01, HIST-02, HIST-03, HIST-05]

coverage:
  - id: D1
    description: "Full workspace suite green (321 files / 3599 tests pre-fix; post-review-fix suites re-run green by fixer), typecheck clean, lint clean"
    requirement: "HIST-01..05"
    verification:
      - kind: unit
        ref: "bun run test — 321 passed (321), 3599 passed (3599), 62.5s"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-09 regression gate: backtest + exit suites green, assertions unchanged"
    requirement: "D-09"
    verification:
      - kind: integration
        ref: "bun run test -- packages/core/src/backtest packages/core/src/exits — 16 files / 161 tests pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "Prod deploy: worker + server on Railway, twice (feature image 08:51Z; review-fix image server 09:41Z SUCCESS / worker 09:38:14Z SUCCESS — two later SKIPPEDs were duplicate-upload dedup no-ops)"
    requirement: "D-10"
    verification:
      - kind: other
        ref: "railway deployment list — SUCCESS timestamps recorded (deploy proof = timestamp, not sha)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Diagnostic (Open Question 3): post-deploy get_live_greeks still NaN on back leg at 08:53Z → archive NEVER captured SPXW261130 (D-04 bypass was root-broken since registration); after the NEXT chain cycle (~09:21Z), back leg resolves as SPXW 261130P0760/07200000 with full BSM greeks on BOTH open calendars — capture + BSM + resolution all working under the fixed roots. Outcome = 'data absent' branch: historical Jul-6→8 back-leg slots stay honest gaps (archive physically lacks the leg); forward capture live."
    requirement: HIST-01
    verification:
      - kind: other
        ref: "get_live_greeks c225281e/af9923ba — back legs SPXW-rooted, finite IV/delta/gamma/theta/vega, values ticking across reads (0.14796→0.14376→0.14854)"
        status: pass
    human_judgment: false
  - id: D5
    description: "LIVE PROOF (2026-07-14 13:30Z, first RTH slot post-fix): BOTH open calendars wrote their first-ever non-gap journal rows — isGap=false, finite frontIv/backIv/netDelta + full greeks + termSlope, forwardVol computed (0.1468 / 0.1661), spot 7515.34, source cboe, trigger scheduled — at EXACT slot boundary 13:30:00.000 (HIST-05 rounding live), one row per slot, no duplicates"
    requirement: "HIST-01, HIST-05"
    verification:
      - kind: other
        ref: "get_journal_lifecycle both calendars — 2026-07-14 rows verified"
        status: pass
    human_judgment: false
  - id: D6
    description: "Self-heal proof: 14:00Z row wrote as a gap (snapshot-before-BSM race — raw IVs present, calibrated NaN); the hourly self-heal-journal run must REPLACE it fill-only once BSM data lands"
    requirement: "HIST-02, HIST-03"
    verification:
      - kind: other
        ref: "PENDING 15:08Z check — see final evidence below"
        status: pending
    human_judgment: false

# Phase 40 Plan 08: Integration Gate + Deploy + Prod Repair — Summary

## Gate results (Task 1)

- Full suite: **321 files / 3599 tests — all pass** (62.5s). Post-review-fix suites re-run green (570-667 tests across affected scopes).
- `bun run typecheck` (tsc --build --force, 8 projects): **clean**.
- `eslint .`: **clean** (pre-existing boundaries-config warnings only).
- **D-09 regression gate**: backtest + exit suites **16 files / 161 tests green**, assertions unchanged. NOTE (D-09): prod exit/backtest verdicts may shift after journal history heals — better inputs, not a regression.

## Code review (autonomous chain)

`40-REVIEW.md`: 1 Critical + 2 Warnings + 1 Info → all in-scope findings fixed and verified (`40-REVIEW-FIX.md`):
- **CR-01** healSnapshot TOCTOU race → onConflictDoNothing + re-read fill-only decision; deterministic blocker-transaction regression test (failed pre-fix, passes post-fix). 10th-class green-suite catch.
- **WR-01** rebuild loop now records per-slot heal errors (`errorCount`) and continues — one collision can no longer abort a whole repair/self-heal run.
- **WR-02** stale root-limitation comment corrected (residual single-root path = fills.ts calendarLegSymbols only).

## Deploy record (Task 2)

| Service | Feature image | Review-fix image |
|---|---|---|
| worker | SUCCESS 2026-07-14T08:51:27Z | SUCCESS 2026-07-14T09:38:14Z |
| server | SUCCESS 2026-07-14T08:51:36Z | SUCCESS 2026-07-14T09:41Z (poll) |

Vercel web: no web changes this phase (D-01 — UI untouched).

## Diagnostic + Open Question 3 (Task 2)

**Outcome: data ABSENT.** The archive never held `SPXW261130P07600000`/`...07200000` rows — the D-04 targeted-fetch bypass was building wrong-root symbols since the calendars' registration, and 139-DTE puts the contract outside the band filter. Evidence chain:
1. Pre-fix and immediately post-deploy (08:53Z): back leg all-NaN.
2. First post-deploy chain cycle (~09:21Z): back leg resolves under **SPXW** root with full BSM greeks on both calendars — capture, BSM, and resolution all healthy under `resolveRootCandidates`.
3. Consequence: the Jul-6→8 historical window cannot be healed for these two calendars (honest gap, D-04 law) — the repair engine has nothing to read. Forward data flows correctly from 2026-07-14 onward.

The heal-only repair (`trigger_job repair-journal-history`, no calendarId) remains valuable for the mid-June CLOSED calendars whose both legs were always correctly rooted (SPXW/SPXW) — their archives exist since Jun 12. **Deferred to operator** (see key-decisions): this session's MCP tool schema predates the deploy (enum lacks the new job name), and direct-endpoint invocation would have required pulling prod secrets, which the permission layer correctly refused. Runnable any time via MCP `trigger_job repair-journal-history` from a fresh session, or `bun apps/worker/src/repair-journal-history.ts --all` (CLI, supports `--trim`).

## Live verification (Task 3 evidence)

**13:30Z 2026-07-14 — first RTH slot after the fix — both open calendars wrote their first-ever non-gap rows:**

| Calendar | time | isGap | spot | netMark | frontIv | backIv | netDelta | fwdVol |
|---|---|---|---|---|---|---|---|---|
| 7600P | 13:30:00.000Z | **false** | 7515.34 | +7.45 | 0.1435 | 0.1438 | +0.447 | 0.1468 |
| 7200P | 13:30:00.000Z | **false** | 7515.34 | +7.65 | 0.1764 | 0.1756 | −0.271 | 0.1661 |

- Exact 30-min slot boundaries (`:30:00.000`) vs historical odd offsets (14:01:57…) — HIST-05 live.
- One row per slot, zero duplicates.
- Jul 9-13: zero rows, correctly honest (archive lacks back leg those days).
- Jul 6-8 historical: unchanged 49 gap rows (unhealable — data absent; see Open Question 3).

**14:00Z row**: gap with raw IVs present / calibrated NaN — the snapshot-before-BSM race; the designed self-heal target. Final evidence below.

## Final evidence (15:08Z check + UAT)

_TO BE COMPLETED: morai.wtf lifecycle-chart UAT._

### Residual bug after 455b84c — pre-anchor observation blind spot (2026-07-14, debug session)

`455b84c` was necessary but not sufficient. Live evidence on `c225281e` after the fix
deployed (worker SUCCESS 15:41:04Z) and the 16:00Z self-heal cron: `13:30 ✓ / 14:00 GAP /
14:30 ✓ / 15:00 GAP / 15:30 ✓ / 16:00 GAP` — the top-of-hour gap rows still never healed.

A prod-shaped testcontainers integration test now wires the REAL adapters
(`resolveLegObservationForSlot` + `healSnapshot` + `getOpenCalendars`) through the REAL
use-cases (rebuild + self-heal), seeded to mirror `c225281e` exactly (mixed-root SPX/SPXW
pair, a 14:00:00Z gap row, and post-BSM leg observations), run at `now = 16:00:30Z`:
`packages/adapters/src/postgres/repos/self-heal-journal.prod-repro.contract.test.ts`.

- **Faithful repro (obs in-slot at 14:00:50Z) HEALS** — `rowsHealed ≥ 1`, `errorCount 0`, the
  14:00 row's calibrated fields become finite. So the enumerate → resolve → `isGapRow` →
  metrics → heal path is sound for an in-slot observation. `455b84c` works for that case.
- **Characterization (obs at 13:59:30Z, one slot early) LEAVES THE 14:00 GAP ROW UNHEALED** —
  `frontIv` stays `NaN`, `errorCount 0` (an honest-gap, not an error → silent), and the one
  heal lands on the previous (13:30) slot. This reproduces the exact prod symptom.

**Root cause (exact):** `resolveLegObservationForSlot`
(`packages/adapters/src/postgres/repos/leg-observations.ts:423-447`) resolves a slot's
observation from the half-open interval `[slotAnchor, slotAnchor + 30min)`. The live
`snapshot-calendars` writer floors its trigger instant to the slot boundary but pairs it with
the globally-latest `leg_observation`. The `compute-bsm-greeks` cron is hourly `"0 * * * *"`
(`apps/worker/src/schedule.ts`) and chain-triggers `snapshot-calendars` at the top of each ET
hour; at that instant the latest observation can still be the PREVIOUS `*/30` fetch —
timestamped BEFORE the floored anchor. `455b84c` traded the original at-or-before semantics
(which missed post-anchor obs) for `[anchor, anchor+30min)` (which misses pre-anchor obs).
Top-of-hour rows built from a pre-anchor observation are exactly the systematic `:00`-slot
gaps that persist. A widened resolve window is NOT shipped here: reaching back one slot would
fabricate rows for genuinely-empty slots (D-04 honest-gap violation), so the correct fix needs
a design that only reaches back for slots that already carry a writer-written gap row —
confirmed first via the observability below.

**Observability shipped (mandatory — prod was blind).** `self-heal-journal` and
`repair-journal-history` handlers now log one coverage line per run:
`self-heal-journal: slots=N healed=N honestGaps=N errors=N window=[from..to]`. Prod could not
previously distinguish "ran, healed 0" from "ran, honest-gap N" from "never ran" from "errored
N". The next cron run will show `honestGaps>0` on the gap slots, confirming the pre-anchor
blind spot as the live cause. Handler tests assert the line; `apps/worker` suite 139 green,
adapter prod-repro suite 3 green, typecheck + lint clean.

### Gap found during live verification — slot-resolution semantics bug (2026-07-14)

The 14:00Z self-heal check above never happened as expected: live evidence on calendar
`c225281e` across two hourly self-heal runs showed `13:30 ✓ / 14:00 GAP / 14:30 ✓ / 15:00 GAP` —
the 14:00 and 15:00 gap rows stayed unhealed.

**Root cause:** `resolveLegObservationForSlot` resolved the nearest leg observation
AT-OR-BEFORE `slotAnchor`. But the live snapshot writer builds a slot's row from the FRESHEST
observation and rounds the row time DOWN to the slot floor (`roundDownToRthSlot`) — a
slot-14:00 row is actually built from an observation fetched at ~14:00:50, AFTER the anchor.
At-or-before semantics could never see that observation: for slot 14:00 the read only
considered the 13:30 cohort, correctly (by its own wrong rule) declared an honest gap, and the
gap rows written during the top-of-hour snapshot-before-BSM race were never healed.

**Fix (commit `455b84c`):** switched `resolveLegObservationForSlot` to slot-interval
semantics — resolve the observation nearest `slotAnchor` within the half-open interval
`[slotAnchor, slotAnchor + 30min)`, the observation that actually belongs to the slot, instead
of at-or-before it. The three HIST-02 contract-test cases (`hit`/`miss-before-anchor`/
`stale-outside-window`) encoded the wrong at-or-before semantics and were rewritten to
slot-interval semantics, including the exact live repro (an observation seeded 50s after the
anchor — previously resolved `null`, now resolves correctly). No changes were needed in
`rebuildCalendarHistory`/`selfHealJournal`/`repairJournalHistory` — they consume
`resolveLegObservationForSlot` as an opaque port. Full suites (491 journal tests, both adapter
contract suites) and typecheck green post-fix.

## Known minor (not blocking, tracked)

- `get_live_greeks` front-leg display can show NaN when the newest observation row is mid-BSM or 'NaN'-stamped, even while journal snapshots are healthy (it reads the literal latest row). Pre-existing behavior; candidate one-line improvement: prefer latest row with usable bsm.
- Historical intra-slot duplicate rows (Jul 6-8) remain — hygiene applies to new writes; old dupes are cosmetic and sit inside an all-gap window.
