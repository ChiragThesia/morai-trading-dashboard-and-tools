# Phase 15: Re-Auth Smoothing - Research

**Researched:** 2026-07-02
**Domain:** Schwab OAuth refresh-token lifecycle, status-surface alerting, operator re-auth CLI, Railway process-restart semantics
**Confidence:** HIGH (all five priority questions resolved by direct source/schwab-py-library inspection, not assumption)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Alert delivery (D-01 — provisional, Claude-recommended)**
- Passive surfaces only: `GET /api/status` exposes `refreshExpiresIn` (non-null inside
  T-24h) per app; the web dashboard shows an amber warning banner (extend the existing
  `AuthExpiredBanner` pattern); MCP `get_status` carries the same contract field so
  Claude Code sessions surface it for free. **No push-notification adapter.**

**Re-auth flow surface (D-02 — provisional, Claude-recommended)**
- Harden the existing **CLI two-step** (`apps/sidecar/seed_token.py` `authurl` →
  `exchange`) as the operator re-auth flow, and write the operator runbook (AUTH-06).
  **No web re-auth form.**
- D-02a: Flow must cover BOTH Schwab apps (trader + market) in one pass — seed_token.py
  already does; keep it that way.
- D-02b: Runbook lives in `docs/` (operator-facing), linked from the alert banner text or
  status output if practical.

**Alert stages/timing (D-03 — provisional, Claude-recommended)**
- Two states only, no escalation ladder: **amber warning** from T-24h until expiry (new),
  **red AUTH_EXPIRED** at expiry (already exists). A single warning log line fires when
  freshness computation first crosses T-24h.

**Fold-in: trigger_job cleanup (D-04 — provisional, Claude-recommended)**
- YES — fold the v1.1 milestone-audit debt item into this phase: remove
  `"refresh-tokens"` from `TRIGGERABLE_JOBS` in `packages/contracts/src/jobs.ts` and
  update the `trigger_job` MCP tool description in
  `apps/server/src/adapters/mcp/tools/trigger-job.ts`.

### Claude's Discretion
- Where the T-24h expiry math lives (core use-case vs status route) — follow existing
  freshness-computation placement.
- Exact `refreshExpiresIn` representation (seconds vs ISO timestamp) — match existing
  status contract conventions.
- Banner copy and styling — follow AuthExpiredBanner precedent.

### Deferred Ideas (OUT OF SCOPE)
- Push-notification channel (ntfy/Telegram/email) for token expiry + job-failure alerts.
- Web one-click re-auth form in the dashboard.
- Silent-stall stream watchdog (Phase 12 leftover) — not auth, don't fold here.
- `03-code-review-followups.md` phase-3 advisory items — unrelated.
- `over-engineering-cleanup.md` dead-code/deps cleanup — unrelated, future maintenance window.

**Status note:** all four decisions are Claude-recommended defaults; the user went AFK
before confirming. This research treats them as the working plan but flags anywhere a
verified fact changes their feasibility (see Summary — sidecar pickup mechanism affects
D-02/D-02b directly).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-05 | Status surfaces the Schwab refresh-token expiry and an alert fires at T-24h before the 7-day cutoff. | `isNearExpiry` already exists in `packages/core/src/brokerage/domain/token-freshness.ts` (Phase 5 D-14) with the exact 6-day/1-day-warning threshold math AUTH-05 needs. Extending `toAppTokenStatus` + `AppTokenStatus`/`appTokenStatus` contract with `refreshExpiresIn` is the correct, precedent-following placement (see Architecture Patterns). Warning-log placement resolved as an Open Question (core must stay I/O-free). |
| AUTH-06 | A one-click/operator re-auth flow (manual-flow → `token_write` to Postgres) restores Schwab auth without a redeploy. | `apps/sidecar/seed_token.py` two-step (`authurl`→`exchange`) and one-shot (`login`) flows already dual-write `broker_tokens` incl. `refresh_issued_at` anchor reset. **Critical finding:** the running sidecar process holds its Schwab client's token in memory and does NOT re-read Postgres after startup — the phrase "without a Railway redeploy" only holds if "redeploy" is read narrowly as "new code build" (`railway up`); the operator flow still requires a **process restart** to pick up the new tokens, achievable via `railway redeploy --service sidecar` (reuses the existing image, no rebuild). See Summary. |

</phase_requirements>

## Summary

Phase 15 is mostly **wiring and hardening of code that already exists**, not new
invention — `isNearExpiry`, `toAppTokenStatus`, `AuthExpiredBanner`, and
`seed_token.py`'s two-step flow are all real, tested, in-repo precedents (JOB-02 /
D-14 / Phase 4 P02 / Phase 11 D-03). The work is: (1) extend the token-freshness domain
function and contract with a `refreshExpiresIn` field and wire it through the two
adapters that already call `toAppTokenStatus` (Postgres repo + memory twin — both
converge on one core function, so this propagates to HTTP + MCP automatically per
MCP-02), (2) extend `AuthExpiredBanner`'s sibling with an amber pre-expiry state, (3)
commit + harden `seed_token.py`'s uncommitted diff and correct its post-exchange
instructions, and (4) do the two-file `TRIGGERABLE_JOBS` cleanup.

**The one finding that changes the plan's shape:** priority research question 1 (sidecar
token pickup semantics) resolves to a **verified contradiction** with the phase's stated
success criterion. Reading `apps/sidecar/main.py` and the installed `schwab-py==1.5.1`
library source (`schwab/auth.py:540`, `client_from_access_functions`) shows
`token_read_func()` is called **exactly once**, at client construction, which happens in
`_init_schwab_clients()` — itself invoked only when the Postgres advisory lock is
(re-)acquired (`main.py:196`, comment: "Called once per lock acquisition"). A healthy,
continuously-running sidecar instance holds the GW-04 lock forever and never calls
`token_read_func()` again; `authlib`'s `OAuth2Client` refreshes the **access** token
in-memory using the **refresh** token it was constructed with and only calls
`token_write_func` (never `token_read_func`) on that refresh. Therefore: writing a fresh
token row to `broker_tokens` while the sidecar is running does **not** get picked up on
"its next auto-refresh cycle" — the roadmap/phase-description wording is inaccurate. The
only way the running process picks up a new row is a **restart** (lock release →
re-acquire → `_init_schwab_clients()` re-runs → fresh `token_read_func()` call). This is
already implicitly acknowledged by `seed_token.py`'s own `_verify_and_finish()` output
(`"Done. Now re-init the sidecar clients... railway up --service sidecar --detach"`) —
the existing code already requires a restart; it currently instructs a full **rebuild**
(`railway up`) rather than the lighter **restart-only** command, `railway redeploy
--service sidecar` (confirmed via Railway CLI docs: `redeploy` restarts the most recent
deployment image without rebuilding, distinct from `up` which uploads and rebuilds).
AUTH-06's "without a Railway redeploy" success criterion should be read as "without
shipping new code" and satisfied via `railway redeploy`, not literally "no CLI action
against Railway." **This must be surfaced to the user at plan review — it changes what
"redeploy-free" means and what the runbook must instruct.**

**Primary recommendation:** extend `toAppTokenStatus`/`AppTokenStatus` with
`refreshExpiresIn: number | null` (seconds; non-null only inside the T-24h window,
matching SC1's literal wording), reusing `isNearExpiry`'s threshold constants; add the
amber banner as a sibling check inside (or alongside) `AuthExpiredBanner`; commit
`seed_token.py`'s pending diff and change its finish-instructions from `railway up` to
`railway redeploy --service sidecar -y`; write the runbook in a new `docs/operations/`
topic area explicitly documenting the restart requirement; do the two-file
`TRIGGERABLE_JOBS`/`trigger-job.ts` cleanup (plus the two associated test-file
assertions) as a small separate task.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Refresh-token expiry math (T-24h threshold) | Domain (`packages/core` brokerage domain) | — | `isNearExpiry`/`isTokenExpired` are already pure domain functions in `token-freshness.ts`; AUTH-05 extends the same file (existing placement precedent, Claude's Discretion resolved). |
| `refreshExpiresIn` computation | Domain (`toAppTokenStatus`) | Driven adapters (Postgres repo, memory twin) | Both adapters already call `toAppTokenStatus(row, now)` as their sole freshness-computation call site — extending the domain function propagates to both without adapter-level duplication. |
| Warning-side-effect logging (D-03) | Driving adapters (HTTP status route + MCP get_status tool) or composition root (`main.ts`) | — | `packages/core` must stay I/O-free (architecture-boundaries.md §2 — no node I/O in core); every existing `console.warn` call in the codebase lives in `apps/*` or `packages/adapters`, never `packages/core`. See Open Questions for exact choke point. |
| Amber/red banner rendering | Browser/Client (`apps/web`) | — | Extends `AuthExpiredBanner.tsx`, a client component reading `useStatus()`. |
| Re-auth token exchange + Postgres write | Driving adapter (operator CLI: `apps/sidecar/seed_token.py`) | Database (`broker_tokens`) | Runs locally/via `railway run`, not inside any deployed service — GW-05 (sidecar internal-only) is unaffected since this is an operator-invoked script, not a new HTTP surface. |
| Sidecar picking up a freshly-written token | Driving adapter (`apps/sidecar/main.py` lifespan) | Operational (Railway CLI restart) | **Not automatic.** Requires the sidecar process to restart (lock release/re-acquire) — an operational action, not a code path AUTH-06 can satisfy purely via the Postgres write. |
| `TRIGGERABLE_JOBS` cleanup | API contracts (`packages/contracts`) | Driving adapter (MCP tool description) | Both files are the exact two locations named in D-04; no core/adapter logic changes. |

## Standard Stack

No new external dependencies are required for this phase — it extends existing,
already-installed libraries (Zod contracts, Hono routes, React/TanStack Query web hooks,
`schwab-py` in the sidecar, `psycopg2` in `seed_token.py`). All work is additive to
established patterns.

### Core (reused, not newly installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | (existing, per `packages/contracts`) | `appTokenStatus`/`statusResponse` schema extension | MCP-02 single-schema-source convention already in place |
| schwab-py | `1.5.1` (pinned — `apps/sidecar/requirements.txt`, D22: "never upgrade without research review") [VERIFIED: apps/sidecar/requirements.txt] | OAuth token exchange (`client_from_received_url`, `client_from_login_flow`, `client_from_access_functions`) | Already the sole Schwab auth boundary since Phase 11 (GW-01/GW-03) |
| psycopg2 | (existing, per `apps/sidecar/requirements.txt`) | Direct Postgres writes in `seed_token.py`/`token_store.py` | Already used for the sole `broker_tokens` writer |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `toAppTokenStatus` with `refreshExpiresIn` | A new standalone `computeRefreshExpiresIn()` function called separately by each adapter | Rejected — duplicates the `now`/threshold logic across 2 adapters (Postgres repo + memory twin) instead of reusing the single existing choke point |
| `railway redeploy --service sidecar` for token pickup | A new internal `/sidecar/reload-token` endpoint the seed script calls to force `_init_schwab_clients()` without a process restart | Viable but out of scope per D-02 ("no web re-auth form"/"local re-auth flow") and adds a new internal HTTP surface + GW-05 audit burden for marginal gain over a one-line CLI command; **flagged as Open Question for user to confirm this tradeoff is acceptable** |
| CLI two-step re-auth (D-02) | `client_from_manual_flow` (schwab-py's built-in interactive helper) | Not used by this codebase and not viable for it: `client_from_manual_flow` (`schwab/auth.py:423`) blocks on a synchronous `input()` call — unusable for a non-interactive/agent-driven CLI. `seed_token.py` correctly composes `get_auth_context` + `client_from_received_url` instead. **Note:** the phase description's "Research flag: None ... established schwab-py pattern" cites `client_from_manual_flow` by name; the actual established in-repo pattern is the decomposed two-step, not that literal function — a naming imprecision, not a functional problem (D-02 already correctly says "harden the existing CLI two-step"). |

**Installation:** None required.

## Package Legitimacy Audit

N/A — this phase installs no new external packages. All libraries used
(`schwab-py==1.5.1`, `psycopg2`, `zod`, `hono`, `@tanstack/react-query`) are already
vendored and in production use since earlier phases.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Operator (local machine / Claude Code session)                          │
│                                                                           │
│  seed_token.py authurl  ──►  prints auth URLs (trader + market)         │
│         │                                                                │
│  (operator logs into Schwab, copies redirect URL(s))                    │
│         │                                                                │
│  seed_token.py exchange "<url1>" "<url2>"                               │
│  (or seed_token.py login — one-shot local-server auto-capture)          │
│         │                                                                │
│         ▼                                                                │
│  UPSERT broker_tokens  (token_json, access/refresh BYTEA,                │
│                          refresh_issued_at = NOW  ◄── 7-day TTL reset)   │
└─────────┬─────────────────────────────────────────────────────────────┬─┘
          │                                                             │
          ▼ (Postgres write — direct connection, port 5432)             │
┌───────────────────────────┐        ┌──────────────────────────────────┴───┐
│ Supabase Postgres          │        │ MANUAL STEP the operator must run:   │
│  broker_tokens (per app)   │        │ `railway redeploy --service sidecar` │
│  refresh_issued_at anchors │        │ (restarts the process — NOT a code   │
│  the 7-day clock (never    │        │  rebuild — so the lock is released   │
│  touched by refresh)       │        │  and re-acquired, re-reading the row)│
└───────────┬─────────────────────────┴──────────────────────────────────┬──┘
            │                                                             │
            │ read ONCE at client construction (schwab-py auth.py:540)    │
            ▼                                                             ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/sidecar (Railway service, GW-05 internal-only, single instance)      │
│                                                                             │
│  lifespan → _acquire_lock_and_init loop:                                  │
│    1. acquire Postgres advisory lock (GW-04)                              │
│    2. _init_schwab_clients() → token_read_func() ONCE → in-memory client  │
│    3. heartbeat lock every 20s; on heartbeat FAILURE only, loop re-runs   │
│       step 2 (re-reads Postgres) — otherwise NEVER re-reads               │
│    4. on 30-min access-token expiry, authlib auto-refreshes IN-MEMORY     │
│       using the refresh token from step 2, then calls token_write_func   │
│       (dual-writes new access token; refresh_issued_at untouched)         │
└───────────────────────────┬────────────────────────────────────────┬──────┘
                            │                                       │
                            ▼                                       │
┌───────────────────────────────────────────┐                       │
│ apps/server                                │                       │
│  readTokenFreshness() → toAppTokenStatus() │◄── reads broker_tokens│
│  (extended with refreshExpiresIn)          │    timestamps directly│
│         │                     │            │    (independent of    │
│         ▼                     ▼            │     the sidecar's     │
│  GET /api/status        MCP get_status     │     in-memory state)  │
│  (web polls 30s)         (Claude Code)     │                       │
└─────────┬───────────────────────────────────┘                     │
          ▼                                                          │
┌──────────────────────┐                                             │
│ apps/web              │                                             │
│  AuthExpiredBanner     │  amber (T-24h) / red (AUTH_EXPIRED)        │
│  useStatus() poll      │                                             │
└──────────────────────┘                                             │
                                                                       │
                          Schwab OAuth server ◄───────────────────────┘
                          (refresh grant every ~30 min while <7d old)
```

Key insight the diagram makes explicit: `readTokenFreshness`/`toAppTokenStatus` reads
**Postgres timestamps directly** (independent of the sidecar's in-memory state) — so
AUTH-05's status/alert surface will correctly show fresh `refreshExpiresIn` immediately
after `seed_token.py` writes the new row, **even before the sidecar restarts**. AUTH-05
is unaffected by the pickup-mechanism finding. Only AUTH-06 (actually restoring live
Schwab connectivity in the running sidecar) needs the restart step.

### Recommended Project Structure

No new directories for TS/Python code — this phase edits existing files in place:

```
packages/core/src/brokerage/domain/token-freshness.ts   # extend: refreshExpiresIn
packages/core/src/brokerage/application/ports.ts         # extend: AppTokenStatus type
packages/contracts/src/status.ts                          # extend: appTokenStatus schema
packages/contracts/src/jobs.ts                             # D-04: remove "refresh-tokens"
apps/server/src/adapters/mcp/tools/trigger-job.ts          # D-04: update description
apps/server/src/adapters/http/jobs.routes.test.ts           # D-04: update length/contains assertions
apps/web/src/components/AuthExpiredBanner.tsx               # add amber sibling state
apps/sidecar/seed_token.py                                    # commit pending diff; harden finish msg
docs/operations/schwab-reauth-runbook.md                      # NEW — operator runbook (D-02b)
docs/TOPIC-MAP.md                                              # add new "Operations" section entry
```

### Pattern 1: Extending `toAppTokenStatus` (single choke point for freshness)

**What:** Both `packages/adapters/src/postgres/repos/broker-tokens.ts` and
`packages/adapters/src/postgres/memory/broker-tokens.ts` call
`toAppTokenStatus(row, now)` as their only freshness-computation call — confirmed by
direct grep (2 call sites total, both wrapping the same core function).
**When to use:** Any time freshness classification needs a new derived field
(`refreshExpiresIn` here) — add it to the domain function's return shape, not to either
adapter.
**Example (existing precedent, `packages/core/src/brokerage/domain/token-freshness.ts`):**
```typescript
// Source: packages/core/src/brokerage/domain/token-freshness.ts (verbatim, current)
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const WARN_THRESHOLD_MS = 1 * 24 * 60 * 60 * 1000; // 1 day

export function isNearExpiry(refreshIssuedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return ageMs >= SEVEN_DAYS_MS - WARN_THRESHOLD_MS;
}

// AUTH-05 extension point: add alongside isNearExpiry, reuse the same constants.
// refreshExpiresInSeconds(refreshIssuedAt, now) => number | null
//   null when NOT isNearExpiry(...) (SC1: "non-null inside T-24h")
//   otherwise Math.max(0, SEVEN_DAYS_MS - ageMs) / 1000, rounded
```
Then thread the new field through `AppTokenStatus` (ports.ts), `toAppTokenStatus`'s
object literals (all 3 branches — none_yet/AUTH_EXPIRED/stale/fresh — decide the value
per branch), `appTokenStatus` Zod schema (status.ts), and `status-dto.ts`'s
`serializeApp` (no Date-to-string mapping needed if the value is already a plain
number).

### Pattern 2: Amber banner as a sibling of `AuthExpiredBanner`

**What:** `AuthExpiredBanner.tsx` currently checks only
`data.tokenFreshness.trader.status === "AUTH_EXPIRED"` — it does **not** check `market`.
**When to use:** When adding the amber pre-expiry state, decide explicitly whether to
check `trader` only (matching existing precedent) or both apps (closing a latent gap —
a `market`-app-only expiry currently shows NO red banner at all, either).
**Example (existing precedent, current file):**
```tsx
// Source: apps/web/src/components/AuthExpiredBanner.tsx (verbatim, current)
const isExpired =
  data !== undefined &&
  data.tokenFreshness !== "none yet" &&
  data.tokenFreshness.trader.status === "AUTH_EXPIRED";
```
This trader-only check is a **pre-existing gap**, not something Phase 15 introduced —
flagged in Common Pitfalls below since it affects both the new amber state's design and
is worth a one-line mention to the user even if out of strict AUTH-05/06 scope.

### Pattern 3: `seed_token.py` hardening (D-02)

**What:** The uncommitted working-tree diff adds `interactive=False` +
`callback_timeout=float(os.environ.get("SEED_CALLBACK_TIMEOUT", "600"))` to the `login`
subcommand's `client_from_login_flow` call (verified via `git diff
apps/sidecar/seed_token.py`, 2 insertions, 0 deletions, in `step_login()`).
**When to use:** This is exactly the "harden the existing CLI two-step" work item (D-02)
— it must be committed, not left as working-tree drift, before or as part of this
phase's implementation. It is uncommitted because the user iterated on it live during
the 2026-06-26→07-01 outage remediation (per Phase 14 memory), not because it is
incomplete or broken — the diff is small, self-contained, and consistent with the
function's existing docstring ("no input, no expiry race").
**Second hardening target:** `_verify_and_finish()`'s printed next-step instruction
(`"railway up --service sidecar --detach"`, line 234) should change to `"railway
redeploy --service sidecar -y"` per the Summary finding — `railway up` triggers a full
rebuild from local source (slower, and technically ships "new code" even though the
source is unchanged, which muddies the "no redeploy" success criterion); `railway
redeploy` restarts the existing image only.

### Anti-Patterns to Avoid
- **Assuming "next auto-refresh cycle" means the sidecar re-reads Postgres:** verified
  false — see Summary. Do not plan or implement AUTH-06 verification steps that expect
  the sidecar to pick up new tokens without an explicit restart action.
- **Adding `console.warn`/logging logic inside `packages/core`:** every existing warning
  log in this codebase lives in `apps/*` or `packages/adapters`; core stays pure per
  architecture-boundaries.md §2. Compute the boolean/value in core, log at the adapter.
- **Duplicating the T-24h threshold math in the status route AND the MCP tool:** both
  already call the same `getStatus()` use-case and `toStatusResponse()` mapper — if a
  log-on-crossing side effect is added, wire it once (composition root or a single
  shared wrapper), not copy-pasted into both `status.routes.ts` and `mcp/tools.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| T-24h expiry threshold math | A new duration/countdown utility | `isNearExpiry` + `SEVEN_DAYS_MS`/`WARN_THRESHOLD_MS` constants already in `token-freshness.ts` | Already implemented, already unit-tested (`token-freshness.test.ts` — 5 cases covering the exact boundary), already used by the (now-orphaned) JOB-02 refresh job for the identical warning concept |
| OAuth token exchange | A new Python OAuth client or raw `requests` calls to Schwab's token endpoint | `schwab.auth.get_auth_context` + `schwab.auth.client_from_received_url` (already in `seed_token.py`) | schwab-py is the pinned, tested vendor library (D22); hand-rolling OAuth risks subtle CSRF-state or PKCE bugs the library already handles |
| Restarting the sidecar to pick up new tokens | A custom `/sidecar/reload` HTTP endpoint, a file-watcher, a polling loop inside `main.py` | `railway redeploy --service sidecar` (CLI, no rebuild) | Simplest correct fix for a single-operator, ~weekly-cadence task; a new internal endpoint adds GW-05 audit surface and a new failure mode for marginal UX gain — explicitly flagged as an Open Question rather than silently built |

**Key insight:** almost everything AUTH-05/06 need was already built for JOB-02 (Phase
5) and GW-01/GW-03 (Phase 11) — the risk in this phase is re-deriving logic that already
exists (or worse, re-deriving it *incorrectly*, e.g. assuming a re-read-on-refresh
semantics that the library does not actually implement) rather than extending it.

## Common Pitfalls

### Pitfall 1: Assuming Postgres-write == live sidecar pickup
**What goes wrong:** A plan or UAT step asserts "after running seed_token.py, the
sidecar's /sidecar/chain goes live again" without a restart step, then fails silently in
verification (or worse, appears to work only because the OLD refresh token was still
valid, masking that the NEW one was written but not the one in use).
**Why it happens:** `client_from_access_functions` reads `token_read_func()` exactly
once (schwab-py `auth.py:540`); the in-memory OAuth2Client session never re-reads
Postgres.
**How to avoid:** Every AUTH-06 plan/task and the runbook itself must include an
explicit restart step (`railway redeploy --service sidecar -y`) and a post-restart
verification (`/sidecar/health` reachable + not degraded, per existing `_init_schwab_clients` logging).
**Warning signs:** A UAT script that checks `broker_tokens.refresh_issued_at` was
updated but never checks sidecar behavior post-write.

### Pitfall 2: Logging the T-24h warning inside `packages/core`
**What goes wrong:** ESLint boundary rules / architecture review reject a `console.warn`
call placed inside `token-freshness.ts` or `getStatus.ts`; or, if not caught by lint, it
silently violates the "no node I/O in core" rule and complicates unit testing (would
need to mock console in a pure-function test suite that currently needs zero mocks).
**Why it happens:** The natural code-reading impulse is "the use-case orchestrates, so
log here."
**How to avoid:** Compute `isNearExpiry`/`refreshExpiresIn` in core (pure), log the
warning in the adapter (HTTP route, MCP tool, or a shared wrapper built in the
composition root — see Open Questions for which).
**Warning signs:** Any `import` of `console` inside `packages/core/src/**`.

### Pitfall 3: `AuthExpiredBanner`'s existing trader-only gap
**What goes wrong:** The new amber banner is built to mirror `AuthExpiredBanner`
exactly (trader-only check), silently inheriting a case where the `market` app nears or
hits expiry with zero visible warning — a partially-silent outage for exactly the
scenario Phase 15 exists to prevent.
**Why it happens:** Copy-pasting the existing, working pattern without re-examining its
scope.
**How to avoid:** Decide explicitly (flagged in Open Questions) whether the new amber
state — and ideally the existing red state, though that is pre-existing/out-of-strict-
scope — checks both apps.
**Warning signs:** A test fixture that only ever sets `trader.status` and never
`market.status` to a warning/expired value.

### Pitfall 4: Confusing `railway up` and `railway redeploy`
**What goes wrong:** The runbook (or a plan task) tells the operator to run `railway up
--service sidecar`, which uploads and rebuilds from local source — slower, and
technically inconsistent with "no redeploy," and risks deploying whatever is currently
in the operator's working tree (including unrelated uncommitted changes) rather than the
last-known-good build.
**Why it happens:** `seed_token.py`'s current (uncorrected) instructions already say
this; it is the path of least resistance to copy forward.
**How to avoid:** Use `railway redeploy --service sidecar -y` (restarts the existing
deployment image, no rebuild, no risk of uploading uncommitted local changes) — verified
via Railway CLI installed locally (`railway redeploy --help`) and official docs.
**Warning signs:** Any runbook or code comment instructing `railway up` for a
token-only remediation.

### Pitfall 5: `refreshExpiresIn` semantics ambiguity (seconds vs ISO, null vs always-populated)
**What goes wrong:** Web/MCP consumers disagree on whether `refreshExpiresIn` is always
present (with a large number when far from expiry) or `null` until T-24h — a
type/contract mismatch that only surfaces at integration time.
**Why it happens:** SC1's wording ("includes a non-null `refreshExpiresIn` field")
technically only constrains the *inside-the-window* case; it does not explicitly forbid
a non-null value outside the window too.
**How to avoid:** Lock the representation explicitly in the plan: this research
recommends `null` outside the T-24h window (mirrors D-03's two-state model — the field
IS the alert signal, not a general-purpose countdown) and a non-negative integer
(seconds) inside it, reusing `isNearExpiry`'s existing threshold.
**Warning signs:** A test asserting `refreshExpiresIn` is a fixed non-null value at
T-6-days (i.e. far from expiry) — that would be the always-populated interpretation
diverging from the recommended one.

## Code Examples

### Existing `isNearExpiry` test coverage (extend, don't replace)
```typescript
// Source: packages/core/src/brokerage/domain/token-freshness.test.ts (verbatim, current)
describe("isNearExpiry", () => {
  it("returns false when refresh token is 5 days old", () => {
    // ... fiveDaysAgo fixture
    expect(isNearExpiry(fiveDaysAgo, now)).toBe(false);
  });
  it("returns true when refresh token is exactly 6 days old (threshold)", () => {
    expect(isNearExpiry(sixDaysAgo, now)).toBe(true);
  });
  it("returns true when refresh token is 7 days old (already expired)", () => {
    expect(isNearExpiry(sevenDaysAgo, now)).toBe(true);
  });
  // ... justUnder/justOver boundary cases at the exact 6-day mark
});
```
AUTH-05's new `refreshExpiresIn` tests should follow this exact boundary-testing style
(just-under / exactly-at / just-over the T-24h threshold), consistent with the existing
TDD discipline in this file.

### `seed_token.py` UPSERT (the AUTH-06 write path, already correct)
```python
# Source: apps/sidecar/seed_token.py (verbatim, current UPSERT_SQL + _make_seed_writer)
UPSERT_SQL = """
    INSERT INTO broker_tokens
        (app_id, token_json, access_token, refresh_token,
         issued_at, refresh_issued_at, expires_at, updated_at)
    VALUES
        (%(app_id)s, %(token_json)s,
         pgp_sym_encrypt(%(access)s, %(key)s),
         pgp_sym_encrypt(%(refresh)s, %(key)s),
         %(now)s, %(now)s, %(expires)s, %(now)s)
    ON CONFLICT (app_id) DO UPDATE SET
        token_json        = EXCLUDED.token_json,
        access_token      = EXCLUDED.access_token,
        refresh_token     = EXCLUDED.refresh_token,
        issued_at         = EXCLUDED.issued_at,
        refresh_issued_at = EXCLUDED.refresh_issued_at,
        expires_at        = EXCLUDED.expires_at,
        updated_at        = EXCLUDED.updated_at
"""
```
`refresh_issued_at = %(now)s` on every seed correctly resets the 7-day TTL clock (this
is the intended behavior of a fresh OAuth dance — distinct from `token_store.py`'s
`token_write_func`, which never touches `refresh_issued_at`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `refreshExpiresIn` should be `null` outside the T-24h window and a non-negative integer (seconds) inside it, rather than always-populated. | Common Pitfalls #5, Pattern 1 | If wrong, the web/MCP consumers and their tests would need the opposite representation; low blast radius since this is Claude's Discretion territory and the plan can lock it explicitly at review. |
| A2 | The T-24h warning-log side effect belongs at the HTTP/MCP adapter layer (or a shared composition-root wrapper), not inside `packages/core`. | Open Questions, Pitfall 2 | High confidence (backed by the "no console.warn in core, ever" grep across the whole repo) — flagged as an assumption only because the EXACT choke point (route-level duplication vs. a new shared wrapper) is not locked. |
| A3 | The amber banner should check both `trader` and `market` app freshness (closing the pre-existing trader-only gap in `AuthExpiredBanner`), not mirror the trader-only precedent. | Pattern 2, Pitfall 3 | If the user wants strict scope-minimization (extend only what's asked, don't fix adjacent gaps per CLAUDE.md "surgical changes" rule), this should stay trader-only and the market gap should be captured as a separate backlog item instead. |
| A4 | The operator runbook belongs in a new `docs/operations/` topic directory rather than folding into the existing `docs/architecture/deployment.md`. | Architecture Patterns (Recommended Project Structure) | Low risk — either location satisfies D-02b ("lives in docs/, operator-facing"); `docs/operations/` better matches the docs.md rule's "topic subdirectories" guidance since this is operational/runbook content, not architectural decision content. |

**None of the AUTH-06 pickup-mechanism findings (Summary, Pitfall 1, Pitfall 4) are
tagged `[ASSUMED]`** — they are `[VERIFIED]` via direct reading of
`apps/sidecar/main.py`, the installed `schwab-py==1.5.1` package source
(`site-packages/schwab/auth.py`), `git diff`, and the locally-installed `railway` CLI
(`v4.11.0`) plus its official docs.

## Open Questions (ALL RESOLVED at planning, 2026-07-02)

> Resolutions (provisional, user-reviewable at plan review):
> **Q1 → RESOLVED** in 15-04-PLAN.md: `withRefreshExpiryWarning` getStatus decorator with
> in-process per-app latch (fires on first T-24h crossing, re-arms when `refreshExpiresIn`
> returns to null), wired once in the composition root for both HTTP and MCP.
> **Q2 → RESOLVED** in 15-05-PLAN.md: amber banner checks BOTH apps (worst-case);
> existing red banner's trader-only check fixed only if it is the same 1–2 lines in the
> same component.
> **Q3 → RESOLVED** in 15-02-PLAN.md + ROADMAP note: restart-only via
> `railway redeploy --service sidecar -y` (no code rebuild) accepted as satisfying
> AUTH-06's "without a Railway redeploy"; no new sidecar reload endpoint (D-02
> minimal-attack-surface). Highest-impact provisional decision — flagged for user review.

1. **Where exactly does the T-24h warning-log side effect live?**
   - What we know: it must be an adapter-level (or composition-root) concern, not core;
     both `status.routes.ts` (HTTP) and `apps/server/src/adapters/mcp/tools.ts`
     (`registerStatusTool`, MCP `get_status`) currently call the same `getStatus()`
     use-case independently.
   - What's unclear: whether "a single warning log line" (D-03) means literally
     once-per-process-lifetime (requiring a dedup flag somewhere) or simply "starts
     appearing once the window is entered" (fires on every poll while in-window, no
     dedup state).
   - Recommendation: implement the simplest option consistent with this project's
     existing style (every other `console.warn` in the codebase is un-deduped,
     fire-on-every-call) — log on every `getStatus()` call while `refreshExpiresIn !==
     null`, via a single shared wrapper built once in each app's `main.ts` composition
     root (not duplicated into both adapter files). Confirm with user at plan review
     since "single warning log line" could also be read as requiring true dedup.

2. **Should the market app also gate the (existing red / new amber) banners?**
   - What we know: `AuthExpiredBanner.tsx` currently only checks `tokenFreshness.trader`.
   - What's unclear: whether fixing this is in scope for Phase 15 (which only asks for a
     NEW amber state) or a separate backlog item.
   - Recommendation: at minimum, the NEW amber banner should check both apps (surface
     whichever is closer to expiry) since leaving an identical gap in newly-written code
     is avoidable at near-zero cost; leave the existing red banner's trader-only check
     alone unless the user asks to fix it too (surgical-changes principle).

3. **Is a `railway redeploy`-based restart genuinely acceptable as "without a Railway
   redeploy" (AUTH-06 success criterion)?**
   - What we know: it is the only way, short of a new internal reload endpoint, to make
     the running sidecar pick up a freshly written token; `railway redeploy` does not
     rebuild or ship new code, it restarts the existing deployment image.
   - What's unclear: whether the roadmap author's intent was "no CLI/ops action at all"
     (in which case a new `/sidecar/reload-token` internal endpoint would be needed,
     expanding scope) or "no code build/ship" (satisfied by `railway redeploy`).
   - Recommendation: surface this explicitly at plan review before implementation — it
     is the single highest-impact clarification this research surfaced, since it changes
     whether AUTH-06 needs a new internal HTTP endpoint or just a corrected CLI
     instruction + runbook.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway CLI | Runbook commands (`railway redeploy`, `railway run`) | ✓ | 4.11.0 [VERIFIED: `railway --version`] | — |
| `railway restart` subcommand | (considered, not used) | ✗ | not present in installed CLI 4.11.0 despite being documented at docs.railway.com/cli/restart | Use `railway redeploy --service <name>` instead (functionally equivalent restart-without-rebuild, confirmed present in this CLI version) |
| schwab-py | Sidecar OAuth (already deployed) | ✓ | 1.5.1 (pinned) [VERIFIED: requirements.txt + installed venv] | — |
| Postgres (Supabase) | `broker_tokens` writes | ✓ (assumed reachable — existing prod dependency, unchanged by this phase) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `railway restart` (documented but not present in
installed CLI) — use `railway redeploy --service sidecar` instead, which this research
confirms is available and semantically equivalent (restart-only, no rebuild).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (TS) | Vitest (workspace-mode, `bun run test` → `vitest run`) |
| Framework (Python sidecar) | pytest (`apps/sidecar/pytest.ini`, `testpaths = tests`, `asyncio_mode = auto`) |
| Config file | `vitest.config.ts` (root); `apps/sidecar/pytest.ini` |
| Quick run command (TS, targeted) | `bun test packages/core/src/brokerage/domain/token-freshness.test.ts` |
| Quick run command (Python, targeted) | `cd apps/sidecar && python -m pytest tests/test_token_store.py -x` |
| Full suite command | `bun run test` (TS workspace); `cd apps/sidecar && python -m pytest` (Python) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-05 | `refreshExpiresIn` is `null` outside T-24h window | unit | `bun test packages/core/src/brokerage/domain/token-freshness.test.ts` | ✅ (extend existing file) |
| AUTH-05 | `refreshExpiresIn` is a non-negative integer at exactly 6 days / just-over / just-under boundary | unit (fast-check optional, existing style uses example tests at boundaries) | same as above | ✅ (extend existing file) |
| AUTH-05 | `GET /api/status` response includes `refreshExpiresIn` per app, contract-parses via `statusResponse` | integration | `bun test apps/server/src/adapters/http/status.routes.test.ts` | ✅ (extend existing file) |
| AUTH-05 | Amber banner renders when `refreshExpiresIn !== null` and no `AUTH_EXPIRED` state | unit (React Testing Library) | `bun test apps/web/src/components/AuthExpiredBanner.test.tsx` (or new sibling test file) | ✅ (extend) / ❌ new file if a separate component is chosen — Wave 0 |
| AUTH-05 | Warning log line fires (or not) per Open Question 1's resolved semantics | unit | new test in `status.routes.test.ts` or `main.ts`-level test, asserting `console.warn` called | ❌ Wave 0 — depends on Open Question 1 resolution |
| AUTH-06 | `refresh_issued_at` unchanged by `token_store.token_write_func`, reset by `seed_token.py`'s UPSERT | unit (pytest) | `cd apps/sidecar && python -m pytest tests/test_token_store.py::test_refresh_issued_at_unchanged -x` | ✅ (already exists, already passing — regression-only) |
| AUTH-06 | `seed_token.py`'s pending diff (`interactive=False`, `callback_timeout`) committed and covered | manual / smoke (schwab-py's `client_from_login_flow` opens a real browser — not unit-testable) | N/A — manual-only, justified: requires live Schwab OAuth + browser | manual-only |
| AUTH-06 | Sidecar picks up new tokens ONLY after restart, not before | manual / smoke (requires a live Railway sidecar + real restart) | N/A — manual-only, justified: cannot simulate Railway process lifecycle in CI | manual-only |
| D-04 | `TRIGGERABLE_JOBS` no longer contains `"refresh-tokens"`; has length 3 | unit | `bun test apps/server/src/adapters/http/jobs.routes.test.ts` | ✅ (extend/fix existing assertions at lines 134-142) |

### Sampling Rate
- **Per task commit:** targeted `bun test <file>` / `python -m pytest tests/<file> -x`
- **Per wave merge:** `bun run test` (full TS workspace) + `cd apps/sidecar && python -m pytest` (full Python suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`; AUTH-06's two manual-only
  items (browser-based OAuth dance, live Railway restart) must be exercised at least once
  during human verification since neither is automatable in CI.

### Wave 0 Gaps
- [ ] Decide Open Question 1 (warning-log dedup semantics) before writing its test —
  the test shape depends on the answer.
- [ ] Decide Open Question 2 (market-app banner gating) before writing amber-banner
  tests — affects fixture shape (`makeStatusData`-style helper needs a second-app
  variant either way).
- [ ] No new test framework/config needed — both Vitest and pytest infra already cover
  every automatable behavior in this phase.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Schwab OAuth (authorization-code + refresh grant) — unchanged by this phase; this phase only surfaces expiry state and hardens the existing re-auth CLI, does not add new authentication surface |
| V3 Session Management | no | No new session/cookie surface introduced |
| V4 Access Control | no | No new access-control decision points; `seed_token.py` remains a local/operator-run script, never a server route (D-02 explicitly rejects a web form to avoid exactly this) |
| V5 Input Validation | yes | `appTokenStatus`/`statusResponse` Zod schema extension (`refreshExpiresIn`) — parse-don't-cast at the HTTP boundary, per `typescript.md` rule |
| V6 Cryptography | yes (unchanged) | `pgp_sym_encrypt`/`TOKEN_ENCRYPTION_KEY` — already in place in both `token_store.py` and `seed_token.py`'s UPSERT; this phase does not touch encryption logic, only timestamp/status fields |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token value leakage in logs (the new warning-log line) | Information Disclosure | The new `console.warn` for T-24h crossing must log only `appId` + a computed duration/boolean — never `refreshExpiresIn`'s underlying token material (there is none in this field, but the surrounding log statement must not be extended to include `refreshIssuedAt` raw values carelessly; existing precedent in `token_store.py`/`refreshTokens.ts` logs only `appId` + ISO timestamps, never token strings — follow the same discipline) |
| Runbook accidentally documenting a token value in an example | Information Disclosure | The new `docs/operations/schwab-reauth-runbook.md` must use placeholder redirect URLs (e.g. `<trader_redirect_url>`, matching `seed_token.py`'s own usage docstring) — never a real captured OAuth redirect URL, which contains the authorization `code` query param (a single-use secret) |
| Operator CLI (`seed_token.py`) run with the wrong env (e.g. against prod DB from a laptop with stale/wrong `DATABASE_URL`) | Tampering (wrong-target write) | Existing `require_env()` fails loudly on missing vars; the runbook must instruct running via `railway run --service worker` (as `seed_token.py`'s own docstring already does) so env is Railway-injected, not manually exported, reducing wrong-target risk |

## Sources

### Primary (HIGH confidence — direct source inspection this session)
- `apps/sidecar/main.py` — sidecar lifespan, `_init_schwab_clients`, `_acquire_lock_and_init` (verified: token read happens once per lock acquisition)
- `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/auth.py` (schwab-py 1.5.1, installed package) — `client_from_access_functions` (line 540: `token = token_read_func()`, called once), `client_from_manual_flow` (line 423, blocking `input()`)
- `apps/sidecar/token_store.py`, `apps/sidecar/seed_token.py` — token read/write callback contracts, UPSERT SQL, `_verify_and_finish` instructions
- `git diff apps/sidecar/seed_token.py` — the exact 2-line uncommitted change (`interactive=False`, `callback_timeout`)
- `packages/core/src/brokerage/domain/token-freshness.ts` + `.test.ts` — `isNearExpiry`, `isTokenExpired`, `toAppTokenStatus`, existing threshold constants and boundary tests
- `packages/core/src/brokerage/application/ports.ts`, `packages/core/src/journal/application/getStatus.ts` — `AppTokenStatus`/`StatusPayload` type shapes and use-case wiring
- `packages/contracts/src/status.ts`, `packages/contracts/src/jobs.ts` — `appTokenStatus`/`statusResponse` schemas; `TRIGGERABLE_JOBS` stale entry (D-04 target, line 15)
- `apps/server/src/adapters/mcp/tools/trigger-job.ts`, `apps/server/src/adapters/mcp/tools.ts` — D-04 stale description target; MCP `get_status` registration
- `apps/server/src/adapters/http/status.routes.ts`, `apps/server/src/adapters/status-dto.ts`, `apps/server/src/main.ts` — status route wiring, `toStatusResponse` mapper
- `apps/web/src/components/AuthExpiredBanner.tsx` + `.test.tsx`, `apps/web/src/hooks/useStatus.ts` — existing banner pattern (confirmed trader-only check), polling hook
- `packages/adapters/src/postgres/repos/broker-tokens.ts`, `packages/adapters/src/postgres/memory/broker-tokens.ts` — both confirmed as the only two `toAppTokenStatus` call sites
- `apps/worker/src/main.ts`, `apps/worker/src/schedule.ts`, `apps/server/src/adapters/http/jobs.routes.test.ts` — confirmed `refresh-tokens` job retired (GW-03) but `TRIGGERABLE_JOBS`/test assertions still reference it
- `docs/architecture/deployment.md` (line 61), `docs/architecture/stack-decisions.md` (D22 section) — found the STALE "no deploy, no SSH" claim that this phase's finding contradicts for the current sidecar-owned architecture (this doc predates or wasn't updated for the D22 in-memory-token-on-construction behavior)
- `railway --version` (4.11.0), `railway redeploy --help`, `railway --help` (installed CLI, this session) — confirmed `redeploy` exists and `restart` does not, in this CLI version

### Secondary (MEDIUM confidence — official docs via WebFetch, cross-checked against installed CLI)
- [docs.railway.com/cli/restart](https://docs.railway.com/cli/restart) — describes a `restart` command not present in the installed CLI version; documented behavior (restart without rebuild) is what `redeploy` provides in the installed version instead
- [docs.railway.com/cli/redeploy](https://docs.railway.com/cli/redeploy) — confirms `redeploy` "restarts the most recent deployment... without uploading new code"

### Tertiary (LOW confidence)
- None used as load-bearing claims in this document — all AUTH-06-critical findings were verified via source/library/CLI inspection rather than left at WebSearch-only confidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all reused libraries confirmed via installed venv/requirements.txt
- Architecture (freshness placement, pickup mechanism): HIGH — verified via direct source reading of `main.py`, installed `schwab-py` package source, and existing adapter call sites (not inferred from docstrings/comments alone)
- Pitfalls: HIGH for pitfalls 1/2/4 (source-verified); MEDIUM for pitfall 3/5 (design-judgment calls flagged as Open Questions/Assumptions rather than hard facts)

**Research date:** 2026-07-02
**Valid until:** 30 days (stable domain — no fast-moving external dependency; schwab-py is version-pinned per D22 "never upgrade without research review", so this research remains valid until that pin changes)
