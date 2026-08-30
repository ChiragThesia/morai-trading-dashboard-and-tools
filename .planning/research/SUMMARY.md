# Project Research Summary

**Project:** Morai Journal — Multi-user, encrypted broker-fed trading-journal backend  
**Domain:** Python/FastAPI backend; strict typing, envelope encryption, per-user OAuth, Railway deployment  
**Researched:** 2026-08-29  
**Confidence:** MEDIUM-HIGH (stack choices verified against PyPI/official docs; architecture and pitfalls argued from project's own v1 record plus cross-checked against industry practice)

---

## Executive Summary

Morai is a multi-user backend for a closed group of delta-neutral SPX traders to keep a correct, immutable P&L ledger across rolled positions. The system's core value is its reconciliation invariant — the sum of realized P&L must equal the broker's cash delta over any window, verified every ingest cycle — and its immutable entry-intent record for every position. This is not a typical SaaS: it is built for 4–5 known people with a single developer/owner, with no monetization, no public signup, and no growth goal.

**Recommended approach:** Python backend (FastAPI + SQLAlchemy 2.0), Postgres with envelope encryption (per-user DEK wrapped by a server-held KEK), a Procrastinate worker for ingest and reconciliation, and strict type checking (`mypy` + `basedpyright`). The 13-calendar oracle from v1 is the gate on money code — it has independently-computed expected values and must pass before the first user connects. This project's stated constraint (backend-first, no UI this milestone) removes the single largest write-off risk from v1; the architecture must start with encryption before any trade data is written, and with per-user token-refresh locks before multi-user ingest runs.

**What a stolen database dump protects against, and what it doesn't:** Envelope encryption defends against a stolen DB dump or backup yielding no readable trading history—the stated Core Value—but the narrowed guarantee bears naming explicitly: a dump still leaks *which contracts a user traded, when, and which fills co-occurred in one broker order* (position structure and trade frequency). Price, size, and P&L remain encrypted. This is the hard constraint forced by the oracle's hard case 1 (two calendars sharing the same front-leg contract; resolving it requires plaintext `order_id` and `occ_symbol` indexed for the disambiguation query). Stating the limit rather than softening it prevents later re-litigation of what was known at design time.

**Key risks and mitigations:** (1) `Any` re-enters through Pydantic's synthesized `__init__`, untyped vendor stubs, and JSON boundaries — mitigate with explicit Pydantic mypy plugin config and a project-owned `Protocol` wrapping every vendor call. (2) Decimal/float corruption at three boundaries (Postgres, JSON, greeks math) — mitigate with `NUMERIC` schema enforcement, Pydantic's safe Decimal defaults, and one named conversion function at the pricing boundary. (3) Encrypted columns break the queries the reconciliation invariant needs — mitigate by deciding now which columns stay plaintext (`user_id`, `order_id`, `occ_symbol`, timestamps) to keep joins/filters/windows queryable. (4) Multi-user leaks through per-user jobs (snapshot writer, reconciliation check) — mitigate by unwrapping DEK per user inside the loop, never one global query spanning users.

---

## Key Findings

### Recommended Stack

**Python 3.12 or 3.13** as the runtime. `schwab-py` (pinned to 1.5.1) is the only library that forces Python; 3.12/3.13 offer faster asyncio and better error messages. **FastAPI 0.141.1 + Pydantic 2.13.5** for request/response parsing. Pydantic v2's native Rust core and FastAPI's mandatory response-model typing turn every route boundary into a forced validation point, which is where the no-`Any` policy needs its choke point. **SQLAlchemy 2.0.52 with asyncpg 0.31.0** for the ORM — SQLAlchemy's native `Mapped[T]` declarative typing works under `mypy --strict` without a plugin (which is deprecated and broken past mypy 1.10.1 anyway). **Hypercorn 0.18.0** for production (not Uvicorn) — a Railway-specific correctness constraint: Hypercorn can dual-stack bind `[::]` for both IPv4 and IPv6; Uvicorn's dual-stack workaround (`--host ""`) is undocumented, behavior varies by OS/Python version, and was not re-verified this session (treat as a build-phase spike if needed). **Procrastinate 3.9.0** for job scheduling and ingest — Postgres-backed only (no Redis), Unix-cron syntax for the 30-minute RTH cadence, naturally transactional (tasks enqueue with `LISTEN/NOTIFY + FOR UPDATE SKIP LOCKED`), and ships a `procrastinate worker` CLI deployable as a separate Railway service.

**Encryption:** `cryptography` 50.0.1 using AES-256-GCM directly (`hazmat.primitives.ciphers.aead.AESGCM`), not Fernet. Generate a fresh CSPRNG nonce per encryption (never a counter or predictable derivation), store alongside ciphertext. **Password hashing:** `argon2-cffi` 25.1.0 with OWASP's higher-security band (128 MiB / 3–5 iterations, tuned to ~250–400ms on the real Railway hardware, not a laptop).

**Testing:** pytest 9.1.1 + Hypothesis 6.166.0. The 13-fixture oracle from `salvage/oracle-fixtures.md` becomes a parametrized pytest regression suite (one `pytest.param(fixture, id=fixture.orderId)` per oracle fixture) that gates money code.

**Type checking:** `basedpyright strict` as the primary gate (catches `Any` flowing through expressions via `reportAny`, which mypy cannot); `mypy --strict` as a secondary CI check. Both catch different edge cases; both are fast enough to run in parallel.

**Confidence:** HIGH for version numbers and library capabilities (verified against PyPI JSON API and official docs). MEDIUM for architectural choices like Hypercorn (the dual-stack workaround for Uvicorn was not re-measured this session) and for "basedpyright over mypy" (a reasoned synthesis, not a single authoritative benchmark).

### Expected Features

**Table stakes (users expect these; MVP must launch with all of them):**
- Admin-created accounts with admin-mediated password reset (no email, no self-serve signup)
- Session-based login, persistent across sessions
- Per-user Schwab OAuth connect, with connection health as a queryable first-class field (healthy / expiring-soon / expired)
- Pre-expiry warning based on the 7-day hard refresh-token expiry — the single highest-friction recurring event in multi-user Schwab connection management; must be proactive, not reactive
- Re-auth endpoint that repairs the existing connection record (never creates a duplicate)
- Idempotent manual re-sync, keyed on broker's fill ID
- Reconciliation status as its own lightweight, pollable endpoint — "the first thing any client renders" per `PROJECT.md`
- Self-service full-account export (JSON, lossless) — also doubles as the deletion safety valve

**Should-have (competitive differentiators; add after v1 validation):**
- Automatic catch-up sync triggered on successful re-auth (v1 can require manual re-sync click after reconnecting)
- Admin-facing "who is stale, for how long" view across users — isolation-respecting aggregate showing connection health, never P&L or positions
- Sync-run history (what a given sync actually ingested) for audit and debugging

**Defer indefinitely (explicitly rejected as incompatible with stated constraints):**
- Shared/social surface (leaderboard, cross-user stats) — structurally incompatible with per-user encryption and no-cross-user-read constraint
- Role-based access control — unnecessary for 4–5 known peers where every user owns their own data
- Email infrastructure — not planned; admin + in-app banner sufficient for this closed group
- SSO, MFA, public signup, webhook subscriptions, tax-form export (Form 6781 would need CPA sign-off)

### Architecture Approach

The system is three microservices: a **web server** (FastAPI, Hypercorn, stateless, horizontally scalable), a **worker** (Procrastinate, single deployable, ingest/derivation/snapshot/reconciliation/token-refresh owner), and a **scheduler** (Railway cron or internal loop — unresolved, needs a build-phase spike). All three share one Postgres database, one KEK (held in Railway env vars), and one per-user advisory lock for token refresh.

**The encryption boundary** sits at the repository layer, not the DB (no `pgcrypto`-only scheme). A repository function takes a domain object and encrypts flagged fields using the caller's unwrapped DEK; the domain layer never sees a key or an encryption decision. This keeps encryption testable with an in-memory adapter.

**Critical plaintext columns** (forced by the oracle's hard case 1): `user_id`, `order_id`, `occ_symbol`, all timestamps, all foreign keys. These are not sensitive on their own and the system cannot function with them encrypted — the derivation query must widen its read to "every fill in the same broker order" (the core mechanism that disambiguates shared front-leg calendars), which requires `order_id` indexed in plaintext. Everything genuinely money-shaped (`price`, `qty`, `net_amount`) and free-text (`thesis`, `invalidation`, `exit_plan`) is encrypted.

**Event-derivation model** (not event-sourcing): `raw_fills` are immutable; `events` (OPEN/CLOSE/ROLL/SETTLEMENT) are derived from fills, content-addressed by `fill_ids_hash` for idempotency. The `ROLL` event has two separate `NOT NULL` columns (`rollOpenDebit`, `rollCloseCredit`) enforced by `CHECK` constraint — this is the direct database-level fix for the −$319,850 bug. `Positions` and `campaigns` are read models refreshed after each derivation pass, never their own write paths.

**The reconciliation invariant** runs every ingest cycle, per user, as an automated check (not a UI tile). It sums realized P&L across all events for a user in a window, compares against the broker's cash delta from `broker_transactions` (the independent source, fed directly from Schwab, never from the derivation pipeline), and reports pass/fail.

### Critical Pitfalls (Top 5)

1. **`Any` re-enters without being written** — through Pydantic's synthesized `__init__` (fixed by `[tool.pydantic-mypy] init_typed = true`), through every `response.json()` call (untyped vendor: status of `schwab-py` type coverage is UNVERIFIED at research time), and through vendor stubs. Mitigate: write one project-owned `Protocol` covering only methods actually called from the vendor, have every call site depend on the `Protocol`, never the vendor class directly.

2. **Decimal/float corruption at three invisible boundaries** — Python ↔ Postgres (ORM defaults or lazy migrations leave money columns as `FLOAT`), Python ↔ JSON (Pydantic's default is safe, but a `PlainSerializer(lambda v: float(v))` "fix" reintroduces it), Decimal ↔ float math library (Black-Scholes needs `math.exp`, `math.log`; the ledger must never do this). Mitigate: enforce `NUMERIC(precision, scale)` in every migration review; route BSM/greeks through one named conversion function at a pricing-boundary seam; never call `Decimal(some_float)` without going through `Decimal(str(some_float))` with a comment.

3. **Envelope encryption nonce reuse and master-key custody** — AES-GCM with repeated `(key, nonce)` leaks plaintext XOR and can hand an attacker a forgery key. A predictable nonce (counter that resets on redeploy, or derived from row ID) reintroduces this under load or after restart. The master key is the single point of failure for every user's history at once. Mitigate: fresh CSPRNG nonce per encryption, stored alongside ciphertext; treat master-key backup as a Phase-1 deliverable; rehearse a stolen-dump test (take a real `pg_dump`, load it with the KEK unavailable, confirm nothing decrypts); version every ciphertext row with `dek_version` so a rotation can read old rows under the old DEK and write new rows under the new.

4. **Encrypted columns break the ledger's own queries** — the reconciliation invariant must run "while nobody is logged in" and requires filtering by timestamp windows; the campaign view groups by position/roll structure; drift detection filters by DTE and caps. If `order_id`, `occ_symbol`, and timestamps are encrypted, none of these run in SQL. Mitigate by deciding now (before the ledger schema lands) which columns stay plaintext and why — write this list down in the schema migration or a README so it is not re-litigated as a bug later.

5. **Multi-tenant isolation leaks through cross-user jobs** — the snapshot writer (every open position, every user, every 30 minutes) and the reconciliation check (every ingest cycle) both scan every user's data, and the trap is failing to re-scope isolation *inside* the loop (decrypt under the right DEK, write audit rows under the right actor) once the outer loop has correctly iterated users. Mitigate: every per-user step unwraps that user's DEK and writes through that user's scoped session explicitly.

---

## Implications for Roadmap

### Suggested Phase Structure

**Phase 1: Identity, Access, and Core Data Model**
- Encryption foundation; user/auth; schema (Pydantic + SQLAlchemy, Decimal handling, plaintext columns decided)
- Avoids: Pitfalls 1, 2, 3, 4 (established early)
- Research flags: Verify Postgres pooling model (direct, session-mode, or transaction-mode); confirm RLS + `SET LOCAL` safety

**Phase 2: Schwab OAuth, Token Lifecycle, and Per-User Locks**
- OAuth flow; per-user `pg_advisory_lock` for refresh; connection health; pre-expiry warning; re-auth; idempotent re-sync
- Avoids: Pitfalls 7, 5, 8 (per-user routing, async I/O discipline enforced)
- Research flags: Railway cron vs. persistent worker (needed before Phase 3 worker is built); confirm `schwab-py` type coverage (UNVERIFIED)

**Phase 3: Raw Ingest and Oracle-Driven Event Derivation**
- Ingest from Schwab; event derivation (pure, testable against oracle); delete-then-insert reap rule
- Can parallelize with Phase 2 (oracle needs no broker connection)
- Avoids: Pitfall 9 (oracle as independent ground truth, mutation testing to confirm)
- Research flags: None — oracle is primary source

**Phase 4: Positions Aggregate and Campaign Read Model**
- Positions (status derived from events, never stored); campaigns as read model (refreshed by derivation, no independent writer)
- Avoids: Pitfall 4 (no second writer for data fully derivable from events)

**Phase 5: Reconciliation Invariant and Status Endpoint**
- Core value implementation; `GET /reconciliation` endpoint; invariant property (not reconstruction)
- Avoids: Pitfall 9 (invariant compares independently-sourced numbers)
- Research flags: Window-windowing strategy (principle established but exact boundary cutoff — RTH trading days, calendar days, or rolling 24-hour — TBD)

**Phase 6: Snapshot Capture and Reprice Writer**
- 30-minute cadence; honest gap handling; repair path documented
- Can parallelize with Phase 4 (independent of ledger pipeline) and should start as soon as Phase 4 lands — snapshot data is the one thing that cannot be backfilled once missed
- Avoids: Pitfalls 8, 5 (async I/O, per-user loop scoping)
- Research flags: Railway cron cold-start implications; market-data source (Schwab or stub)

**Phase 7: API Surface — Review, Drift, Export**
- Campaign view; drift detection; snapshots history; full export (JSON/CSV); sync history (optional P2)
- Avoids: None new — all upstream constraints enforced
- Standard patterns (REST API design)

**Phase 8: Entry-Intent Capture and Plan-Followed Record**
- Write-once forms; immutability enforcement; audit trail
- Independent of ledger pipeline; can build any time after auth
- Standard patterns

### Phase Ordering Rationale

1. Phase 1 before everything: encryption and type system are architectural requirements.
2. Phases 2 and 3 overlap: Phase 3 (oracle-driven derivation) needs no broker connection.
3. Reconciliation (Phase 5) after Phases 3 and 4: needs both inputs (broker transactions + events).
4. **Snapshots (Phase 6) can parallelize with Phase 4** and should start as soon as Phase 4 lands — not wait for Phase 5. This is deliberate: snapshot data is irreplaceable once missed, and v1's "largest permanent regret" was exactly this.
5. Entry-intent (Phase 8) after Phase 1: no ledger dependency.
6. API (Phase 7) last: aggregates everything upstream.

### Open Decisions and Their Blockers

Beyond the research questions flagged above, three architectural decisions remain open and block what:

1. **Railway execution model (cron vs. persistent worker):** Blocks Phase 2 and Phase 6 scheduler design. A build-phase spike (≤1 day) needed before either is written.
2. **Postgres connection topology (direct, session-mode pooler, or transaction-mode pooler):** Blocks Phase 1 RLS + `SET LOCAL` design. Must be determined early in Phase 1.
3. **Master key custody (Railway env var vs. managed KMS like AWS KMS):** Does not block any phase structurally — STACK.md rates env-var as defensible for 4–5 known users and the stated threat model that excludes app-server compromise. But it narrows the security claim: a compromised app server reads everything, not just a dumped database. The claim is explicitly stated rather than papered over; revisit only if user count or threat model grows.

### Research Flags

**Phases needing deeper research:**
- **Phase 1:** Postgres pooling model — direct connection, session-mode pooler, or transaction-mode pooler? Determines RLS safety.
- **Phase 2:** Railway cron vs. persistent worker — impacts scheduler design and deployment topology. Needs a build-phase spike (≤1 day).
- **Phase 2:** `schwab-py` type coverage (UNVERIFIED) — check for `py.typed` marker; scope project-owned `Protocol` wrapper accordingly.
- **Phase 5:** Window-windowing strategy — principle is "closed windows never re-check," but exact delineation (RTH trading days, calendar days, rolling 24-hour) undecided.

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Pydantic + SQLAlchemy 2.0 + envelope encryption — all well-documented.
- **Phase 3:** Oracle-driven derivation — oracle is primary source, model argued in project docs.
- **Phase 4:** Read-model materialization — established pattern.
- **Phase 7:** REST API design — FastAPI standard choice.
- **Phase 8:** Write-once forms — simple temporal constraint.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | Versions verified live against PyPI JSON API; library capabilities against official docs. Judgment calls (basedpyright over mypy, Hypercorn vs. Uvicorn) reasoned but not re-measured. |
| **Features** | MEDIUM | Table stakes from B2B SaaS pattern research (web-search summaries). Two primary-source fetches (Plaid, SnapTrade) corroborate; differentiators grounded in project's own constraints. |
| **Architecture** | MEDIUM | Encryption and locking patterns cross-checked against current industry practice (MEDIUM). Ledger and token-lifecycle conclusions are HIGH (argued directly from this project's own measured v1 record). Hypercorn dual-stack measured in v1 but not re-verified against current Railway (MEDIUM). |
| **Pitfalls** | HIGH (project-cited entries) / MEDIUM (general practice) | Pitfalls grounded in project record (NN-, V-, P- citations) are HIGH. Pitfalls 1–8 cross-checked against current industry practice; three items explicitly marked UNVERIFIED. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address During Planning

1. **Railway execution model** — Spike to measure cron "cold container per run" vs. persistent worker for 30-minute cadence; impacts Phase 2 and Phase 6 design.
2. **Postgres pooling model** — Confirm whether Railway provides direct connection, session-mode pooler, or transaction-mode pooler; impacts Phase 1 RLS design.
3. **Hypercorn dual-stack binding** — If using Uvicorn locally, verify Hypercorn's `--bind [::]:8000` works on real Railway hardware (Phase 2 deployment, optional spike).
4. **Window-windowing strategy** — Principle ("closed windows never re-check") is established; exact boundary cutoff (RTH days, calendar days, rolling 24-hour) needs clarification for Phase 5.
5. **`schwab-py` type coverage** (UNVERIFIED) — Check for `py.typed` marker at Phase 0; scope project-owned `Protocol` wrapper accordingly.
6. **Schwab API revocation signal** (UNVERIFIED) — Research whether API surfaces a way to distinguish user revocation from routine 7-day expiry; affects Phase 2 UX design.

---

## Sources

**Primary (HIGH confidence):** PROJECT.md, REBUILD-BRIEF.md (NN- and V- entries), docs/learnings/ (337 entries), salvage/oracle-fixtures.md, trading-journal-research.md

**Stack verification:** PyPI JSON API (all versions), schwab-py official docs and source, SQLAlchemy official docs, Pydantic docs, FastAPI docs, Procrastinate docs

**Architecture/pitfalls research:** Project's own record + cross-checked against Xata/AWS envelope encryption patterns, PostgreSQL advisory-lock docs, WorkOS/Plaid/SnapTrade patterns, FastAPI/asyncio community writeups, mutation-testing literature

**UNVERIFIED:** schwab-py py.typed marker, Schwab API revocation signal, Railway Postgres pooling model, Hypercorn dual-stack on current Railway (measured in v1, not re-verified)

---

*Research completed: 2026-08-29*  
*Ready for roadmap: yes*
