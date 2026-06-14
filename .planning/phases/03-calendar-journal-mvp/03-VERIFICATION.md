---
phase: 03-calendar-journal-mvp
verified: 2026-06-14T17:16:43Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Invoke list_calendars from Claude Code and compare output to GET /api/calendars"
    expected: "Both return the same {calendars:[...]} JSON. If no calendar exists, register one via POST /api/calendars first."
    why_human: "Live MCP bearer-transport round-trip from Claude Code cannot be automated — McpServer-direct tests pass but the streamable-HTTP transport hand-off requires the running server."
  - test: "Register a calendar, wait for one RTH snapshot (or seed one), then invoke GET /api/journal/:calendarId and get_journal with the same ID and compare outputs"
    expected: "Both return the same ordered {snapshots:[...]} array. Today is a weekend so no real snapshot exists yet — this verifies the live data path on the next RTH weekday."
    why_human: "Requires live snapshot data (RTH weekday) to exercise the populated-array path. The empty-array and 404 paths are covered by automated tests."
  - test: "Invoke get_term_structure and get_skew from Claude Code"
    expected: "Both return {observations:[]} with no error."
    why_human: "Live MCP transport verification — automated tests cover McpServer-direct path only."
  - test: "Invoke get_live_greeks with a known calendarId from Claude Code"
    expected: "Returns liveGreeksResponse-shaped payload (may have empty legs if no Phase 2 leg data for that calendar) — never an error."
    why_human: "Live MCP transport round-trip required."
  - test: "Confirm trigger_job is NOT listed in Claude Code's available MCP tools"
    expected: "trigger_job does not appear in the tool list (D-08 ban)."
    why_human: "Tool-list enumeration requires the live MCP client connection."
  - test: "Verify snapshot-calendars no-op behavior during the next NYSE holiday or outside RTH window"
    expected: "Worker logs 'snapshot-calendars: skipping — outside RTH or NYSE holiday'; no calendar_snapshots row is written for that time slot."
    why_human: "Behavior is tested by unit tests (holiday + weekend no-op asserted). Live confirmation during an actual RTH window or holiday provides end-to-end assurance beyond the automated gate."
---

# Phase 03: Calendar Journal (MVP) Verification Report

**Phase Goal:** A trader can register a calendar spread via the API, the snapshot job writes
30-minute RTH journal rows, and `GET /api/journal/:calendarId` plus MCP `get_journal` return
the ordered snapshot series — the end-to-end MVP anchor.
**Verified:** 2026-06-14T17:16:43Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/calendars registers an open calendar; GET /api/calendars lists it; MCP list_calendars returns the same list | VERIFIED | `calendarRoutes` with `registerCalendarRequest`/`calendarResponse` from `@morai/contracts` wired in `apps/server/src/main.ts:84`; `registerListCalendarsTool` in `tools.ts:66` uses same `listCalendarsResponse`; `makeMcpRouter` passes `listCalendars` use-case at `main.ts:91`; 16/16 mcp.test.ts pass. Live transport round-trip deferred to human (Task 3). |
| 2 | GET /api/journal/:calendarId returns an ordered JSON array of snapshot objects for a registered calendar after at least one snapshot has been written | VERIFIED (with WARNING) | `journalRoutes` at `journal.routes.ts:19` wired at `main.ts:85`; `readJournal` orders by `time ASC` in `calendar-snapshots.ts`; unknown calendarId returns null→404; route tests confirm 200/404/empty. WARNING: when a leg is null, `snapshotCalendars.ts:63-64` defaults marks to 0 producing fabricated non-NaN pnlOpen (CR-03). Live data path (populated snapshots) deferred to human — today is a weekend. |
| 3 | MCP get_journal returns the same snapshot series as the HTTP route, sharing one Zod schema from contracts | VERIFIED (with WARNING) | `registerGetJournalTool` at `tools.ts:106` imports `journalResponse` from `@morai/contracts` (line 6); HTTP `journalRoutes` imports the same `journalResponse` (journal.routes.ts:2). Comment at tools.ts:102 documents MCP-02. WARNING: tool uses `.parse()` not `.safeParse()` at args boundary (tools.ts:121-123) — throws ZodError on invalid calendarId input instead of returning typed error text (CR-02). Nominal flow (valid UUID) is correct. Live transport deferred to human. |
| 4 | snapshot-calendars job no-ops (logs "outside RTH / holiday, skipping") outside RTH or on an NYSE holiday; never writes a row in those conditions | VERIFIED | `snapshot-calendars.ts:31-32` gates on `!isWithinRth(now) \|\| isNyseHoliday(now)` with warn message "skipping — outside RTH or NYSE holiday"; `snapshot-calendars.test.ts:40-58` asserts use-case NOT called on 2026-01-01 holiday and weekend. `compute-bsm-greeks.ts:42` gates identically so the chain-trigger can never fire a snapshot on a holiday (Blocker 3 from spec). `compute-bsm-greeks.test.ts:45-61` asserts boss.send NOT called on holiday. `isNyseHoliday` in `nyse-holidays.ts` has 18 dates (9 in 2026, 9 in 2027); `2026-07-04` absent (Saturday). |
| 5 | All six MCP tools (get_status, list_calendars, get_journal, get_live_greeks, get_term_structure, get_skew) are registered and reachable; tools whose backing data does not yet exist return typed empty, not error | VERIFIED | All six `registerXxxTool` functions present in `tools.ts`; all six registered in `server.ts:58-63`; trigger_job absent (tools.ts grep returns 0). `get_term_structure` and `get_skew` return `{observations:[]}` constant with no use-case call (tools.ts:204-209, 231-236). `get_journal` unknown calendarId returns `{error:"not found"}` text without throwing (nominal path). Live transport round-trip deferred to human (Task 3). |

**Score:** 5/5 truths verified (automated code evidence)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/journal/application/ports.ts` | Extended Calendar type + 11 port types | VERIFIED | Contains `strike`, `optionType`, `frontExpiry`, `status`; all 11 ports + 2 error variants exported |
| `packages/core/src/journal/domain/dte.ts` | Exported `calendarDte(now, expiry): number` | VERIFIED | `export function calendarDte` at line 81 |
| `packages/core/src/journal/index.ts` | Re-exports all Phase 3 types + calendarDte | VERIFIED | `ForResolvingLegSnapshot`, `ForPersistingSnapshot`, `calendarDte` confirmed at lines 36, 38, 72 |
| `packages/adapters/src/postgres/schema.ts` | `calendars.optionType` column | VERIFIED | `optionType: contractTypeEnum("option_type").notNull()` at line 42 |
| `packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql` | ADD COLUMN option_type migration | VERIFIED | `ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL;` |
| `packages/contracts/src/calendar.ts` | 4 Zod schemas for calendar CRUD | VERIFIED | `registerCalendarRequest`, `calendarResponse`, `listCalendarsResponse`, `closeCalendarRequest` all exported |
| `packages/core/src/journal/application/registerCalendar.ts` | `makeRegisterCalendarUseCase` with backExpiry>frontExpiry validation | VERIFIED | Factory at line 41; backExpiry rule tested in registerCalendar.test.ts:32 |
| `apps/server/src/adapters/http/calendar.routes.ts` | POST/GET/close routes with shared contracts | VERIFIED | `calendarRoutes` factory at line 28; imports `registerCalendarRequest`, `calendarResponse` from `@morai/contracts` |
| `packages/adapters/src/memory/calendars.ts` | In-memory twin with all 5 methods | VERIFIED | `registerCalendar`, `listCalendars`, `closeCalendar`, `getCalendarById`, `getOpenCalendarLegs` all present |
| `packages/core/src/journal/domain/nyse-holidays.ts` | NYSE 2026-2027 full-closure list + isNyseHoliday | VERIFIED | 18 dates (9+9), 2026-07-04 absent, `isNyseHoliday` exported |
| `packages/core/src/journal/application/snapshotCalendars.ts` | `makeSnapshotCalendarsUseCase` with D-05/D-06 logic | VERIFIED (WARNING) | Factory at line 132; NAN_STAMP at line 36; D-06 NaN propagation for IV/greeks confirmed. WARNING: missing-leg marks default 0 not NaN (CR-03) |
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | ForPersistingSnapshot (idempotent) + ForReadingJournal + ForResolvingLegSnapshot | VERIFIED (WARNING) | `onConflictDoNothing` at line 71; WARNING: `mapSnapshotRow` at line 192 has dead conditional `row.source === "cboe" ? "cboe" : "cboe"` (CR-01) |
| `apps/worker/src/handlers/snapshot-calendars.ts` | Snapshot handler with RTH+holiday gate | VERIFIED | `isNyseHoliday` gate at line 31; NO `boss.send` (terminal job confirmed) |
| `packages/contracts/src/journal.ts` | `snapshotResponse` (18 fields) + `journalResponse` | VERIFIED | Both schemas exported; `frontIv:"NaN"` accepted per journal.test.ts |
| `packages/core/src/journal/application/getJournal.ts` | `makeGetJournalUseCase` | VERIFIED | Factory at line 23 |
| `apps/server/src/adapters/http/journal.routes.ts` | GET /journal/:calendarId with 404/empty/200 | VERIFIED | `journalRoutes` at line 19; tests confirm 200/404/500/empty |
| `packages/contracts/src/analytics.ts` | Typed-empty `termStructureResponse` + `skewResponse` | VERIFIED | Both schemas exported with `{observations: z.array(z.unknown())}` |
| `apps/server/src/adapters/mcp/tools.ts` | 5 new MCP tool registration functions | VERIFIED (WARNING) | All 5 `registerXxxTool` functions exported; trigger_job absent. WARNING: `get_journal`/`get_live_greeks` use `.parse()` not `.safeParse()` at boundary (CR-02) |
| `apps/server/src/adapters/mcp/server.ts` | `makeMcpRouter` registering all 6 tools | VERIFIED | All 6 `registerXxxTool` calls at lines 58-63 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `calendar.routes.ts` | `@morai/contracts` | `zValidator(registerCalendarRequest)` + `calendarResponse.parse` | WIRED | `registerCalendarRequest` and `calendarResponse` imported from `@morai/contracts` (lines 4-5) |
| `apps/server/src/main.ts` | `calendarRoutes` | `app.route('/api', calendarRoutes(...))` | WIRED | `calendarRoutes(registerCalendar, listCalendars, closeCalendar)` at main.ts:84 |
| `packages/adapters/src/postgres/repos/calendars.ts` | calendars table | Drizzle insert/select/update | WIRED | `db.insert(calendars)`, `db.select().from(calendars)` present |
| `fetch-cboe-chain.ts` | `nyse-holidays.ts` | `import { isNyseHoliday } from @morai/core` | WIRED | Line 2 of handler; gate at line 44 |
| `compute-bsm-greeks.ts` | `snapshot-calendars` queue | `boss.send("snapshot-calendars", ...)` | WIRED | Chain trigger at line 56 with `singletonKey: "triggered-by-compute"` |
| `apps/worker/src/main.ts` | `snapshot-calendars` worker | `createQueue("snapshot-calendars")` + `work` (NO schedule) | WIRED | `createQueue` at line 131; `work` at line 160; comment confirms no schedule |
| `fetchChain.ts` | `ForGettingOpenCalendarLegs` | `mustInclude` bypass in processChain | WIRED | `getOpenCalendarLegs` dep at line 31; `mustInclude` guard at line 168 |
| `journal.routes.ts` | `@morai/contracts` | `journalResponse.parse({snapshots})` | WIRED | `journalResponse` imported at line 2; used at line 38 |
| `apps/server/src/main.ts` | `journalRoutes` | `app.route('/api', journalRoutes(getJournal))` | WIRED | `journalRoutes(getJournal)` at main.ts:85 |
| `tools.ts` | `@morai/contracts` | `journalResponse` / `listCalendarsResponse` parse | WIRED | Both schemas imported at tools.ts:5-6; used in respective tool handlers |
| `apps/server/src/main.ts` | `makeMcpRouter` | use-cases injected | WIRED | `makeMcpRouter(config, getStatus, listCalendars, getJournal, getLiveGreeks)` at main.ts:91 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `journal.routes.ts` | `result.value` (SnapshotRow[]) | `calendarSnapshotsRepo.readJournal` → `calendar_snapshots` table | Drizzle SELECT ordered by time ASC; unknown calendarId returns null (→404) | FLOWING |
| `calendar.routes.ts` | `result.value` (Calendar[]) | `calendarsRepo.listCalendars` → `calendars` table | Drizzle SELECT ordered by openedAt DESC | FLOWING |
| `tools.ts` (list_calendars) | `result.value` | Same `listCalendars` use-case as HTTP route | Same Drizzle query as HTTP route | FLOWING |
| `tools.ts` (get_journal) | `result.value` | Same `getJournal` use-case as HTTP route | Same `readJournal` repo method | FLOWING |
| `tools.ts` (get_term_structure / get_skew) | constant | None (typed-empty stub) | Always `{observations:[]}` — intentional | STATIC (intentional, not a defect) |

### Behavioral Spot-Checks

Behavioral spot-checks skipped — no runnable server to test against without live infrastructure. Automated test suite (394/394 passing) serves as the behavioral gate.

### Probe Execution

No `probe-*.sh` scripts declared in PLAN files for this phase. Step 7c skipped.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| CAL-01 | 03-01, 03-02, 03-03 | Register open calendar via API | SATISFIED | POST /api/calendars route, use-case, repo, contracts all exist and are wired |
| CAL-02 | 03-01, 03-05 | snapshot-calendars writes one row per open calendar per RTH slot | SATISFIED | `makeSnapshotCalendarsUseCase` + `makePostgresCalendarSnapshotsRepo` idempotent persist; chain-triggered off compute |
| CAL-03 | 03-06 | GET /api/journal/:calendarId returns ordered snapshot series | SATISFIED | `journalRoutes` + `makeGetJournalUseCase` + `readJournal` wired and tested |
| CAL-04 | 03-01, 03-03, 03-05, 03-07 | GET /api/calendars lists calendars; closed calendars excluded from snapshot | SATISFIED | `listCalendars` route; `getOpenCalendars` in snapshot use-case only fetches open |
| CAL-05 | 03-04, 03-05 | Jobs no-op outside RTH / on NYSE holiday | SATISFIED | All 4 handlers gated: fetch-cboe-chain, fetch-rates, compute-bsm-greeks, snapshot-calendars; tests confirm |
| MCP-01 | 03-06, 03-07 | 6 MCP tools registered and reachable | SATISFIED (automated), PENDING (live transport) | All 6 tools in tools.ts + server.ts; 16/16 mcp.test.ts pass; live Claude Code round-trip deferred to human |

No orphaned requirements found — all 6 requirements are accounted for across plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | 192 | Dead conditional: `row.source === "cboe" ? "cboe" : "cboe"` — always returns "cboe" regardless of DB value; implicit `as`-equivalent assertion | WARNING | Code quality: misreports source if non-"cboe" value ever stored; technically violates no-`as` rule spirit. Does not break current functionality (all snapshots write "cboe" today). |
| `apps/server/src/adapters/mcp/tools.ts` | 121-123, 173-175 | `.parse(args)` instead of `.safeParse()` in `get_journal` and `get_live_greeks` handlers — throws ZodError to MCP caller on invalid calendarId input | WARNING | Violates "analytics tools never error" convention for malformed input. Nominal flow (valid UUID) is correct. Success criterion #5 is met for the expected caller (Claude Code with typed schema). |
| `packages/core/src/journal/application/snapshotCalendars.ts` | 62-65, 84 | Missing-leg marks default to `0`: when `front` or `back` is null, `frontMark ?? 0` and `pnlOpen = (0 - openNetDebit)*qty*100` produces a fabricated numeric value (not NaN) | WARNING | Data correctness: a journal consumer cannot distinguish a real zero-mark leg from a missing leg. D-06 specifies "marks and pnlOpen still populate" from existing data — when no data exists, writes 0 instead of NaN. Does not prevent rows from being written. |

No `TBD`, `FIXME`, or `XXX` debt markers found in any phase-3-modified source file.

### Human Verification Required

These items require human testing during trading hours with the running server and Claude Code configured.

#### 1. MCP Live Transport Round-Trip (list_calendars)

**Test:** From Claude Code with the server running and MCP bearer token configured, invoke `list_calendars`. Independently call `GET /api/calendars`. Compare outputs.
**Expected:** Both return the same JSON payload (same `{calendars:[...]}` structure); if no calendar exists, register one first via `POST /api/calendars`.
**Why human:** The MCP streamable-HTTP transport and bearer-gate hand-off from the running server cannot be exercised by the automated McpServer-direct test suite (03-VALIDATION.md §Manual-Only Verifications).

#### 2. MCP Live Transport Round-Trip (get_journal — live data path)

**Test:** On an RTH weekday, after at least one snapshot has been written: call `GET /api/journal/:calendarId` and `get_journal` (MCP) with the same calendarId. Diff the responses.
**Expected:** Both return the same ordered snapshot array. Timestamps match, field values identical.
**Why human:** Requires live snapshot data (RTH weekday). Today is a weekend — no real `calendar_snapshots` rows exist. The empty-array and 404 paths are covered by automated tests.

#### 3. MCP Live Transport Round-Trip (get_term_structure, get_skew)

**Test:** Invoke `get_term_structure` and `get_skew` from Claude Code.
**Expected:** Both return `{observations:[]}` with no error or exception.
**Why human:** Live MCP transport verification — automated tests cover McpServer-direct only.

#### 4. MCP Live Transport Round-Trip (get_live_greeks)

**Test:** Invoke `get_live_greeks` with a known calendarId from Claude Code.
**Expected:** Returns a `liveGreeksResponse`-shaped payload. May have empty legs if no Phase 2 leg data exists yet — but must never throw an error.
**Why human:** Live transport + Phase 2 data availability cannot be confirmed without the running server.

#### 5. trigger_job Absence in Claude Code Tool List

**Test:** From Claude Code, enumerate the available MCP tools.
**Expected:** `trigger_job` does NOT appear in the tool list.
**Why human:** Tool enumeration requires the live MCP client connection.

#### 6. RTH No-op Confirmation in Production

**Test:** At a time outside RTH (or on the next NYSE holiday), observe the worker logs.
**Expected:** Worker logs contain `"snapshot-calendars: skipping — outside RTH or NYSE holiday"` and no `calendar_snapshots` row is written for that time slot.
**Why human:** Unit tests assert this behavior with injected `now`; end-to-end confirmation in the real pg-boss job chain requires observation of the deployed worker.

### Gaps Summary

No hard gaps identified. All five success criteria are satisfied by the codebase as verified:

1. Calendar register/list/close routes exist, are wired to Postgres, and use shared Zod contracts — also reachable via MCP `list_calendars`.
2. Journal read route exists with correct 404/empty/200 semantics; snapshot use-case writes rows per the RTH+holiday gate.
3. `get_journal` MCP tool shares `journalResponse` from `@morai/contracts` with the HTTP route.
4. All four job handlers (fetch-cboe-chain, fetch-rates, compute-bsm-greeks, snapshot-calendars) are gated by `isWithinRth` + `isNyseHoliday`; the chain-trigger in compute-bsm-greeks also checks the gate so holidays cannot chain-trigger a snapshot.
5. All six MCP-01 tools are registered in `makeMcpRouter`; trigger_job is absent; typed-empty stubs for term-structure/skew.

**Code quality issues from REVIEW** (non-blocking to goal, require follow-up):

- **CR-01** (`calendar-snapshots.ts:192`): Dead conditional in `mapSnapshotRow` source narrowing. Cosmetic today; becomes a real bug if non-"cboe" snapshots are ever written. Fix: replace with `const source = row.source` or add explicit runtime guard.
- **CR-02** (`tools.ts:121-123, 173-175`): `get_journal`/`get_live_greeks` use `.parse()` instead of `.safeParse()` at args boundary. Nominal (valid UUID) path works correctly. Fix: switch to `.safeParse()` and return descriptive text on failure.
- **CR-03** (`snapshotCalendars.ts:62-65, 84`): Missing-leg marks default to `0` producing fabricated numeric pnlOpen. Fix: NaN-stamp mark/netMark/pnlOpen when a leg is null (per REVIEW CR-03 fix suggestion).

These are tracked in `03-REVIEW.md` under Critical Issues CR-01 through CR-05 (CR-04/CR-05 are pre-existing Phase 2 issues in `leg-observations.ts`).

---

_Verified: 2026-06-14T17:16:43Z_
_Verifier: Claude (gsd-verifier)_
