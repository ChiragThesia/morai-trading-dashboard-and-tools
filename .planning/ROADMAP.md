# Roadmap: Morai — Trading Dashboard & Tools

## Milestones

- ✅ **v1.0 Backend + Data Layer** — Phases 1-9 (shipped 2026-06-25)
- ✅ **v1.1 Real-Time Schwab Streaming** — Phases 10-15 (shipped 2026-07-02) — [archive](milestones/v1.1-ROADMAP.md)
- 📋 **v1.2** — not yet defined (`/gsd-new-milestone`)

Full phase details for both shipped milestones: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
(complete pre-archive snapshot). Milestone summaries: [MILESTONES.md](MILESTONES.md).

## Phases

<details>
<summary>✅ v1.0 Backend + Data Layer (Phases 1-9) — SHIPPED 2026-06-25</summary>

- [x] Phase 1: Walking Skeleton (6/6 plans) — monorepo + hexagon + DB + deployed status endpoint
- [x] Phase 2: Market Data & BSM Engine (12/12 plans) — completed 2026-06-12
- [x] Phase 3: Calendar Journal MVP (7/7 plans) — completed 2026-06-14
- [x] Phase 4: Schwab Auth & Brokerage (6/6 plans) — completed 2026-06-20
- [x] Phase 5: Jobs, Fill Rebuild & Integrity (15/16 plans) — completed 2026-06-22
- [x] Phase 6: Derived Analytics (8/8 plans) — completed 2026-06-22
- [x] Phase 7: Trade History (2/2 plans) — completed 2026-06-22
- [x] Phase 8: Web Dashboard Backend (8/8 plans) — completed 2026-06-24
- [x] Phase 9: Web Dashboard Frontend (10/10 plans) — completed 2026-06-25

</details>

<details>
<summary>✅ v1.1 Real-Time Schwab Streaming (Phases 10-15) — SHIPPED 2026-07-02</summary>

- [x] Phase 10: Stack Decisions Doc Update (1/1 plans) — completed 2026-06-25
- [x] Phase 11: Sidecar Scaffold + Auth Migration (7/7 plans) — completed 2026-06-25
- [x] Phase 12: Streaming + TS Fan-Out (7/7 plans) — completed 2026-06-29
- [x] Phase 13: COT Adapter (6/6 plans) — completed 2026-06-29
- [x] Phase 14: FRED Expansion (7/7 plans) — completed 2026-07-02
- [x] Phase 15: Re-Auth Smoothing (5/5 plans) — completed 2026-07-02

</details>

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1. Walking Skeleton | v1.0 | 6/6 | Complete | 2026-06-11 |
| 2. Market Data & BSM Engine | v1.0 | 12/12 | Complete | 2026-06-12 |
| 3. Calendar Journal (MVP) | v1.0 | 7/7 | Complete | 2026-06-14 |
| 4. Schwab Auth & Brokerage | v1.0 | 6/6 | Complete | 2026-06-20 |
| 5. Jobs, Fill Rebuild & Integrity | v1.0 | 15/16 | Complete | 2026-06-22 |
| 6. Derived Analytics | v1.0 | 8/8 | Complete | 2026-06-22 |
| 7. Trade History | v1.0 | 2/2 | Complete | 2026-06-22 |
| 8. Web Dashboard Backend | v1.0 | 8/8 | Complete | 2026-06-24 |
| 9. Web Dashboard Frontend | v1.0 | 10/10 | Complete | 2026-06-25 |
| 10. Stack Decisions Doc Update | v1.1 | 1/1 | Complete | 2026-06-25 |
| 11. Sidecar Scaffold + Auth Migration | v1.1 | 7/7 | Complete | 2026-06-25 |
| 12. Streaming + TS Fan-Out | v1.1 | 7/7 | Complete | 2026-06-29 |
| 13. COT Adapter | v1.1 | 6/6 | Complete | 2026-06-29 |
| 14. FRED Expansion | v1.1 | 7/7 | Complete | 2026-07-02 |
| 15. Re-Auth Smoothing | v1.1 | 5/5 | Complete | 2026-07-02 |

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.

### Strategy rules / logical gates engine (the "why I acted" layer — L4)

**Surfaced during Phase 5 discuss (2026-06-21).** User's stated end-goal: record the
enter/exit/roll RULES per trade + which rule fired, to improve the system/algo. This is a
NEW capability beyond Phase 5's trade ledger (JRNL-01 only pairs fills into events). The
Phase 5 D-07 "entry-thesis" field is the minimal attach point. Pairs with **L3 attribution**
(decompose a calendar's move into θ/vega/δ + event contributions). Candidate for its own
phase after v1.1. The 4-layer model (ledger → greeks time-series → attribution → rules) is
documented in `.planning/phases/05-jobs-fill-rebuild-integrity/05-CONTEXT.md`.

### Event-triggered supplemental journal snapshot

**Surfaced in SUMMARY.md.** On large underlying moves (captured via stream), trigger a
supplemental out-of-cycle snapshot. P2 — depends on the live stream (Phase 12). Candidate
for a v1.2 addendum after streaming is stable in production.
