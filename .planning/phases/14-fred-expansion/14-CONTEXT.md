# Phase 14: FRED Expansion - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend macro data ingestion to the full series set: seven FRED series (DFF, DGS1MO,
DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) plus VVIX via the existing CBOE adapter, stored in
a new `macro_observations` table. Expose the set over `GET /api/analytics/macro` and MCP
`get_macro` (shared Zod contract), and wire the live MacroCard into the Overview screen
(replacing the "needs feed" stub). Requirements: MAC-01, MAC-02 (+ MCP-02 cross-cutting).

</domain>

<decisions>
## Implementation Decisions

### Storage
- **D-01:** New `macro_observations` table — `(series_id text, date date)` composite PK,
  `value numeric NOT NULL`, RLS enabled, following the `cot_observations` pattern
  (migration 0013). NOT widening `rate_observations`.
- **D-02:** `rate_observations` and the BSM path stay UNTOUCHED. `readRate` /
  `computeBsmGreeks` (just stabilized) keep reading `rate_observations` (date PK, rate).
  DGS3MO is double-written: existing single-row pipeline for BSM + a `macro_observations`
  row for the macro API.
- **D-03:** VVIX stored as `series_id = 'VVIX'` in the same table.

### Ingestion & Backfill
- **D-04:** First run backfills 5 years per series (~10k rows total). Inserts chunked at
  ≤2,000 rows (65,534-param limit).
- **D-05:** Self-healing incremental fetch: per series, fetch from `max(date)+1` (floor
  `today − 5y` when the series is empty). Idempotent upsert on `(series_id, date)` —
  second run same day is a no-op (MAC-01 criterion).
- **D-06:** Cron: TWO runs daily, 09:00 ET and 18:30 ET, Mon–Fri (evening run catches
  same-day VIXCLS/treasury publications; morning run catches SOFR's next-morning lag).
- **D-07:** Failure policy: best-effort + fail-loud finish. Fetch all 8 series
  independently, persist every success, then if ANY series failed, throw with the failed
  series named → pg-boss marks the job failed and `/api/status` shows lastErr. No silent
  holes (Phase 11 chain-observedAt lesson). Next run self-heals gaps via D-05.
- **D-08:** No in-handler retry/backoff. pg-boss job retryLimit (existing pattern) +
  twice-daily cron + self-healing backfill cover transient failures.
- **D-09:** Macro fetch HARD-REQUIRES `FRED_API_KEY` — fail loud when missing, no silent
  skip. (The old DGS3MO→BSM 4.5%-fallback path keeps its lenient behavior — D-02.)

### API / MCP Contract
- **D-10:** `GET /api/analytics/macro` and MCP `get_macro` share one Zod contract in
  `packages/contracts`. Response: `{ [seriesId]: Array<{ time: "YYYY-MM-DD", value: number }> }`,
  time-ordered ascending.
- **D-11:** Default window: last 90 days, all 8 series. Optional Zod-validated params:
  `days` (max 1825) and `series` (CSV filter of known series IDs). MCP `get_macro`
  accepts the same `{ days?, series? }`. Keeps MCP payloads context-light while the full
  5y stays reachable.

### Frontend
- **D-12:** MacroCard wired IN-PHASE: replace the Overview `ComingSoon` "FRED macro" stub
  with a live card — `useMacro` hook + `MacroCard` component, direct analog of Phase 13's
  `useCot` + `CotCard`.

### Operator Steps (user does these — executor must surface, not do)
- **D-13:** `FRED_API_KEY` was provided by the user in-session but is deliberately NOT
  stored in any repo file. User sets it on the Railway worker service and in local `.env`
  before UAT. Plans must treat "prod key set" as a blocking operator checklist item and
  pause/verify before the live-fetch UAT step.

### Post-Research Addendum (2026-07-01, reconciled vs 14-RESEARCH.md)
- **D-14 (units):** store values in `macro_observations` RAW as reported by the source
  (DFF 4.33 = percent, VIXCLS 18.9 = index level, VVIX 89.0 = index level). NO `/100`
  division — that convention belongs only to the legacy DGS3MO→BSM decimal-fraction path
  (untouched per D-02). Research found `/100` applied blindly would silently corrupt
  VIXCLS/VVIX.
- **D-15 (VVIX source, verified live via raw curl):**
  `https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json` — same
  `{timestamp, data: {current_price, close, prev_day_close}}` shape as the existing SPX
  chain adapter; reuse its spot-resolution fallback (`current_price ?? close ??
  prev_day_close`) and UTC-timestamp handling. Row date = trade date derived from the
  UTC timestamp.
- **Conflict resolution (planner: this is LOCKED):** 14-RESEARCH.md §recommendation
  proposes widening `rate_observations` because ROADMAP MAC-01 wording named that table.
  That wording predated this discussion and has been corrected in ROADMAP.md — the USER
  explicitly chose the new `macro_observations` table (D-01) with the widen-option
  presented and rejected. Planner must follow D-01; research's widen-table sections are
  superseded. (Side benefit: the drizzle-kit PK-widening migration risk research flagged
  is moot — no PK change on any existing table.)
- **Docs-first item:** `docs/architecture/jobs.md` says fetch-rates cron `0 7 * * 1-5`;
  actual registered cron is `0 9 * * 1-5`. Fix in the Wave-1 docs pass together with the
  new two-run cadence (D-06) and `macro_observations` schema docs.
- **BSM proxy stays DGS3MO** — expanded series availability is NOT a reason to revisit
  the risk-free-rate choice (confirmed out of scope).

### Claude's Discretion
- MacroCard content/design: tiles vs tiles+sparklines — pick what fits Overview density
  (dataviz + frontend-design skills apply). Series top billing suggestion: DFF, SOFR,
  T10Y2Y, VIXCLS, VVIX primary (matches the stub's promise); DGS1MO/DGS3MO/T10Y3M
  secondary — but final layout is Claude's call.
- Optional `source` column (`'fred' | 'cboe'`) on `macro_observations` for provenance —
  cheap, matches existing convention; include if it doesn't complicate the contract.
- `macroSeriesPoint.time` is the `YYYY-MM-DD` date string (locked in D-10; matches COT
  `asOf` + FRED native granularity).
- Error taxonomy, adapter port naming (`ForFetchingMacroSeries` style), route/handler file
  layout — follow existing hexagonal patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition
- `.planning/ROADMAP.md` §"Phase 14: FRED Expansion" — goal, success criteria (MAC-01/02)
- `.planning/REQUIREMENTS.md` — MAC-01, MAC-02, MCP-02 texts

### Direct analogs (Phase 13 COT — copy this vertical)
- `.planning/phases/13-cot-adapter/13-01-PLAN.md` … `13-06-SUMMARY.md` — migration →
  adapter → repo → job → route/MCP → contract sequence, plan shapes
- `packages/adapters/src/postgres/schema.ts` — `cot_observations` table pattern (RLS,
  composite key) to mirror for `macro_observations`

### Code this phase extends
- `packages/adapters/src/http/fred.ts` — existing FRED adapter (DGS3MO, '.' sentinel,
  key-absent fallback). Macro fetch is a NEW multi-series adapter beside it; do not
  break the old one (D-02).
- `apps/worker/src/handlers/fetch-rates.ts` + `apps/worker/src/schedule.ts` — fetch-rates
  handler + cron registration (currently `0 9 * * 1-5` ET)
- `packages/core/src/journal/application/fetchRate.ts` — existing use-case pattern
- `apps/web/src/screens/Overview.tsx` (~line 438) — "FRED macro" ComingSoon stub to replace
- `apps/web/src/hooks/useCot.ts` + `apps/web/src/components/CotCard.tsx` — FE analogs

### Architecture rules
- `docs/architecture/stack-decisions.md` — update FIRST if any stack decision changes
- `.claude/rules/architecture-boundaries.md`, `.claude/rules/tdd.md`,
  `.claude/rules/typescript.md` — non-negotiables

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cot_observations` migration/repo/route/MCP vertical (Phase 13) — the whole phase is a
  structural clone of it with N series instead of one contract.
- Existing CBOE adapter — VVIX sourcing reuses its fetch/parse machinery.
- `useCot`/`CotCard` — FE hook+card pattern for MacroCard.

### Established Patterns
- Hexagonal: port in core (`ForVerbingNoun`), adapter in `packages/adapters`, thin
  route/MCP handlers, Zod contract in `packages/contracts`, in-memory twin same PR.
- TDD red→green mandatory; Postgres repos via testcontainers; HTTP adapters via msw.
- Chunked inserts ≤2,000 rows.

### Integration Points
- `apps/worker` fetch-rates handler grows the macro fetch (same job run, additive — D-02);
  `schedule.ts` cron line changes to two daily runs (D-06).
- `apps/server` analytics routes + MCP server register macro endpoints.
- Local `bun run migrate` gotcha: validates ALL worker env (needs `SIDECAR_URL` in `.env`).

</code_context>

<specifics>
## Specific Ideas

- Response shape example (locked): `{ "DFF": [{ "time": "2026-04-02", "value": 3.83 }, …] }`.
- Card should honor the stub's promise: "Rates, curves & vol regime (DFF · SOFR · T10Y2Y ·
  VIX · VVIX). The macro backdrop."

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- `03-code-review-followups.md` — Phase 3 advisory cleanups; no FRED overlap.
- `over-engineering-cleanup.md` — general cleanup; no FRED overlap.

None otherwise — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-fred-expansion*
*Context gathered: 2026-07-01*
