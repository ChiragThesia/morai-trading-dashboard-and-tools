# Phase 04: Schwab Auth & Brokerage - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Schwab brokerage connectivity: a vendored OAuth client for BOTH Schwab apps
(trader + market) via authorization-code + refresh grant; tokens persisted encrypted in
Supabase `broker_tokens` as the single source of truth; an `auth` CLI
(`setup | refresh | status | doctor`); a Schwab **market** adapter behind the existing
`ForFetchingChain` port; a Schwab **trader** adapter (positions, orders, transactions)
behind its ports; and graceful `AUTH_EXPIRED` degradation. Read-only brokerage data —
no order placement/execution this phase. Requirements: AUTH-01..04, BRK-01/02.

</domain>

<decisions>
## Implementation Decisions

### Token storage & encryption (AUTH-02)
- **D-01:** Persist Schwab access + refresh tokens in Supabase `broker_tokens`; one row /
  source of truth read by both server (API) and worker (jobs). These are credentials to
  call **Schwab's** API (not Morai's own API auth).
- **D-02:** Encrypt at rest with **Postgres pgcrypto** (`pgp_sym_encrypt` / `pgp_sym_decrypt`).
- **D-03 (constraint):** The symmetric key **MUST NOT live in the database**. The app passes
  it to pgcrypto at query time from an env/secret (Railway/Supabase secret). Keep the key out
  of query logs (parameterized calls; avoid logging SQL with the key). Rationale: a DB
  dump alone must be useless without the separately-held key (defense in depth — refresh
  tokens are long-lived brokerage-account credentials).

### OAuth setup flow (AUTH-01 / AUTH-03)
- **D-04:** `auth setup` uses a **temporary loopback HTTP listener** matching the registered
  callback to auto-capture the authorization code (opens browser → catches redirect → exchanges
  for tokens). No manual URL paste.
- **D-05 (locked input):** Both Schwab dev apps are **already configured** (client IDs,
  secrets, callback URLs exist). No app-registration work; setup targets the existing
  callback URLs.
- **D-06:** `auth` CLI = `setup | refresh | status | doctor`. `doctor` checks: env
  completeness, callback-URL **exact** match, and a live refresh-grant.

### Chain source priority (BRK-01)
- **D-07:** **Schwab is primary** for NEW journal snapshots (`source = schwab_chain`, authed).
- **D-08:** **CBOE** serves (a) existing history (`source = cboe`) and (b) an **automatic
  fallback** for NEW snapshots ONLY when the Schwab market app is `AUTH_EXPIRED` — so the
  journal never goes stale during a Schwab outage.

### Degradation on invalid_grant (AUTH-04)
- **D-09:** **Per-app** token state — trader and market apps are independent. Market app
  expired → new snapshots fall back to CBOE, Schwab-chain calls pause. Trader app expired →
  positions/orders/transactions pause. The non-expired app keeps working.
- **D-10:** Status surfaces **per-app** freshness (an `AUTH_EXPIRED` flag per app) across
  HTTP `/api/status` + MCP `get_status`.

### Adapters & cross-cutting (BRK-01 / BRK-02)
- **D-11:** Schwab market adapter behind the existing `ForFetchingChain` port (mirror the
  CBOE adapter). Schwab trader adapter behind new ports for positions/orders/transactions.
- **D-12:** Zod-parse every Schwab response at the boundary; a failed parse returns a typed
  `Result.err`, never a throw. MCP-02: every new use-case ships HTTP route + MCP tool together.

### Claude's Discretion
- Exact pgcrypto invocation pattern (key passed via parameter vs session GUC — subject to
  the D-03 "key never in DB / never in logs" constraint), `broker_tokens` column layout,
  vendored OAuth client implementation (AUTH-01 says "vendored"), retry/backoff, adapter
  file naming, and the loopback listener's port/lifecycle.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 4 goal + 5 success criteria
- `.planning/REQUIREMENTS.md` — AUTH-01..04, BRK-01/02 (full text)

### Architecture (source of truth)
- `docs/architecture/data-model.md` — `broker_tokens`, `leg_observations` source tagging
- `docs/architecture/stack-decisions.md` — Schwab two-app rationale, swap-friendly ethos
- `docs/architecture/hexagonal-ddd.md` — ports/adapters dependency law
- `docs/architecture/monorepo-layout.md` — where adapters + the `auth` CLI live
- `docs/architecture/api-design.md` — status payload, `AUTH_EXPIRED` surfacing
- `docs/architecture/jobs.md` — RTH gating; refresh-tokens job (Phase 5 scope)
- `docs/architecture/mcp-and-plugins.md` — MCP-02 HTTP+MCP tool pattern
- `docs/architecture/testing-tdd.md` — msw + testcontainers + in-memory twin pattern

### Existing code to mirror
- `packages/adapters/src/http/` — CBOE market adapter (pattern for the Schwab market adapter)
- `packages/core/` — ports (`ForFetchingChain`, etc.) and use-cases

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- CBOE chain adapter (`packages/adapters/src/http/`): direct template for the Schwab market
  adapter behind `ForFetchingChain`.
- In-memory twins + shared contract-test suite (Phases 1–2): apply to the new Schwab ports.
- Existing `get_status` use-case + `lastJobRuns`/`tokenFreshness` payload: extend with
  per-app `AUTH_EXPIRED`.

### Established Patterns
- Hexagon: `core` imports `shared` only; frameworks/HTTP in adapters; ESLint boundary fails build.
- Zod at every boundary; `Result<T,E>`; no `any` / `as` / `!`.
- TDD red→green; commit at green only. Test: msw for external HTTP, testcontainers for Postgres.
- MCP-02: each use-case ships HTTP route + MCP tool in the same change.

### Integration Points
- New `broker_tokens` read/write adapter (pgcrypto) consumed by server + worker.
- Snapshot/chain job path gains Schwab-primary + CBOE-fallback source selection.
- `/api/status` + MCP `get_status` gain per-app token freshness.

</code_context>

<specifics>
## Specific Ideas

- Read-only brokerage in Phase 4: positions, orders, transactions — NO order placement.
- "Vendored OAuth client" (AUTH-01) — implement/own the OAuth flow rather than a heavy SDK.

</specifics>

<deferred>
## Deferred Ideas

- **Scheduled `refresh-tokens` job (04:00 ET)** → Phase 5 (JOB-02). Phase 4 ships `auth refresh`
  CLI + on-demand refresh only.
- **Order placement / execution** → future (read-only this phase).
- **Web UI for auth status / setup** → v2 (D19, deferred).
- None of the discussion strayed outside the phase domain otherwise.

</deferred>

---

*Phase: 04-schwab-auth-brokerage*
*Context gathered: 2026-06-19*
