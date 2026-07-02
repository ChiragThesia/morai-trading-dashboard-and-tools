---
phase: 11
slug: sidecar-scaffold-auth-migration
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-25
audited: 2026-07-02
---

# Phase 11 — Validation Strategy (Retroactive Audit)

> Per-phase validation contract for feedback sampling during execution.
> This document was retroactively filled by a Nyquist validation audit on
> 2026-07-02. Phase 11 executed and was verified (11-VERIFICATION.md, 9/9
> code truths, UAT 5/5) before this map existed. The audit below re-derives
> the map from the plans/summaries and RUNS the tests to confirm coverage
> is real, not just claimed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Python)** | pytest 8.x + pytest-asyncio, real Postgres (no mocks for DB layer) |
| **Config file (Python)** | `apps/sidecar/pytest.ini`; fixtures in `apps/sidecar/tests/conftest.py` |
| **Framework (TS)** | Vitest 4.x workspace (+ fast-check, testcontainers, msw) |
| **Config file (TS)** | repo-root `vitest.workspace.ts` |
| **Quick run (Python)** | `cd apps/sidecar && .venv/bin/python -m pytest -q` |
| **Quick run (TS)** | `bunx vitest run <file>` |
| **Full suite (Python)** | same command — full sidecar suite runs in <1s |
| **Full suite (TS)** | `bun run test` (repo-root vitest workspace) |
| **Estimated runtime** | Python: ~1s (67 tests). TS: ~35s (1221+ tests, adapters package uses testcontainers for its own Postgres-backed suites, unrelated to phase-11 files) |

**Note on Python test DB:** `conftest.py`'s session-scoped `_setup_db` fixture requires a live
Postgres on `localhost:5499` (`TEST_DB_HOST`/`TEST_DB_PORT` overridable). No Docker daemon was
available in the audit sandbox; a local `postgresql@16` (Homebrew) instance was initialized and
started on port 5499 for this audit to execute the suite for real (not skipped). In CI/dev this
is normally a docker-compose Postgres container per 11-04 plan notes.

---

## Sampling Rate

- **After every task commit:** `cd apps/sidecar && .venv/bin/python -m pytest -q` (Python changes) or `bunx vitest run <file>` (TS changes)
- **After every plan wave:** `bun run test` (full TS) + full pytest lane
- **Before `/gsd-verify-work`:** Full suite must be green (confirmed at original verification: pytest 9/9 phase-11 tests + TS 1221/1221; audit reconfirms 67/67 pytest — suite grew across later phases 12/13 sharing the sidecar test dir)
- **Max feedback latency:** ~1s (pytest), ~35s (full TS suite)

---

## Per-Task Verification Map

| Task | Plan | Requirement | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|-----------|--------------------|-------------|--------|
| Docs-before-code: GW-01 relaxation (§D22) | 11-01 | GW-01 | doc grep | `grep token_json docs/architecture/stack-decisions.md` | ✅ | ✅ green |
| broker_tokens schema gains token_json JSONB | 11-01 | GW-01 | structural (Drizzle schema) | `grep tokenJson packages/adapters/src/postgres/schema.ts` | ✅ | ✅ green |
| Migration 0011 additive-only | 11-01 | GW-01 | structural | file content check | ✅ | ✅ green |
| token_write_func dual-write + refresh_issued_at invariant + rowcount guard | 11-04 | GW-01 | pytest (real Postgres) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_token_store.py -v` | ✅ | ✅ green (3 tests, re-run by audit) |
| acquire_sidecar_lock: pg_try_advisory_lock, second instance SystemExit(1) | 11-04 | GW-04 | pytest (real Postgres) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_advisory_lock.py -v` | ✅ | ✅ green (re-run by audit) |
| FastAPI lifespan: lock → clients → degrade; no login()/subscribe() | 11-04 | GW-01, GW-04 | pytest | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_health.py -v` | ✅ | ✅ green |
| GET /sidecar/health degraded/not_seeded states | 11-04 | GW-01 | pytest | `tests/test_health.py` | ✅ | ✅ green |
| GET /sidecar/chain source='schwab_chain'; 503 AUTH_EXPIRED | 11-03 | GW-02 | pytest | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_chain_proxy.py -v` | ✅ | ✅ green |
| TS sidecar chain adapter: Zod-parse RawChain + AUTH_EXPIRED → err mapping | 11-05 | GW-02, JRNL-02 | vitest | `bunx vitest run packages/adapters/src/sidecar/chain-adapter.test.ts` | ✅ | ✅ green (re-run by audit) |
| In-memory sidecar-chain twin (test double for downstream consumers) | 11-05 | GW-02 | vitest | `bunx vitest run packages/adapters/src/memory/sidecar-chain.test.ts` | ✅ | ✅ green (re-run by audit) |
| refresh-tokens NOT scheduled; 10 queues/6 crons after GW-03 retirement | 11-06 | GW-03 | vitest | `bunx vitest run apps/worker/src/schedule.test.ts` | ✅ | ✅ green (re-run by audit; explicit `expect(names).not.toContain("refresh-tokens")` assertion at line 189) |
| selectChainSource: fresh→schwab (sidecar-backed), AUTH_EXPIRED→CBOE fallback | 11-06 | JRNL-02 | vitest | `bunx vitest run apps/worker/src/handlers/fetch-schwab-chain.test.ts` | ✅ | ✅ green |
| apps/auth deletion; no @morai/auth imports; tsconfig clean | 11-07 | GW-03 | structural | `test ! -d apps/auth && grep -rL '@morai/auth' apps packages` | ✅ | ✅ green (confirmed at original verification, re-confirmed present state) |
| Dockerfile binds `::`, reads $PORT; CR-01/CR-02 fixes | 11-04 | GW-04, GW-05 | structural | `grep 'host ::' apps/sidecar/Dockerfile` | ✅ | ✅ green |
| railway.sidecar.toml: no public domain config, private-network wiring | 11-05 | GW-05 | structural (config-as-code has no field expressing "no domain" — presence of a domain is an operator dashboard action, not a file property) | manual review | ✅ (file present, reviewed) | ⚠️ Manual-Only (see below) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/manual*

**Audit re-run evidence (2026-07-02):**
```
cd apps/sidecar && .venv/bin/python -m pytest -q
→ 67 passed, 7 warnings in 0.63s   (real Postgres, local Homebrew instance on :5499)

bunx vitest run apps/worker/src/schedule.test.ts \
  packages/adapters/src/sidecar/chain-adapter.test.ts \
  packages/adapters/src/memory/sidecar-chain.test.ts
→ Test Files  3 passed (3) · Tests  20 passed (20)
```

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. `apps/sidecar/tests/conftest.py` and
`apps/sidecar/pytest.ini` were built in-phase (11-04); the Vitest workspace and adapters test
conventions pre-existed from earlier phases. No new test scaffolding was needed for this audit.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Sidecar has NO public Railway domain (private-network-only ingress) | GW-05 | Railway "no public domain" is an absence-of-dashboard-action, not a property expressible in `railway.sidecar.toml` or any repo file; provable only by inspecting the live Railway service's Networking settings or attempting an external connection | In Railway dashboard: sidecar service → Settings → Networking → confirm no public domain is generated. From an external network: `curl https://<attempted-public-url>/sidecar/health` should time out / connection-refused. |
| Migration 0011 applied to live Supabase DB | GW-01 | DDL against production requires live operator DATABASE_URL (direct, port 5432); cannot run in CI/sandbox | `bun run migrate` with direct DATABASE_URL; confirm via `SELECT column_name FROM information_schema.columns WHERE table_name='broker_tokens' AND column_name='token_json'` returns one row |
| Live Schwab OAuth dance seeds token_json in prod | GW-01 | Requires live Schwab credentials + callback URL reachable from production | Run `client_from_manual_flow` for both trader/market apps; confirm `GET /sidecar/health` returns `{status:'ok', tokenFreshness:'fresh'}` |
| Sidecar env vars set on Railway (DATABASE_URL, TOKEN_ENCRYPTION_KEY, SCHWAB_*) | GW-01, GW-04 | Railway dashboard env assignment; Schwab Developer Portal credentials not present in CI | Set vars per `railway.sidecar.toml` header comment; confirm sidecar boots without config validation error |

These four items are carried over unchanged from 11-VERIFICATION.md's `human_verification` block
(go-live actions, not code gaps) — confirmed still accurate on re-read; no new manual-only items
were found by this audit.

---

## Validation Sign-Off

- [x] All tasks have an automated verify or a documented Manual-Only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — none were missing
- [x] No watch-mode flags in any automated command
- [x] Feedback latency < 60s (pytest ~1s, full TS suite ~35s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-02 (retroactive audit)

---

## Validation Audit 2026-07-02

**Auditor:** gsd-nyquist-auditor (retroactive fill)
**Trigger:** 11-VALIDATION.md was an unfilled template despite phase being executed + verified.

**Gaps found:** 0 genuine MISSING gaps. Every phase-11 requirement (GW-01..05, JRNL-02) already
has a real, running, behavioral test:
- GW-01 (sole authenticator, token dual-write): `test_token_store.py`, `test_health.py`
- GW-02 (REST proxy / thin HTTP adapters): `test_chain_proxy.py`, `chain-adapter.test.ts`
- GW-03 (refresh-tokens retired): `schedule.test.ts` (explicit negative assertion)
- GW-04 (advisory lock, single session): `test_advisory_lock.py`
- GW-05 (internal-only, no public ingress): no automated test possible (absence of a Railway
  dashboard action) — correctly Manual-Only, documented above
- JRNL-02 (chain sourced through sidecar, CBOE fallback retained): `chain-adapter.test.ts`,
  `fetch-schwab-chain.test.ts`

**Gaps resolved:** 0 (none needed — see above).
**Gaps escalated:** 0.
**New test files created:** 0.

**Verification performed (not just claimed):** Since the original 9-test pytest count in
11-VERIFICATION.md no longer matches the current 67-test count (suite grew across phases 12/13
sharing `apps/sidecar/tests/`), the audit did not trust the stale number. It stood up a local
Postgres (Homebrew `postgresql@16` on port 5499, since Docker was unavailable in the sandbox) and
re-ran the full pytest lane for real: **67 passed**. It also re-ran the three phase-11-authored
Vitest files directly: **20 passed**. Both runs confirm the requirement-level behaviors described
above are still true today, not merely true at original verification time.
