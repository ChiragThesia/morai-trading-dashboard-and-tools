---
phase: 10
slug: stack-decisions-doc-update
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-25
---

# Phase 10 — Validation Strategy

> Per-phase validation contract. This is a **docs-only** phase (DOC-01): no source code, no
> test framework. "Validation" here = grep-based consistency assertions over the decision log
> and its cross-references. All checks are automatable from the shell.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — docs-only phase; validation is `rg`/`grep` assertions |
| **Config file** | none |
| **Quick run command** | `rg -n "D22" docs/architecture/stack-decisions.md` |
| **Full suite command** | the consistency checks in the Per-Task Verification Map below |
| **Estimated runtime** | <2 seconds |

---

## Sampling Rate

- **After the edit task:** run the consistency greps below.
- **Before sign-off:** all greps return the expected result (no stale refs; D22 present).
- **Max feedback latency:** <2 seconds.

---

## Per-Task Verification Map (doc-consistency checks)

| Check | Requirement | Assertion | Command |
|-------|-------------|-----------|---------|
| D16 superseded | DOC-01 | D16 entry carries a "Superseded by D22" notice | `rg -n "Superseded by D22" docs/architecture/stack-decisions.md` |
| D17 lifted | DOC-01 | D17 entry flipped to "Lifted (v1.1)", legs-only + 500-symbol cap noted | `rg -n "Lifted \(v1.1\)" docs/architecture/stack-decisions.md` |
| D22 added | DOC-01 | New D22 sidecar decision exists (FastAPI + schwab-py, broker_tokens callback, private-net) | `rg -n "^### D22" docs/architecture/stack-decisions.md` |
| No stale D17 streaming-deferred | DOC-01 | deployment.md no longer calls the sidecar "a future Python sidecar (… D17)" | `rg -n "future Python sidecar" docs/architecture/deployment.md` returns nothing |
| Cross-refs updated | DOC-01 | deployment.md:53/57 + jobs.md:38 reference D22, not stale D16/D17 | `rg -n "D16\)|D17\)" docs/architecture/deployment.md docs/architecture/jobs.md` returns nothing |
| Sequential IDs | DOC-01 | D22 is the highest decision ID (no gap/dupe after D21) | `rg -n "^### D2[12]" docs/architecture/stack-decisions.md` |

*Status: all ⬜ pending until the edit lands, then ✅ when each grep matches expectation.*

---

## Wave 0 Requirements

Existing docs infrastructure covers all phase requirements — no test scaffolding needed (docs-only).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hemingway prose quality + decision rationale reads true | DOC-01 | Prose quality is not grep-checkable | Read the D16/D17/D22 entries; confirm rationale (dual-refresher race, streamer ownership, legs-only) is stated plainly |

---

## Validation Sign-Off

- [x] All checks are automatable greps or a single manual prose read
- [x] No stale-reference checks omitted (deployment.md + jobs.md covered)
- [x] D-ID sequence check included
- [x] No watch-mode flags (no framework)
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` — validation fully defined for a docs phase

**Approval:** pending
