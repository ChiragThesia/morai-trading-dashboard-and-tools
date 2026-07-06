# Roadmap: Morai — Trading Dashboard & Tools

## Milestones

- ✅ **v1.0 Backend + Data Layer** — Phases 1-9 (shipped 2026-06-25)
- ✅ **v1.1 Real-Time Schwab Streaming** — Phases 10-15 (shipped 2026-07-02) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Trade Picker & Dashboard Redesign** — Phases 16-22 (shipped 2026-07-06) — [archive](milestones/v1.2-ROADMAP.md)

Full phase details for shipped milestones live in their archives. Milestone summaries: [MILESTONES.md](MILESTONES.md).

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

<details>
<summary>✅ v1.2 Trade Picker & Dashboard Redesign (Phases 16-22) — SHIPPED 2026-07-06</summary>

- [x] Phase 16: Deploy Phase-15 Image (3/3 plans) — completed 2026-07-03
- [x] Phase 17: Overview v2 Redesign + IV Calibration Fix (4/4 plans) — completed 2026-07-03
- [x] Phase 17.1: Overview Payoff — TOS-Fidelity Graph + Interactivity (5/5 plans) — completed 2026-07-04
- [x] Phase 18: Analyzer → Picker UI Redesign (5/5 plans) — completed 2026-07-04
- [x] Phase 19: Picker Engine + Economic Events (9/9 plans) — completed 2026-07-04
- [x] Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules (11/11 plans) — completed 2026-07-05
- [x] Phase 21: Control Affordance & Button System (6/6 plans) — completed 2026-07-05
- [x] Phase 22: Journal Calendar-Lifecycle Graph (6/6 plans) — completed 2026-07-05

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

## Next Milestone

_Not yet defined. Run `/gsd-new-milestone` to scope v1.3._

Candidate theme (surfaced at v1.2 close): **reliability / ops hardening** — in-app Schwab re-auth
trigger + market-feed-down alert (no auto-refresh cron or prod refresh path exists today), and the
`snapshot-calendars` pipeline gaps that leave open-calendar journal series ~74% empty.

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.
