# Phase 05 — Discussion Log

**Date:** 2026-06-21
*(Human reference only — not consumed by downstream agents. CONTEXT.md is canonical.)*

## Framing that shaped the phase

User clarified the journal's purpose: track every trade, why it was entered, the
enter/exit/roll rules, and **why a calendar's price moved** (which greeks / events) — to
improve the trading system/algo. Surfaced a 4-layer model; Phase 5 builds **Layer 1 (trade
ledger)** only. L2 (greeks time-series) already built; L3 (attribution) → Phase 6; L4
(strategy-rules engine) → new phase.

## Areas discussed (all 4 selected)

| Area | Decision |
|---|---|
| Fill→calendar pairing | Auto-match by leg (parse `occSymbol`) + classify OPEN/CLOSE by calendar status; aggregate partials; orphans parked (D-01..05) |
| ROLL handling | **First-class ROLL event** preserving the thesis chain — not close+open (D-03) |
| rebuild-journal scope | **Events-only** from fills; greeks stay live-captured; attribution reads both later (D-10) |
| P&L convention | Fees-in; debit+/credit−; net **and** per-leg breakdown (D-08/09) |
| Entry-thesis hook | Minimal free-text/tag field now — attach point for the future rules layer (D-07) |
| refresh-tokens alerting | Status flag + log + **proactive 7-day pre-expiry warning** (D-13/14) |

## Pushed back / kept out of scope

- L3 attribution and L4 strategy-rules engine — explicitly deferred (would balloon a 6-plan
  phase). Captured as roadmap candidates so the user's end-goal isn't lost.
- Historical-snapshot replay; email/Slack alert channel — deferred.

## Claude's discretion (handed to planner)

`calendar_events` table shape; dedupe-key shapes; orphan-review surface; pg-boss
retry/dead-letter; `trigger_job` MCP+HTTP surface; leg-match tie-breaking.
