---
phase: 04
slug: schwab-auth-brokerage
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-19
updated: 2026-06-19
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace) + fast-check, msw, testcontainers |
| **Config file** | `vitest.config.ts` per package + root `vitest run` |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~30–90 seconds (testcontainers Postgres adds cold-start for the pgcrypto round-trip) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test` (affected package)
- **After every plan wave:** Run `bun run test && bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green (Docker up for the pgcrypto contract test)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | AUTH-02 | T-04-01 / T-04-SC | Secrets are required config; only field names logged on boot failure; installed packages legitimacy-OK | unit | `bun run typecheck` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | AUTH-02 | — | Pure freshness domain classifies fresh/stale/AUTH_EXPIRED/none_yet | unit | `bun vitest run packages/core/src/brokerage/domain/token-freshness.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | AUTH-02 | T-04-02 | broker_tokens columns typed bytea (encrypted-only) | unit | `bun run typecheck` | ✅ | ⬜ pending |
| 04-01-04 | 01 | 1 | AUTH-02 | T-04-02 | Migration begins with CREATE EXTENSION pgcrypto; bytea columns | grep/unit | `grep -qi pgcrypto .../0003_broker_tokens.sql` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | AUTH-02 | T-04-03 | [BLOCKING] live push: pgcrypto + table exist; second migrate no-op | manual | `bun run migrate` + psql checks | n/a | ⬜ pending |
| 04-02-01 | 02 | 2 | AUTH-01 | T-04-06 / T-04-07 | OAuth client Basic-auth; invalid_grant + invalid_client → typed err, no throw | unit (msw) | `bun vitest run packages/adapters/src/schwab/auth/oauth-client.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | AUTH-02 | T-04-04 / T-04-05 | pgcrypto round-trip; key as bound param; stored bytea ≠ plaintext | integration (testcontainers) | `bun vitest run packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | AUTH-01 | T-04-08 | Refresh rotates on 200; auth-expired on invalid_grant, no half-state | unit (in-memory) | `bun vitest run packages/core/src/brokerage/application/refreshToken.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | AUTH-03 | T-04-11 / T-04-12 | doctor classifies env-missing / callback-mismatch / live-refresh-fail; status reads DB only | unit | `bun vitest run apps/auth/src/doctor.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | AUTH-03 | T-04-09 / T-04-10 / T-04-13 | setup validates state, exchanges immediately, port from registered URL | typecheck | `bun run typecheck && bun run lint apps/auth` | ✅ | ⬜ pending |
| 04-03-03 | 03 | 3 | AUTH-03 | T-04-09..13 | Live setup writes 2 encrypted rows; no secret in CLI output | manual | live CLI run | n/a | ⬜ pending |
| 04-04-01 | 04 | 4 | BRK-01 | — | ObservationRow/SnapshotRow.source accept 'schwab_chain' (type-only) | unit | `bun run typecheck` | ✅ | ⬜ pending |
| 04-04-02 | 04 | 4 | BRK-01 | T-04-14 | Schwab chain flattener → RawChain; malformed JSON → err, no throw; contract test | unit+contract (msw) | `bun vitest run packages/adapters/src/schwab/market/` | ❌ W0 | ⬜ pending |
| 04-04-03 | 04 | 4 | BRK-01 | T-04-16 | selectChainSource → CBOE on market AUTH_EXPIRED / none-yet (D-08) | unit (in-memory) | `bun vitest run packages/core/src/brokerage/application/selectChainSource.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 5 | BRK-02 | T-04-18 / T-04-20 | Trader adapters Zod-parse; failed parse → err not throw; account hash (not number) | unit (msw) | `bun vitest run packages/adapters/src/schwab/trader/` | ❌ W0 | ⬜ pending |
| 04-05-02 | 05 | 5 | BRK-02 | T-04-21 | getPositions/getTransactions use-cases; trader AUTH_EXPIRED pauses reads | unit (in-memory) | `bun vitest run packages/core/src/brokerage/application/getPositions.test.ts packages/core/src/brokerage/application/getTransactions.test.ts` | ❌ W0 | ⬜ pending |
| 04-05-03 | 05 | 5 | BRK-02 | T-04-22 | HTTP route + MCP tool share one contract (MCP-02); read-only only | unit | `bun run test` | ❌ W0 | ⬜ pending |
| 04-06-01 | 06 | 6 | AUTH-04 | T-04-23 | statusResponse union accepts 'none yet' + per-app map (Pitfall 6) | unit | `bun vitest run packages/contracts/src/status.test.ts` | ❌ needs update | ⬜ pending |
| 04-06-02 | 06 | 6 | AUTH-04 | T-04-24 / T-04-25 | getStatus per-app AUTH_EXPIRED; absorbs errors to 'none yet' | use-case (in-memory) | `bun vitest run packages/core/src/journal/application/getStatus.test.ts` | ❌ needs update | ⬜ pending |
| 04-06-03 | 06 | 6 | AUTH-04 | T-04-24 / T-04-26 | Schwab job falls back to CBOE on AUTH_EXPIRED (logged); other jobs run | unit (in-memory) | `bun vitest run apps/worker/src/handlers/fetch-schwab-chain.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/brokerage/domain/token-freshness.test.ts` — freshness classification (04-01)
- [ ] `packages/adapters/src/schwab/auth/oauth-client.test.ts` — msw token exchange + refresh + invalid_grant + invalid_client (04-02)
- [ ] `packages/adapters/src/__contract__/broker-tokens.contract.ts` + `.../repos/broker-tokens.contract.test.ts` — testcontainers + pgcrypto round-trip (04-02)
- [ ] `packages/adapters/src/test/fixtures/schwab-chain.fixture.json` + `chain-adapter.test.ts` + `chain-adapter.contract.test.ts` (04-04)
- [ ] `packages/adapters/src/test/fixtures/schwab-positions.fixture.json` + `schwab-transactions.fixture.json` + `trader-adapter.test.ts` (04-05)
- [ ] `packages/adapters/src/memory/broker-tokens.ts` + `packages/adapters/src/memory/schwab-trader.ts` — in-memory twins (04-01, 04-05)
- [ ] update `packages/contracts/src/status.test.ts` + `packages/core/src/journal/application/getStatus.test.ts` for the per-app union (04-06)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `auth setup` browser → loopback → token exchange | AUTH-01/03 | Real Schwab login + registered callback; not CI-automatable | Run `auth setup trader` + `setup market`, confirm two encrypted rows in broker_tokens |
| Live SPX chain fetch via Schwab market app | BRK-01 | Live authed market app + RTH | Run a chain pull during RTH, confirm leg_observations tagged source='schwab_chain' |
| Live positions/transactions pull | BRK-02 | Funded trader account required | GET /api/positions + MCP get_positions return matching payloads |
| Live AUTH_EXPIRED degradation | AUTH-04 | Requires an actually-expired refresh token (or a seeded 8-day-old row) | Seed an 8-day refresh_issued_at; confirm /api/status flags that app AUTH_EXPIRED while the other stays fresh and the worker logs the CBOE fallback |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 / manual-checkpoint dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (the two manual checkpoints are isolated)
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (set during planning; flip to green during execution as rows complete)
