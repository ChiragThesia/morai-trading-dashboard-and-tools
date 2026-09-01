---
status: pass
date_checked: 2026-09-01
checker: gsd-plan-checker
---

# Phase 06 Plan Verification — PASS

**Plans verified:** 3 (all waves)
**Requirements coverage:** 7/7 (INGEST-01 through INGEST-06, OPS-05)
**Success criteria:** 5/5 addressed in executable task(s)

## Executive Summary

The three phase 06 plans are architecturally sound and will achieve the phase goal. Every requirement is covered exactly once. All five success criteria have explicit task implementations with verification steps. Critical design decisions (RLS enforcement, key completeness, raw fidelity, two-session failure handling, AST-based abs() prohibition) are specified as executable code patterns, not comments or assumptions.

---

## Requirement Coverage

| ID | Criterion | Plan | Task | Status |
|----|-----------|------|------|--------|
| INGEST-01 | One job per connected user; periodic fan-out; no double-fire | 06-02 | Task 1 | ✓ Covered |
| INGEST-02 | Raw fill stored immutably; signed amount + position_effect preserved | 06-01 | Tasks 1, 2 | ✓ Covered |
| INGEST-03 | Re-running over overlapping window is idempotent | 06-02 | Task 2 | ✓ Covered |
| INGEST-04 | Manual re-sync route; repeatable without side effects | 06-03 | Task 2 | ✓ Covered |
| INGEST-05 | First-connect backfill; chunked across configurable windows | 06-02 | Task 3 | ✓ Covered |
| INGEST-06 | Sync-run record queryable; when/what-landed/what-errored | 06-03 | Task 1 | ✓ Covered |
| OPS-05 | Batch insert chunks at ≤2,000 rows; ceiling proved | 06-01 | Task 3 | ✓ Covered |

---

## Success Criteria — Verification

### Criterion 1: Scheduled execution model, no double-fire on redeploy

**Implemented by:** 06-02 Task 1 (periodic fan-out) + 06-02 Task 1 (no-double-fire proof)

**Evidence:**
- `sync_all_connected_users` is registered as `@app.periodic(cron="* * * * *")` on the existing worker app
- Test behavior: "Inserting two `procrastinate_periodic_defers` rows with the same task name, periodic id and defer timestamp raises a unique-violation from Postgres"
- **Critical:** The test runs against the **installed database** (not the migration file), verifying the constraint is actually present in alembic/versions/0002_procrastinate_schema.py
- Constraint verified to exist: `CONSTRAINT procrastinate_periodic_defers_unique UNIQUE (task_name, periodic_id, defer_timestamp)`

**Pass:** ✓ Model proven, constraint proven live.

---

### Criterion 2: Broker transactions independent from derivation pipeline

**Implemented by:** 06-01 Task 1 (table + write path) + 06-01 Task 3 (meta-test)

**Evidence:**
- `broker_transactions` table created with `_BROKER_TRANSACTION_WRITE_TOKEN` sentinel gate
- Migration 0011 docstring cites WR-A3 (v1's hashed-key collision bug) and forbids surrogate keys
- Natural key explicitly: `(user_id, activity_id)`
- Task 3: "Exactly one tracked module under `src/` and `tests/` imports the broker-transaction write sentinel, and it is `src/morai/ingest/broker_transactions.py`"
- Fixture `violation_second_broker_transactions_writer.py` mirrors `violation_second_fill_writer.py`, rejected by both checkers by rule code
- Gate test runs against live tree; fixture is proven capable of failing

**Pass:** ✓ Write path isolated; second writer provably rejected.

---

### Criterion 3: Raw fidelity — signed amount never `abs()`'d, position_effect preserved

**Implemented by:** 06-01 Task 2 (pure extraction tests + AST gate)

**Evidence:**
- 06-01 Task 1 action: "Read the sign first, write it into `side` ("buy"/"sell"), and only then take the magnitude"
- 06-01 Task 1: writes `position_effect` through "unchanged and never mapped, uppercased or defaulted"
- 06-01 Task 2 behavior: "`morai.ingest.schwab_sync`, parsed and walked as a syntax tree, contains no call to a name bound to Python's built-in absolute-value function"
- 06-01 Task 2 action: "Assert on the parsed tree and not on the file's text, so a comment or a docstring discussing the prohibition can never fail the gate and a real call can never hide behind one"
- AST walk test: `ast.parse`, walk every node, fail on `ast.Call` with function node as `ast.Name` bound to `abs`

**Pass:** ✓ AST gate is executable. Comments cannot pass; real calls cannot hide.

---

### Criterion 4: Idempotence — second run over overlap changes nothing

**Implemented by:** 06-02 Task 2 (overlap/extend tests + WR-A3 proof) + 06-03 Task 2 (manual re-sync safety)

**Evidence:**
- 06-02 Task 2 behavior: "Every stored ciphertext and nonce byte in both tables is identical before and after the second run: nothing was rewritten, re-encrypted under a fresh nonce, or updated in place"
- Test compares raw bytes, not counts (byte identity proves no mutation)
- WR-A3 test: "Two fills from the same order and symbol that differ only in `leg_index` both land" (proves key is complete)
- Second behavior: "Two broker transactions differing only in `activity_id` both land"
- Re-run assertion: "assert two rows land...Then re-run each and assert the counts hold"
- 06-03 Task 2: "Calling the route twice outside the cooldown and draining both jobs leaves the fills and broker-transaction row counts unchanged after the first"

**Pass:** ✓ Idempotency proven by byte comparison + key completeness assertion + dual-run stability.

---

### Criterion 5: First-connect backfill, sync-run record, 2,000-row chunks

**Implemented by:** 06-02 Task 3 (backfill) + 06-03 Task 1 (record) + 06-01 Task 3 (chunking)

**Evidence:**
- 06-02 Task 3 behavior: "With `last_synced_at` null and a 365-day lookback chunked at 60 days, `sync_windows` returns consecutive windows covering the whole range with no gap and no overlap between neighbours"
- Backfill test: structural assertions (not hard-coded tuple lists) prove no-gap-no-overlap property
- Logging assertion: "Assert one line per window, each naming the bounds and the returned count" (measurement for D6-03's first-live-run requirement)
- 06-03 Task 1: "A successful `sync_user` leaves exactly one `sync_runs` row for that user: `started_at`...both landed counts equal to what the write paths returned"
- 06-01 Task 3: "Inserting 2,001 broker transactions in one call lands 2,001 rows and issues more than one flush"
- Ceiling assertion: Row count derived from actual column count, survives schema changes

**Pass:** ✓ Backfill coverage proven structurally; record queryable per-user (RLS); chunking proven with overflow.

---

## Critical Design Verification

### RLS Enforcement in Worker (Most Important)

**Finding:** The plan explicitly specifies `assert_connection_cannot_bypass_rls` as a REAL call in code, not a test.

**Evidence from 06-01 Task 1 action (line 382-383):**
```
It opens one session from `get_session_maker()`, calls `assert_connection_cannot_bypass_rls` on it before touching a protected table...
```

**Verification:**
- `assert_connection_cannot_bypass_rls` **VERIFIED TO EXIST** in `/src/morai/identity/rls.py`
- Function is async and takes `AsyncSession`: `async def assert_connection_cannot_bypass_rls(session: AsyncSession) -> None:`
- `get_session_maker()` (from `/src/morai/db/session.py`) returns maker from `get_app_engine()`, which connects as `morai_app`
- Test behavior (06-01 Task 1): "The session the job writes through cannot bypass RLS: `assert_connection_cannot_bypass_rls` returns without raising"
- The tracer test is automated: `pytest tests/ingest/test_sync_tracer.py -x -q`

**Status:** ✓ PASS. The RLS enforcement is built into the worker's own session initialization before any write. Not bypassed.

---

### Two-Session Failure Handling (Critical)

**Finding:** 06-03 Task 1 explicitly specifies rolling back the ingest transaction, then opening a FRESH SESSION for the failure record.

**Evidence from action (lines 222-233):**
```
On failure it rolls back that session, opens a **second, fresh session**, writes the failed run row there, and commits that alone. That separation is the whole point: a failure record written inside the transaction that failed rolls back with it...
```

**Test behavior (06-03 Task 1, lines 151-154):**
```
- That failure row is present after the ingest transaction rolls back — no fills, no broker transactions and no `last_synced_at` change survive, and the run record does.
```

**Status:** ✓ PASS. The mechanism is specified and testable. Failure record survives; other writes don't.

---

### Decisions Honored

| Decision | Coverage | Status |
|----------|----------|--------|
| D6-01: Long-running worker (not cron) | 06-02 Task 1 registers periodic task; 06-02 Task 1 tests no-double-fire via constraint | ✓ Honored |
| D6-02: Broker tx independent writer gate | 06-01 Task 1 creates table + gate; 06-01 Task 3 meta-test; migration 0011 cites WR-A3 | ✓ Honored |
| D6-03: Backfill constants unverified, logged | 06-01 adds settings with docstring stating unverified; 06-02 logs every call's bounds | ✓ Honored |

---

### Scope and Dependencies

**Wave structure:**
- Wave 1: 06-01 (tracer, 3 tasks)
- Wave 2: 06-02 depends_on ["06-01"] (cycle, 3 tasks)
- Wave 3: 06-03 depends_on ["06-01", "06-02"] (record + manual, 3 tasks)

**Sequential execution enforced.** No parallel writes to shared Postgres.

**User setup:**
- 06-01 declares `MORAI_APP_DB_PASSWORD` on railway worker service (reason: engine construction needs it)
- This is the single prerequisite; it covers all three plans

**Database isolation:**
- All three plans aware of V093 (shared Postgres, not isolated)
- Sequential waves prevent concurrent fixture collisions

**Status:** ✓ Dependencies correctly specified; user_setup appropriate and sufficient.

---

### Token Budget

| Plan | Estimate | Confidence |
|------|----------|------------|
| 06-01 | 120,000 tokens | low |
| 06-02 | 95,000 tokens | low |
| 06-03 | 105,000 tokens | low |
| **Total** | **320,000 tokens** | low |

**Note:** Confidence is "low" per CLAUDE.md's guidance for new phases; actual runtime will settle calibration. Counts reflect 3 tasks per plan with DB-marked tests (fixture overhead) and worker drain operations (expensive). Within reasonable bounds for three autonomous plans.

---

## Checks That Passed

- ✓ All 7 requirements assigned exactly once
- ✓ All 5 success criteria have executable task(s) with verification
- ✓ RLS enforcement: not comment, real assertion in code
- ✓ WR-A3 key completeness: behavioral test (two rows differing in least-sig key both land)
- ✓ abs() prohibition: AST walk, not grep; comments cannot pass; real calls cannot hide
- ✓ Rollback survival: two-session pattern explicitly specified and testable
- ✓ Float/decimal precision: four-decimal exactness documented as ceiling; canary test added
- ✓ TDD ordering: Task 1 in each plan is `tdd="true"`; no temporary scaffolding instructions
- ✓ Waves and shared DB: sequential waves 1→2→3; V093 awareness present
- ✓ Decisions honored: D6-01, D6-02, D6-03 all implemented
- ✓ user_setup items: MORAI_APP_DB_PASSWORD declared as prerequisite for worker
- ✓ Task completeness: all tasks have files, action, verify, done
- ✓ No contradictions with CONTEXT.md: all decisions and discretion items honored
- ✓ No scope creep from deferred ideas

---

## Conclusion

**VERDICT: PASS — Plans will achieve the phase goal.**

The three plans form a coherent, sequential arc:
1. **06-01** proves the raw-storage path end-to-end (one user, one fill, one broker transaction)
2. **06-02** proves the cycle (all users, idempotent re-run, first-connect backfill)
3. **06-03** proves the record and manual trigger (queryable history, safe re-sync, no superuser in web)

Every critical finding (RLS, key completeness, direction handling, failure survival) is not just documented but **encoded as executable assertions**. The phase is ready for execution.

**Phase 6 can proceed to `/gsd-execute-phase 06`.**
