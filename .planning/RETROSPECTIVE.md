# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — Real-Time Schwab Streaming

**Shipped:** 2026-07-02
**Phases:** 6 (10–15) | **Plans:** 33 | **Commits:** 285 over 8 days

### What Was Built
- Python schwab-py sidecar (3rd Railway service) as the sole Schwab boundary — OAuth, token
  ownership, advisory-locked single streamer, REST proxy; TS auth stack fully retired
- Live LEVELONE_OPTION greeks (BSM-recomputed) + ACCT_ACTIVITY fills → authed SSE fan-out to
  the web Overview, with cold-start reconcile and zero per-tick persistence
- COT weekly + FRED 8-series twice-daily data layers, each with HTTP + MCP + web card
- T-24h re-auth alerting + operator runbook, proven with a live re-auth against prod

### What Worked
- Docs-first phase (10) gave every later phase a stable decision record to cite (D16/D17/D22)
- Strict dependency chain with 13/14 parallel-safe — no cross-phase collisions
- Memory-twin + Postgres contract-pair suites caught adapter drift before deploy
- UAT gates as verification closers: phases 11/12 `human_needed` → closed 5/5 and 6/6 live
- Milestone audit with 3-source cross-reference (VERIFICATION, SUMMARY frontmatter,
  REQUIREMENTS traceability) caught the AUTH-05/06 gap a day before close; Phase 15 closed it

### What Was Inefficient
- Phase 12 UAT was an 8-bug cascade — streaming is untestable offline (CDP can't sever SSE);
  the initScript-wrapped EventSource harness had to be invented mid-UAT
- Railway watch-path SKIPs hit every deploy — each service needed a forced
  `railway up --service X`; cost repeated debugging across phases 8, 11, 14
- GSD STATE.md milestone drift recurred every phase (stale v1.0 progress numbers) — hand-fixed
  each time, including at this close
- Local `bun run migrate` validates ALL worker env (needed SIDECAR_URL just to migrate)

### Patterns Established
- Vendor boundary as sidecar: when a vendor demands single-process ownership (auth + one
  streamer session), isolate it in its own service and make everything else a thin HTTP client
- Opaque short-lived tickets for SSE auth (query-param JWTs leak into logs)
- Single-latch decorator at the composition root for warn-once side effects shared by HTTP + MCP
- `seed_token.py login` browser auto-capture beats two-step exchange (30s code-expiry race)
- Same-name `boss.schedule()` upserts on (name, key) — keyed crons for multi-cadence jobs

### Key Lessons
1. A green suite alone is never sufficient at the verify gate — reused clocks and test doubles
   hid prod bugs repeatedly (v1.0 phases 5–6, v1.1 phase 12). Pair code-review + fast-check +
   testcontainers with live UAT.
2. Verify prod *data provenance*, not just health endpoints — the chain `observedAt +00:00`
   parse bug silently fell back to CBOE for days while everything looked green.
3. Discover undocumented vendor behavior empirically, never from assumptions (ACCT_ACTIVITY
   message types, Schwab code expiry, streamer session limits) — the roadmap flagged these and
   it paid off.
4. Ship the alert surface before you need it: prod still runs the pre-phase-15 image, so the
   re-auth alert built this milestone protects nothing until deployed. Deploy debt compounds.

### Cost Observations
- Model mix / sessions: not tracked this milestone
- Notable: research-heavy phases (12 streaming, 15 re-auth) consumed most wall-clock via live
  UAT cascades, not code volume

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 9 | 76 | Spec-driven GSD + TDD established; UI added late (phases 8–9) |
| v1.1 | 6 | 33 | Docs-first phase 10; UAT gates close human_needed verifications; milestone audit before close |

### Cumulative Quality

| Milestone | Tests | Notes |
|-----------|-------|-------|
| v1.0 | ~1,233 | hexagon + boundary lint enforced from Phase 1 |
| v1.1 | ~1,374 | + Python pytest lane for sidecar |

### Top Lessons (Verified Across Milestones)

1. Green suites hide prod bugs when clocks/doubles are reused — live UAT with distinct
   timestamps is non-negotiable (v1.0 phases 5–6; v1.1 phase 12).
2. Railway deploys SKIP silently on watch-path misses — always force `railway up` per service
   and verify the running image, not the push (v1.0 phase 8; v1.1 phases 11, 14, 15).
