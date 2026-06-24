---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "01"
subsystem: docs
tags: [docs, auth, supabase, architecture-decision]
dependency_graph:
  requires: []
  provides: [D20-supabase-auth-decision]
  affects: [08-07-PLAN.md]
tech_stack:
  added: []
  patterns: [docs-before-code, ADR-lite]
key_files:
  created: []
  modified:
    - docs/architecture/stack-decisions.md
decisions:
  - "D20: Supabase Auth JWT (HS256 offline verify via hono/jwt) + exact-origin CORS is DECIDED for Phase 8"
  - "D18 revisit trigger: Auth removed; only Realtime or cost/limits remains as trigger"
  - "WEB_ORIGIN and SUPABASE_JWT_SECRET are new required env vars for apps/server"
metrics:
  duration: 3
  completed_date: "2026-06-24"
status: complete
---

# Phase 08 Plan 01: Un-defer Supabase Auth — Summary

**One-liner:** Added D20 (Supabase Auth HS256 JWT + exact-origin CORS) to stack-decisions.md, lifting the D18 Auth deferral before any auth code lands.

## What Was Built

This plan satisfies the docs-before-code ordering gate (workflow.md + D-02a). No application code was written.

**Changes to `docs/architecture/stack-decisions.md`:**

1. **New D20 decision table row** — `API auth | Supabase Auth JWT (HS256, offline verify via hono/jwt) + exact-origin CORS | Low | Multi-tenant auth OR provider swap`
2. **New D20 section body** — documents what changed (Auth un-deferred), why (brokerage data becomes internet-reachable when `apps/web` on Vercel reaches the API), how it is implemented (offline HS256 JWT verify via `hono/jwt` using `SUPABASE_JWT_SECRET`; no Supabase SDK; no per-request network call; CORS via `hono/cors` with exact `WEB_ORIGIN` string; CORS middleware before JWT group so OPTIONS preflights pass), scope (read endpoints only; `/api/jobs/*` keeps `bearerAuth` unchanged), new env vars, swap cost (low — middleware seam), and references.
3. **D18 section updated** — Auth removed from the D18 revisit trigger. A short note at the end of D18 says "The Supabase Auth deferral is lifted. See D20."
4. **D18 decision table row updated** — Supabase Auth removed from the "revisit trigger" column; only Realtime and cost/limits remain.
5. **Old deferral wording removed** — The phrase "a concrete need for Supabase Auth" no longer appears as the live deferral status.

## Verification

```
rg -n "Supabase Auth" docs/architecture/stack-decisions.md
  → 7 matches, all in D20 decided context (none in deferred wording)

rg -n "HS256" docs/architecture/stack-decisions.md
  → 3 matches (D20 table row, section header, body)

rg -n "revisit trigger.*concrete need for Supabase Auth" docs/architecture/stack-decisions.md
  → 0 matches (old wording removed)

bun run typecheck  → pass (no code changed)
bun run lint       → pass (no code changed, existing warnings only)
```

## Deviations from Plan

None. Plan executed exactly as written.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Un-defer Supabase Auth in stack-decisions.md | 774bfd3 | docs/architecture/stack-decisions.md |

## Self-Check: PASSED

- [x] `docs/architecture/stack-decisions.md` modified with D20 section and updated D18
- [x] Commit 774bfd3 exists
- [x] Acceptance criteria all met (Supabase Auth in decided context, HS256 recorded, old deferral wording gone, typecheck + lint pass)
- [x] 08-07 (auth middleware) can now cite D20 as a DECIDED decision
