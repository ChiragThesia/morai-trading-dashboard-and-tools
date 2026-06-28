---
phase: 12
slug: streaming-ts-fan-out
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-28
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated by the planner from the 6 PLAN.md `<verify>` blocks + 12-RESEARCH.md
> § Validation Architecture. Confirmed before `/gsd-verify-work`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS: server/contracts/core/adapters/web) + pytest (Python sidecar) |
| **Config file** | `vitest.config.ts` per package · `apps/sidecar/pytest.ini` |
| **Quick run command** | `bun run test --project <pkg> -- <file>` (touched pkg) · `cd apps/sidecar && .venv/bin/python -m pytest tests/<file>` |
| **Full suite command** | `bun run typecheck && bun run lint && bun run test && (cd apps/sidecar && .venv/bin/python -m pytest)` |
| **Estimated runtime** | ~120 seconds full suite (dominated by the testcontainers STRM-04 gate ~30-60s); quick per-package runs ~5-15s |

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched package (the task's `<verify>` line).
- **After every plan wave:** Run the full suite.
- **Before `/gsd-verify-work`:** Full suite green.
- **Max feedback latency:** ~120 seconds (full suite, gated by the testcontainers STRM-04 regression test).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File (test) | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-T1 | 12-01 | 1 | STRM-01 | T-12-01-01/02 | Zod stream-events contract rejects +00:00; no account field in browser-facing schema | contract | `bun run typecheck && bun run test --project contracts -- stream-events` | packages/contracts/src/stream-events.test.ts | ⬜ pending |
| 12-01-T2 | 12-01 | 1 | STRM-01 | T-12-01-03 | recomputeLiveGreek parses OCC + numeric guards, typed skip not NaN/throw (D-02, never raw greeks) | unit + property (fast-check) | `bun run typecheck && bun run test --project core -- recompute-live-greek && bun run test --project adapters -- position-reconciler` | packages/core/src/streaming/recompute-live-greek.test.ts · packages/adapters/src/memory/position-reconciler.contract.test.ts | ⬜ pending |
| 12-01-T3 | 12-01 | 1 | STRM-04 | T-12-SC | Docs-before-code: streaming-fanout ADR records display-only invariant + ticket rationale | docs-check | `test -f docs/architecture/streaming-fanout.md && grep -q "streaming-fanout" docs/TOPIC-MAP.md && grep -qi "opaque" docs/architecture/stack-decisions.md` | docs/architecture/streaming-fanout.md (presence) | ⬜ pending |
| 12-02-T1 | 12-02 | 2 | STRM-01 | T-12-02-04 | 490-cap LRU evicts oldest ad-hoc, never a position leg (D-05) — bounds subscription growth | unit | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_streamer.py -k "subscription or cap or eviction or sync" -x` | apps/sidecar/tests/test_streamer.py | ⬜ pending |
| 12-02-T2 | 12-02 | 2 | STRM-01, STRM-02 | T-12-02-01/02/03 | login-after-lock single session; ACCOUNT stripped + Z-suffixed; no MESSAGE_TYPE filter; type-name-only logs | unit (mocked StreamClient) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_streamer.py -x` | apps/sidecar/tests/test_streamer.py | ⬜ pending |
| 12-04-T1 | 12-04 | 2 | STRM-03 | T-12-04-01/02 | Opaque single-use 30s ticket; replay/expiry → null; record holds no JWT/claim (D-01) | unit | `bun run typecheck && bun run test --project server -- ticket-store` | apps/server/src/adapters/http/ticket-store.test.ts | ⬜ pending |
| 12-04-T2 | 12-04 | 2 | STRM-03 | T-12-04-03 | Fan-out Set + 1/sec coalescer; dead clients removed on aborted + writeSSE-reject (Pitfall 6) | unit | `bun run typecheck && bun run test --project server -- fan-out` | apps/server/src/adapters/http/stream-fan-out.test.ts | ⬜ pending |
| 12-04-T3 | 12-04 | 2 | STRM-04 | T-12-04-04 | leg_observations count unchanged after a streaming-only cycle (no hidden Postgres write) | integration (testcontainers) | `bun run test --project server -- strm04-regression` | apps/server/src/adapters/http/strm04-regression.test.ts | ⬜ pending |
| 12-03-T1 | 12-03 | 3 | STRM-05 | T-12-03-01/03 | Internal SSE drains queue; awaited is_disconnected stop; private-net only (GW-05) | unit (fake Request) | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_stream_proxy.py -x` | apps/sidecar/tests/test_stream_proxy.py | ⬜ pending |
| 12-03-T2 | 12-03 | 3 | STRM-05 | T-12-03-02 | Z-suffixed asOf; 503 AUTH_EXPIRED guard; type-name-only logging (reconcile source) | unit | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_positions_proxy.py -x` | apps/sidecar/tests/test_positions_proxy.py | ⬜ pending |
| 12-03-T3 | 12-03 | 3 | STRM-05 | T-12-03-04 | start_streamer launched only post-lock; routes resolve (not 404) | integration (TestClient) | `cd apps/sidecar && .venv/bin/python -m pytest tests/ -x` | apps/sidecar/tests/test_stream_proxy.py | ⬜ pending |
| 12-03-T4 | 12-03 | 3 | STRM-01 (SC6) | T-12-03-05 | POST /sidecar/subscribe validates OCC (422), 503-guards, uses level_one_option_add NOT subs (Pitfall 11); 490-cap backstop | unit | `cd apps/sidecar && .venv/bin/python -m pytest tests/test_stream_proxy.py -x` | apps/sidecar/tests/test_stream_proxy.py | ⬜ pending |
| 12-05-T1 | 12-05 | 3 | STRM-03, STRM-05 | T-12-05-01/03 | Ticket-guarded SSE (401 on bad ticket); reconcile-first; mint inside JWT group (D-01) | unit/integration (app.request) | `bun run typecheck && bun run test --project server -- stream.routes` | apps/server/src/adapters/http/stream.routes.test.ts | ⬜ pending |
| 12-05-T2 | 12-05 | 3 | STRM-05 | T-12-05-04 | Every sidecar frame Zod safeParsed; malformed dropped (no cast); AUTH_EXPIRED → typed err | unit + msw | `bun run typecheck && bun run test --project server -- sidecar-sse && bun run test --project adapters -- positions-reconciler` | apps/server/src/adapters/http/sidecar-sse.test.ts · packages/adapters/src/sidecar/positions-reconciler.test.ts | ⬜ pending |
| 12-05-T3 | 12-05 | 3 | STRM-03 | T-12-05-02 | SIDECAR_URL required+URL-validated; GET /api/stream outside JWT group, POSTs inside (Pitfall 7); no JWT in URL | unit (config) + integration (placement) | `bun run typecheck && bun run lint && bun run test --project server -- config && bun run test --project server -- stream` | apps/server/src/config.test.ts · apps/server/src/adapters/http/stream.routes.test.ts | ⬜ pending |
| 12-05-T4 | 12-05 | 3 | STRM-01 (SC6) | T-12-05-06 | JWT-gated subscribe proxy; OCC re-validated server-side (400, no sidecar call); 503/502 mapping; no SSE/client | integration (msw) | `bun run typecheck && bun run test --project server -- stream.routes` | apps/server/src/adapters/http/stream.routes.test.ts | ⬜ pending |
| 12-06-T1 | 12-06 | 4 | STRM-03 | T-12-06-01/04 | Hook mints via apiFetch (Supabase JWT); every frame Zod-parsed; subscribeAdHoc POSTs /api/stream/subscribe (not a no-op) | unit (fake EventSource) | `bun run typecheck && bun run test --project web -- useLiveStream` | apps/web/src/hooks/useLiveStream.test.ts | ⬜ pending |
| 12-06-T2 | 12-06 | 4 | STRM-03 | — (presentational) | LiveStatusBadge renders locked Surface 3 tokens; CSS animation rules present | unit/lint/grep | `bun run typecheck && bun run lint && grep -q "live-dot-pulse" apps/web/src/index.css` | apps/web/src/index.css (grep) | ⬜ pending |
| 12-06-T3 | 12-06 | 4 | STRM-01 (SC6) | T-12-06-02 | AdHocPicker parseOccSymbol-validates, calls subscribeAdHoc (POST asserted), AD HOC row goes live; no Phase 9 contract change | unit/integration (web) | `bun run typecheck && bun run lint && bun run test --project web` | apps/web (web suite) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**SC6 end-to-end coverage (BLOCKER closure):** The ad-hoc activation path is verified across three
automated rows — `12-06-T1` (browser POSTs `/api/stream/subscribe`), `12-05-T4` (server JWT-gated
proxy → `/sidecar/subscribe`, msw), and `12-03-T4` (sidecar drives `level_one_option_add` on the
live stream). The live-tick *arrival* for an ad-hoc symbol is RTH-gated (see Manual-Only).

**Note (from RESEARCH):** streaming behaviors (LEVELONE updates within 30s of open, ACCT_ACTIVITY
fill within 10s, SSE auth at edge) are partly **manual/RTH-gated** — see Manual-Only below. The
display-only regression (`SELECT count(*) FROM leg_observations` does not grow during a
streaming-only session, STRM-04) IS automatable and is covered by `12-04-T3`.

---

## Wave 0 Requirements

- [x] No separate Wave 0 scaffolding wave required — every code-producing task is TDD (RED scaffold authored in-task, RED-first before GREEN). Plan **12-01** (wave 1) is the de-facto Wave 0: it authors the `stream-events` Zod contract, `recomputeLiveGreek`, and the `ForReconcilingPositions` port + in-memory twin that all of waves 2-4 parse/test against. No `<verify>` references a test file that its own task does not create.

*Existing infrastructure (vitest workspace + testcontainers Postgres harness + sidecar pytest) covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LEVELONE_OPTION updates logged within 30s of market open | STRM-01 | needs live Schwab stream + RTH | open a position leg, observe sidecar logs at RTH open |
| ACCT_ACTIVITY fill appears within 10s of execution | STRM-02 | needs a live test-account fill | execute a fill in the test account, observe stream |
| ACCT_ACTIVITY MESSAGE_TYPE discovery | STRM-02 | undocumented (RESEARCH) — capture empirically | log raw ACCT_ACTIVITY frames during first RTH UAT |
| Unauthenticated `GET /api/stream` / `POST /api/stream/ticket` rejected at the edge | STRM-03 | full browser EventSource + Supabase session needed for the live edge check (route placement itself is automated in 12-05-T3) | from a logged-out browser, confirm EventSource connect + ticket mint are rejected |
| Ad-hoc OCC symbol streams live BSM greeks (AD HOC row goes live) | STRM-01 expanded (SC6) | the POST path + row-render are automated (12-06-T1/T3, 12-05-T4, 12-03-T4), but real live ticks for the symbol need a live Schwab stream + RTH | at RTH, enter an arbitrary OCC symbol in the picker, confirm its BSM greeks animate over the SSE and the row is visually distinct from owned positions, then clear it |

*Automated where possible; the above are inherently live-market.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — TDD in-task)
- [x] No watch-mode flags
- [x] Feedback latency target set (~120s full suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
