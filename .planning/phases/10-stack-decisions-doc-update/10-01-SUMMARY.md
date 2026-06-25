---
phase: 10-stack-decisions-doc-update
plan: "01"
subsystem: docs/architecture
tags: [docs, adr, schwab, sidecar, streaming, auth]
status: complete
requirements: [DOC-01]

dependency_graph:
  requires: []
  provides: [DOC-01]
  affects:
    - docs/architecture/stack-decisions.md
    - docs/architecture/deployment.md
    - docs/architecture/jobs.md

tech_stack:
  added: []
  patterns:
    - ADR supersede pattern (notice + body preserved)
    - ADR lift pattern (header + body replaced with present-tense lifted content)
    - Cross-reference reconciliation (atomic with decision record update)

key_files:
  modified:
    - docs/architecture/stack-decisions.md
    - docs/architecture/deployment.md
    - docs/architecture/jobs.md

decisions:
  - D16 superseded by D22: TS OAuth client retired; dual-refresher race + streamer-session ownership forced single-process auth ownership
  - D17 lifted (v1.1): streaming scoped to LEVELONE_OPTION (position legs) + ACCT_ACTIVITY; full-chain impossible at ~500-symbol cap
  - D22 added: Python schwab-py sidecar as third Railway service; FastAPI + schwab-py v1.5.1; client_from_access_functions token callbacks; Railway private network

metrics:
  duration: "~3 minutes"
  completed: "2026-06-25"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 10 Plan 01: Stack Decisions Doc Update Summary

**One-liner:** D16 superseded by D22 (dual-refresher race + session ownership), D17 lifted to legs-only streaming, D22 added as Python schwab-py sidecar via FastAPI with `client_from_access_functions` token callbacks and Railway private-net isolation.

## What Was Built

This plan executed the docs-before-code gate for milestone v1.1. Three architectural changes are now recorded in `docs/architecture/stack-decisions.md`:

1. **D16 superseded** — the vendored TS OAuth client is retired. A supersede notice names the two forcing factors: the dual-refresher rotating-token race (Schwab invalidates old refresh tokens on each refresh; two refreshers cause `invalid_grant` within one 30-min cycle) and streamer-session ownership (one process must own both the token lifecycle and the single allowed websocket session).

2. **D17 lifted** — streaming is no longer deferred. The section header and body are rewritten to present tense, scoped to LEVELONE_OPTION for open position legs plus ACCT_ACTIVITY for fill events. The ~500-symbol cap is noted; full SPX chain streaming stays impossible and GEX/journal stay REST jobs.

3. **D22 added** — a new table row and `## D22` section document the Python schwab-py sidecar as the third Railway service: FastAPI + uvicorn + sse-starlette, schwab-py v1.5.1, `client_from_access_functions` with `token_read`/`token_write` callbacks, no schema change, Railway private-network isolation [ASSUMED at Phase 11 infra setup].

Three stale cross-references were reconciled atomically in the same commit:
- `deployment.md` line 53: "A future Python sidecar (schwab-py, D17)" → "The schwab-py sidecar (D22)"
- `deployment.md` line 57: "stack-decisions.md D16" → "stack-decisions.md D22"
- `jobs.md` line 38: "stack-decisions.md D16" → "stack-decisions.md D22"

## Task Breakdown

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Supersede D16, lift D17, add D22, reconcile 3 cross-refs | e992c63 | stack-decisions.md, deployment.md, jobs.md |
| 2 | Full consistency gate (10-VALIDATION.md greps + prose read) | (no edits — verification only) | — |

## Deviations from Plan

None. The plan executed exactly as written.

The VALIDATION.md draft used `### D22` (level-3 header) in its grep patterns. Per the plan's `<header_convention_note>`, the live doc uses level-2 headers (`## D22`) — this was noted in the plan and the implementation correctly uses `## D22`. The grep checks were adapted to the live convention.

## Verification Results

All 12 acceptance criteria greps passed:

| Check | Result |
|-------|--------|
| D16 superseded | 2 matches (table row + section notice) |
| D16 body preserved (Token storage) | 1 match |
| D17 lifted section header | 1 match |
| D17 lifted table | 1 match |
| D17 not deferred | 0 matches (PASS) |
| 500-symbol cap noted | 2 matches |
| D22 section exists | 1 match |
| D22 covers FastAPI | 2 matches |
| D22 covers client_from_access_functions | 1 match |
| D22 covers schwab-py v1.5.1 | 1 match |
| deployment.md future phrase gone | 0 matches (PASS) |
| Cross-refs reconciled | 0 stale D16/D17 matches (PASS) |
| deployment.md cites D22 | 2 matches |
| jobs.md cites D22 | 1 match |
| No code created | apps/sidecar absent (PASS) |
| TOPIC-MAP clean | 0 matches (PASS) |

Manual prose read confirmed: D16 supersede notice is present tense with dual-refresher race + streamer-session ownership named plainly. D17 is legs-only, 500-cap noted, no "deferred" framing. D22 covers all 8 required points in active present tense.

## Known Stubs

None. This is a docs-only plan; all decisions reference real research facts from `.planning/research/SUMMARY.md` and `.planning/research/STACK.md`.

## Threat Flags

None. Documentation-only change. No attack surface introduced.

## Self-Check: PASSED

- [x] `docs/architecture/stack-decisions.md` exists and contains D22 section
- [x] `docs/architecture/deployment.md` contains "D22" cross-reference
- [x] `docs/architecture/jobs.md` contains "D22" cross-reference
- [x] Commit e992c63 exists
- [x] No code files created; `apps/sidecar/` absent
- [x] `docs/TOPIC-MAP.md` unchanged
