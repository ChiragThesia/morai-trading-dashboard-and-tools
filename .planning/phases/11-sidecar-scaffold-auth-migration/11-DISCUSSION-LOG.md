# Phase 11: Sidecar Scaffold + Auth Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 11-sidecar-scaffold-auth-migration
**Areas discussed:** REST proxy scope, Auth bootstrap, Auth ownership, Cutover & rollback, Sidecar dev/CI, Advisory-lock / streamer scope, Sidecar contract surface

---

## REST proxy scope

| Option | Description | Selected |
|--------|-------------|----------|
| Chain-only now | `/sidecar/chain` + `/sidecar/health` only; positions/orders/transactions stay TS-direct, proxied in Phase 12 with stream reconcile | ✓ |
| Full GW-02 now | All four proxy endpoints; every TS Schwab adapter becomes a thin HTTP client this phase | |
| Let Claude decide | Defer to research | |

**User's choice:** Chain-only now (recommended).
**Notes:** Grounded in the finding that TS reads `broker_tokens` directly in worker/server/backfill; sole-writer sidecar keeps that row fresh so direct data calls don't break — only the refresher moves.

---

## Auth bootstrap (token store mechanism)

| Option | Description | Selected |
|--------|-------------|----------|
| Seed from broker_tokens | `client_from_access_functions` callbacks map the existing row ↔ schwab-py token | |
| Always fresh dance | Re-auth on every deploy | |
| Let research decide the mapping | Capture the opaque-blob-vs-discrete-column tension; research picks against schwab-py v1.5.1 | ✓ |

**User's choice:** "How does pyschwab suggest we do this?" → researched in-session, then **Let research decide the mapping**.
**Notes:** schwab-py docs confirm `client_from_access_functions` is the recommended DB-token pattern and advise storing the token object *opaquely* ("don't inspect it"). That collides with GW-01 (no schema change, discrete columns) + chain-only (TS still reads discrete `access_token`). The steady-state mechanism (seed from `broker_tokens`) is locked; the exact column-vs-blob mapping is deferred to the phase researcher. One-time fresh OAuth dance required at first prod activation (dead prod token).

---

## Auth ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Sidecar owns it; retire TS auth | schwab-py runs setup + refresh; TS `apps/auth` setup/refresh retired (D16) | ✓ |
| Keep TS apps/auth CLI | Retire only the job; keep TS CLI as operator fallback until Phase 15 | |
| Let Claude decide | Defer | |

**User's choice:** Sidecar owns it; retire TS auth (recommended).
**Notes:** Consolidates all Schwab auth in one process — the milestone's intent. Phase 15 productizes one-click re-auth (AUTH-06).

---

## Cutover & rollback

| Option | Description | Selected |
|--------|-------------|----------|
| Staged: CBOE fallback + rollback runbook | Lean on existing CBOE fallback + documented redeploy rollback | |
| Hard cut (one release) | Deploy sidecar + retire TS refresh + switch chain source in one release | ✓ |
| Runtime feature-flag toggle | Env flag to switch chain source without redeploy | |

**User's choice:** Hard cut (one release).
**Notes:** CBOE fallback via `selectChainSource` remains the inherent safety net for chain continuity. GW-03 forbids a dual-refresher window, so refresh can't be parallel-run regardless.

---

## Sidecar dev/CI

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory twin + opt-in dev:sidecar | Vitest twin; `bun run dev` does not auto-spawn Python | |
| Auto-spawn sidecar in bun run dev | `bun run dev` launches the Python sidecar for full local parity | ✓ |
| Prod-only sidecar | No local sidecar; only CI/prod | |

**User's choice:** Auto-spawn sidecar in `bun run dev`.
**Notes:** Vitest still uses the in-memory HTTP twin behind the brokerage port (hexagon non-negotiable — captured as compatible, not contradictory). Auto-spawn governs the dev runner only. Separate Python/pytest CI lane for `apps/sidecar`.

---

## Advisory-lock / streamer scope

| Option | Description | Selected |
|--------|-------------|----------|
| Lock-only, defer login() to Phase 12 | Establish + test the advisory-lock guard around the future login() call site; no live stream | |
| Lock + live login() in Phase 11 | Open a real Schwab streamer session (no subscriptions) to prove SC5 literally | |
| Let Claude decide | Resolve against SC5 + the Phase 12 dependency | ✓ |

**User's choice:** Let Claude decide → captured as **lock-only** (Claude's discretion).
**Notes:** Lock-only decouples Phase 11 go-live from a streamer-capable token; the single-session invariant is a property of the lock, testable without a live stream. SC5 verification reads as "second instance fails to acquire the lock + logs a clear error." Tension flagged for research/verifier alignment.

---

## Sidecar contract surface

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter-local Zod, reuse chain shape | safeParse `/sidecar/chain` into `ForFetchingChain`; schemas in `packages/adapters`, like SchwabChainResponseSchema/CBOE | ✓ |
| Promote to packages/contracts | First-class shared `sidecarChain`/`sidecarHealth` contracts | |

**User's choice:** Adapter-local Zod, reuse chain shape (recommended).
**Notes:** Confirmed against the codebase — vendor responses are `safeParse`d inside adapters today (`safeParse → Result.err`, never throw); nothing sidecar-shaped exists in `contracts`. Python side mirrors shapes manually, pinned by a CI contract test.

---

## Two-app model (trader + market) — not selected for discussion

User did not select this area. Captured as the safe default in CONTEXT.md (D-05): the sidecar owns
both Schwab apps as two `client_from_access_functions` clients; two `broker_tokens` rows preserved;
no collapse. Flagged for research to confirm the two-client shape.

## Claude's Discretion

- **Advisory-lock scope:** lock-only in Phase 11; defer live streamer `login()` to Phase 12.
- **`/api/status` token freshness:** keep reading `broker_tokens` (sidecar keeps it fresh) — no new source.
- **Advisory-lock acquisition failure:** log a clear error + refuse to start the streamer (no second session).

## Deferred Ideas

- positions/orders/transactions REST proxy → Phase 12 (completes GW-02).
- Live streamer login() + subscriptions + `GET /api/stream` fan-out → Phase 12 (STRM-01..05).
- Collapsing the two-app model to one app → not pursued.
- Re-auth alert (T-24h) + one-click re-auth → Phase 15 (AUTH-05/06).
- Runtime feature-flag chain-source toggle → rejected (CBOE fallback covers continuity).
