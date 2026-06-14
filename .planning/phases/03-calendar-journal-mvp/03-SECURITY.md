---
phase: "03-calendar-journal-mvp"
audited_at: "2026-06-14"
asvs_level: 1
threats_total: 22
threats_closed: 22
threats_open: 0
block_on: high
result: SECURED
---

# Security Audit — Phase 03: Calendar Journal MVP

## Summary

All 22 threats verified. 19 mitigations confirmed present in implementation code. 3
accepted risks documented below. No open threats. No unregistered threat flags from
SUMMARY.md files.

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-03-01 | Tampering | mitigate | CLOSED | `optionType: "C" \| "P"` literal union in `ports.ts:27`; `z.enum(["C","P"])` in `calendar.ts:9` |
| T-03-02 | DoS | mitigate | CLOSED | `0002_watery_molecule_man.sql:1` — bare `ADD COLUMN ... NOT NULL`; `migrate.ts:21` — Drizzle idempotent ledger; SUMMARY.md confirms prod calendars empty before apply |
| T-03-03 | Tampering | mitigate | CLOSED | SUMMARY.md task-2 checkpoint: Railway worker env binding confirmed correct DATABASE_URL; human ran `railway run --service worker bun run migrate`, output `migrate: all migrations applied` |
| T-03-04 | Tampering | mitigate | CLOSED | `registerCalendarRequest` Zod: `optionType: z.enum(["C","P"])`, `strike: z.number().int().positive()`, `frontExpiry/backExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` — `calendar.ts:6-16`; `registerCalendar` Drizzle parameterized insert — `calendars.ts:117-144` |
| T-03-05 | Tampering | mitigate | CLOSED | `closeCalendar` uses `eq(calendars.id, id)` parameterized; non-UUID caught by Postgres exception → maps to `not-found` err — `calendars.ts:200-267`; routes map `not-found` → 404 — `calendar.routes.ts:103-104` |
| T-03-06 | Info Disclosure | mitigate | CLOSED | All error branches in `calendar.routes.ts` return flat `{error:"..."}` strings (400, 404, 409, 500) at lines 56, 58, 104, 106, 108 — no stack traces or DB messages returned |
| T-03-07 | EoP | accept | CLOSED | Accepted risk: single-user v1, no multi-tenant ownership model. No auth/authz at calendar level. Documented below. |
| T-03-08 | Tampering | mitigate | CLOSED | `isNyseHoliday` pure DST-correct gate present in `nyse-holidays.ts:50-68`; called in `fetch-cboe-chain.ts:44`, `compute-bsm-greeks.ts:42`, `snapshot-calendars.ts:31` — holiday prevents all three write paths |
| T-03-09 | DoS | accept | CLOSED | Accepted risk: `NYSE_HOLIDAYS` is a static `Set<string>` of 18 entries (`nyse-holidays.ts:20-41`). Fixed at compile time; no runtime input. |
| T-03-10 | Tampering | mitigate | CLOSED | `resolveLegSnapshot` uses `ORDER BY time DESC LIMIT 1` + exact `(underlying, strike, expiry, contractType)` attr match — `calendar-snapshots.ts:131-168`; `persistSnapshot` uses `.onConflictDoNothing()` on composite PK `(time, calendar_id)` — `calendar-snapshots.ts:71` |
| T-03-11 | DoS | mitigate | CLOSED | `compute-bsm-greeks.ts:56-58` — `boss.send("snapshot-calendars", {}, { singletonKey: "triggered-by-compute" })`; composite PK on `calendar_snapshots` (`0000_careless_azazel.sql:26`) absorbs duplicate inserts via `.onConflictDoNothing()` |
| T-03-11b | Tampering | mitigate | CLOSED | `compute-bsm-greeks.ts:41-45` — `isNyseHoliday` gate fires BEFORE `computeBsmGreeksUseCase()` call AND before `boss.send`; holiday run exits before chain-trigger |
| T-03-12 | Info Disclosure | mitigate | CLOSED | `snapshot-calendars.ts:38-39` — `result.error.message` thrown as `new Error(...)` to pg-boss; no HTTP client surface. Error reaches pg-boss job failure log only, not any HTTP response. |
| T-03-13 | Tampering | mitigate | CLOSED | `export const NAN_STAMP = "NaN"` — `snapshotCalendars.ts:36`; all unsolvable columns set to `NAN_STAMP`, never `null` — `snapshotCalendars.ts:68-99`; `NAN_STAMP` strings insert cleanly into Postgres `numeric NOT NULL` columns |
| T-03-14 | Info Disclosure | mitigate | CLOSED | `journal.routes.ts:31-34` — `result.value === null` → `c.json({ error: "not found" }, 404)`; parameterized `eq(calendars.id, calendarId)` in `calendar-snapshots.ts:89-92` |
| T-03-15 | Tampering | mitigate | CLOSED | `readJournal` uses `eq(calendars.id, calendarId)` then `eq(calendarSnapshots.calendarId, calendarId)` — `calendar-snapshots.ts:89-100`; non-UUID id matches no row → `ok(null)` → 404 |
| T-03-16 | Info Disclosure | mitigate | CLOSED | `journal.routes.ts:27-28` — internal errors return `c.json({ error: "internal" }, 500)`; unknown calendarId returns `{ error: "not found" }` — no stack/DB message in either branch |
| T-03-17 | EoP | accept | CLOSED | Accepted risk: single-user v1, no per-calendar authz. No ownership model in this phase. Documented below. |
| T-03-18 | Spoofing | mitigate | CLOSED | `server.ts:49` — `router.use("/mcp/*", bearerAuth(config.MCP_BEARER_TOKEN))`; `bearer.ts:14` — exact string comparison `auth !== \`Bearer ${token}\`` → 401 when absent or wrong |
| T-03-19 | Tampering | mitigate | CLOSED | `tools.ts:123` — `z.object({ calendarId: z.string().uuid() }).safeParse(args)` in `registerGetJournalTool`; `tools.ts:181` — same `safeParse` in `registerGetLiveGreeksTool`; failure returns `{ error: "invalid calendarId" }` content, never throws |
| T-03-20 | Info Disclosure | mitigate | CLOSED | `registerGetTermStructureTool` (`tools.ts:218`) and `registerGetSkewTool` (`tools.ts:246`) — constant `{ observations: [] }` payload, no use-case call, no DB access; `registerGetJournalTool` unknown id → `{ error: "not found" }` flat text — `tools.ts:140-145` |
| T-03-21 | EoP | mitigate | CLOSED | `trigger_job` absent from all `server.registerTool(...)` calls; 6 tools registered: `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew` — `tools.ts` (grep confirms zero `trigger_job` string occurrences outside comment) |
| T-03-SC | Tampering | accept | CLOSED | Accepted risk: no npm/pip/cargo installs in this phase. Documented below. |

---

## Accepted Risks

### T-03-07 — Elevation of Privilege: closing another user's calendar

**Rationale:** Phase 3 is a single-user deployment. There is no multi-tenant ownership
model, no user identity attached to calendar rows, and no per-resource authz. The route
`POST /api/calendars/:id/close` is bearer-gated at the API level (T-01-11 from Phase 1).
Any authenticated caller can close any calendar, which is the intended behavior for v1.
Re-evaluate before introducing multi-user support.

### T-03-17 — Elevation of Privilege: reading another user's journal

**Rationale:** Same as T-03-07. Single-user v1. `GET /api/journal/:calendarId` is
bearer-gated. No per-calendar ownership in this phase. Re-evaluate before multi-user.

### T-03-09 — DoS: unbounded holiday-list growth

**Rationale:** `NYSE_HOLIDAYS` in `nyse-holidays.ts` is a static compile-time `Set` of
18 string literals. There is no mechanism to add entries at runtime. No input path
reaches this set. Accepted as a non-threat for this phase.

### T-03-SC — Tampering: supply chain (npm/pip/cargo installs)

**Rationale:** No new package installs occurred during Phase 3 implementation. All
dependencies were already locked from prior phases. No new attack surface introduced.

---

## Unregistered Threat Flags

None. All seven SUMMARY.md files (`03-01` through `03-07`) report no new threat flags
beyond the plan's threat model. The one flag noted in `03-06-SUMMARY.md`
(`threat_flag: query-param` on `journal.routes.ts`) maps to existing threats
T-03-14/T-03-15/T-03-16/T-03-17 and is informational only.

---

## Notes on T-03-21 Verification

The string `trigger_job` appears once in `server.ts` — inside the JSDoc comment
`D-08: trigger_job is NOT registered (deferred to Phase 5)`. It does not appear as an
argument to any `server.registerTool(...)` call. The six registered tools are confirmed
by grep of all `registerTool` invocations in `tools.ts`.

## Notes on T-03-03 Verification

T-03-03 is a process control (human checkpoint), not a code mitigation. The declared
mitigation — human confirmed `DATABASE_URL` before apply — is documented in
`03-02-SUMMARY.md` task-2 checkpoint. The Railway service binding constrains which
database `bun run migrate` can reach; the human ran the command and observed
`migrate: all migrations applied` with exit 0. This satisfies the declared mitigation.
