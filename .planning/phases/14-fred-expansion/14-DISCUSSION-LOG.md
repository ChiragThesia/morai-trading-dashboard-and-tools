# Phase 14: FRED Expansion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 14-fred-expansion
**Areas discussed:** Storage shape, Backfill depth, FE card scope, Cadence & fallback, API/MCP payload shape, Partial-failure policy, FRED retry, FRED_API_KEY operator step, VVIX date semantics, MacroCard series priority

---

## Storage shape

| Option | Description | Selected |
|--------|-------------|----------|
| New macro_observations | (series_id, date) PK, rate_observations untouched, DGS3MO double-written | ✓ |
| Widen rate_observations | series_id column + composite-PK migration; touches BSM read path | |

**User's choice:** New macro_observations (Recommended)

---

## Backfill depth

| Option | Description | Selected |
|--------|-------------|----------|
| 5 years | ~10k rows, covers hiking/cutting cycle context | ✓ |
| 1 year | ~2k rows, lean | |
| Full history | ~100k rows, mostly dead weight | |
| None — accumulate | Charts empty for months | |

**User's choice:** 5 years (Recommended)

---

## FE card scope

| Option | Description | Selected |
|--------|-------------|----------|
| Wire in-phase | useMacro + MacroCard, CotCard analog | ✓ |
| Backend only | Stub stays; follow-up commit later | |

**User's choice:** Yes, in-phase (Recommended)
**Card content follow-up:** tiles vs tiles+sparklines → "You decide" (Claude discretion).

---

## Cadence & fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 09:00 ET daily | One run, all prior-day data available | |
| Two runs 09:00 + 18:30 ET | Evening catches same-day VIXCLS/treasuries | ✓ |

**User's choice:** Two runs (09:00 + 18:30 ET)

**BSM path sub-question:** untouched vs macro-first refactor → **Untouched** (fetch-rates
keeps writing rate_observations with 4.5% fallback; macro ingestion additive).

---

## API/MCP payload shape

| Option | Description | Selected |
|--------|-------------|----------|
| 90d default + params | days (cap 1825) + series filter; MCP-light | ✓ |
| Always full history | ~10k points every call | |
| Latest-only default | History behind params | |

**User's choice:** 90d default + params (Recommended)

---

## Partial-failure policy

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort + fail-loud finish | Persist successes, throw naming failed series | ✓ |
| All-or-nothing | Any failure aborts everything | |
| Silent best-effort | Warn-log only; hides feed breakage | |

**User's choice:** Best-effort + fail-loud finish (Recommended)

---

## FRED retry

| Option | Description | Selected |
|--------|-------------|----------|
| pg-boss retry only | retryLimit + twice-daily cron + self-heal | ✓ |
| In-handler backoff | Per-series retries inside the run | |

**User's choice:** pg-boss retry only (Recommended)

---

## FRED_API_KEY operator step

Options offered: Claude sets via railway CLI / user sets manually / lenient without key.
**User's response:** provided the real API key in-session (free-text).
**Resolution:** writing the key to local `.env` was declined at the permission prompt —
key is deliberately kept OUT of all repo files. User sets it on Railway worker + local
`.env` before UAT (operator checklist item, D-13). Macro fetch hard-requires the key (D-09).

---

## VVIX date semantics

**User's choice:** You decide at research — researcher confirms CBOE VVIX close-date field;
store CBOE trade date as the row date (UTC-parse internally).

---

## MacroCard series priority

**User's choice:** You decide — Claude discretion; suggestion recorded (DFF, SOFR, T10Y2Y,
VIXCLS, VVIX primary).

---

## Claude's Discretion

- MacroCard content/design + series billing
- VVIX date semantics (lock after research)
- Error taxonomy, port naming, file layout

## Deferred Ideas

- None. Reviewed-not-folded todos: 03-code-review-followups.md, over-engineering-cleanup.md (no FRED overlap).
