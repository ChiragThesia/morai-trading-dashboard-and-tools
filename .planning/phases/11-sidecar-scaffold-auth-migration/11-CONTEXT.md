# Phase 11: Sidecar Scaffold + Auth Migration - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up `apps/sidecar/` (Python, FastAPI + schwab-py v1.5.1) as a third Railway service that
becomes the **sole Schwab authenticator**, retire the TS `refresh-tokens` job, and re-source the
chain-snapshot job through the sidecar's REST proxy (CBOE no-auth fallback retained).

**In scope (Phase 11):** sidecar scaffold + deploy (internal-only) · `client_from_access_functions`
token ownership against the existing `broker_tokens` row · retire TS `refresh-tokens` (sole-writer) ·
`/sidecar/health` + `/sidecar/chain` REST proxy · swap the chain source to the sidecar · Postgres
advisory-lock guard established + tested.

**Out of scope (later phases):** live streamer `login()` / LEVELONE_OPTION / ACCT_ACTIVITY
subscriptions + `GET /api/stream` fan-out (Phase 12) · positions/orders/transactions REST proxy
(Phase 12) · re-auth alert + one-click re-auth (Phase 15, AUTH-05/06).

</domain>

<decisions>
## Implementation Decisions

### REST proxy scope
- **D-01:** **Chain-only this phase.** Build `/sidecar/chain` + `/sidecar/health` only. The TS
  trader adapter (positions/orders/transactions) keeps reading `broker_tokens` and calling Schwab
  directly — the sidecar as sole writer keeps that row fresh, so direct *data* calls don't go stale
  (only the *refresher* moves). positions/orders/transactions get proxied in **Phase 12**, where
  `/sidecar/positions` is already needed for stream reconcile (STRM-05). Matches the Phase 11 goal +
  SC3; smallest safe diff. (Note: GW-02 as written lists all four endpoints — Phase 11 delivers the
  chain slice of GW-02; the rest lands in Phase 12.)

### Auth bootstrap & token store
- **D-02:** **Seed from `broker_tokens` via `client_from_access_functions`** — schwab-py's
  recommended DB-backed pattern (verified against its docs). `token_read_func`/`token_write_func`
  bind to the existing `broker_tokens` row (GW-01: no schema change, no token file); schwab-py calls
  the write func on every auto-refresh (the sole-writer hook, GW-03). **The exact mapping is left to
  research** — schwab-py advises storing its token object as an *opaque JSON blob* ("don't inspect
  it"), which collides with (a) GW-01's no-schema-change discrete columns and (b) the chain-only
  decision where TS still reads the discrete `access_token`. Research picks: decompose into existing
  columns (against schwab-py advice; needs a pinned lib + round-trip contract test) vs. add one
  `token_json` blob column (relaxes GW-01) vs. another shape — against schwab-py v1.5.1's real token
  object. `refresh_issued_at` anchors the 7-day TTL (reuse Phase 4 P02's decision; never reset on
  access-token rotation).
- **D-03:** **First prod activation requires a one-time fresh OAuth dance** — the current prod token
  is expired (prod-deploy-debt). Steady-state needs no re-dance while the token is valid; the dead
  prod token forces one fresh `client_from_login_flow` / `client_from_manual_flow` at go-live.

### Auth ownership
- **D-04:** **Sidecar owns the OAuth dance going forward** (schwab-py login flow = setup + refresh).
  The TS `apps/auth` setup/refresh client is **retired** (D16 superseded — "TS OAuth client
  retired"). All Schwab auth consolidates in one process (the milestone's whole point). Phase 15
  productizes the one-click re-auth (AUTH-06).

### Two-app model (trader + market)
- **D-05:** **Sidecar owns BOTH Schwab apps** — preserve the existing two-app OAuth model (separate
  `trader` and `market` `broker_tokens` rows; worker reads `market` for the chain, `trader` for
  positions). Sidecar runs two schwab-py clients (one per app); **no collapse to a single app.**
  (User did not flag this for discussion — captured as the safe default; **research should confirm**
  two `client_from_access_functions` clients is the clean shape.)

### Cutover
- **D-06:** **Hard cut — one release.** Deploy the sidecar, retire the TS `refresh-tokens` job, and
  switch the chain source in a single release. No runtime feature-flag and no rehearsed rollback
  runbook beyond the **inherent CBOE fallback** that `selectChainSource` already provides for chain
  continuity. (GW-03 forbids a dual-refresher window, so refresh can't be parallel-run regardless.)

### Dev / CI
- **D-07:** **`bun run dev` auto-spawns the sidecar** (docker/process) alongside server+web+worker
  for full local parity. Vitest **still uses an in-memory HTTP twin** behind the brokerage port
  (hexagon non-negotiable — TS tests never depend on a live Python service); auto-spawn governs the
  dev *runner*, not unit tests. CI gets a **separate Python/pytest lane** for `apps/sidecar`.

### Contract surface
- **D-08:** **Adapter-local Zod, reuse the chain shape.** The new sidecar HTTP-client adapter
  `safeParse`s `/sidecar/chain` into the existing `ForFetchingChain` port type and `/sidecar/health`
  locally — schemas live in `packages/adapters` next to the adapter, exactly like
  `SchwabChainResponseSchema` / `http/cboe.ts` today (`safeParse → Result.err`, never throw).
  **Nothing new in `packages/contracts`.** The Python side mirrors the shapes manually, pinned by a
  contract test in the CI Python lane.

### Claude's Discretion
- **Advisory-lock / streamer scope → lock-only this phase.** Phase 11 establishes + tests the
  Postgres advisory-lock guard around the *future* `login()` call site (two instances → second fails
  to acquire → logs a clear error), but does **not** open a live Schwab streamer session — there are
  no subscriptions until Phase 12. This decouples Phase 11 go-live from a streamer-capable token; the
  single-session invariant is a property of the lock, fully testable without a live stream. **SC5
  interpretation:** verify "second instance fails to acquire the lock + logs a clear error" rather
  than "fails to open a second live Schwab stream." Tension flagged for research/verifier alignment.
- **`/api/status` token freshness — no new source.** Keep reading `broker_tokens` freshness; the
  sidecar keeps that row fresh as sole writer. SC2 still applies: `refresh-tokens` disappears from
  `lastJobRuns` once retired.
- **Advisory-lock acquisition failure → log clear error + refuse to start the streamer** (never open
  a second session).

### Carried forward / locked by requirements (not re-discussed)
- **GW-01:** token store = existing `broker_tokens` row, pgcrypto, no schema change, no token file.
- **GW-03:** TS `refresh-tokens` retired *before* sidecar refresh activates; sidecar = sole writer.
- **GW-05:** sidecar internal-only, no public ingress; only `apps/server` reaches it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked decisions feeding this phase
- `docs/architecture/stack-decisions.md` §D22 — Python schwab-py sidecar: third Railway service,
  FastAPI + schwab-py, `client_from_access_functions`, internal-only. **Primary locked decision.**
- `docs/architecture/stack-decisions.md` §D16 — superseded: TS OAuth client + `refresh-tokens`
  retired.
- `docs/architecture/stack-decisions.md` §D17 — lifted (v1.1): sidecar streams position legs + fills
  (Phase 12 consumes this).
- `docs/architecture/overview.md` — hexagon source of truth (ports/adapters, dependency law).

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — GW-01..05, JRNL-02 definitions (and STRM-*/AUTH-05/06 for boundary).
- `.planning/ROADMAP.md` §"Phase 11" — goal, success criteria, research flags (Railway private-net;
  500-symbol streamer cap).
- `.planning/PROJECT.md` — milestone v1.1 context (single-auth gateway, swap costs, key context).

### Library
- https://schwab-py.readthedocs.io/en/latest/auth.html — `client_from_access_functions`
  (`token_read_func`/`token_write_func`, write-on-refresh, "store opaque — don't inspect"),
  `client_from_login_flow` / `client_from_manual_flow` initial mint. The chosen token mechanism.

### Prior art
- `docs/trade-advisor-inventory.md` — working Schwab OAuth / BSM / CBOE / journal-rebuild to re-home,
  not reinvent.

### Code touchpoints (read before planning the diff)
- `packages/core/src/brokerage/application/selectChainSource.ts` — Schwab→CBOE fallback selector; the
  sidecar chain becomes the new `schwabFetchChain` input, CBOE fallback unchanged.
- `apps/worker/src/main.ts` — `marketGetAccessToken` + chain wiring (swap to sidecar client);
  `traderGetAccessToken` (stays TS-direct this phase).
- `apps/worker/src/schedule.ts` — `refresh-tokens` queue + `TRACKED_JOBS` (retire, GW-03/SC2).
- `packages/adapters/src/schwab/market/chain-adapter.ts` + `packages/adapters/src/http/cboe.ts` —
  the `safeParse`-at-boundary vendor pattern the sidecar client mirrors.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`selectChainSource` (core):** Schwab-primary / CBOE-fallback selector already in place — the
  sidecar HTTP-client adapter slots in as `schwabFetchChain`; CBOE fallback path is untouched and is
  the cutover safety net (D-06).
- **`ForFetchingChain` port + in-memory twins:** the sidecar client implements this existing port;
  reuse the established in-memory-twin pattern for Vitest (D-07).
- **`broker_tokens` repo (pgcrypto, per-app rows):** `readTokens("trader"|"market")` already exists;
  the sidecar's `token_read`/`token_write` callbacks bind here (D-02, D-05).
- **Vendor-response parse pattern:** `SchwabChainResponseSchema.safeParse` / `http/cboe.ts` —
  `safeParse → Result.err`, never throw; the sidecar adapter copies this exactly (D-08).

### Established Patterns
- **Adapters own vendor-response Zod parsing** (not `contracts`); boundary `safeParse → Result.err`.
- **Every driven port has an in-memory twin** (hexagon) — mandatory for the sidecar client.
- **`refresh_issued_at` anchors the 7-day refresh-token TTL** (Phase 4 P02); never reset on
  access-token rotation — the sidecar token callbacks must preserve this.
- **Dockerfile-per-service Railway deploy** (Phase 1 deploy lessons) — the sidecar ships its own
  Dockerfile; session-pooler caveat for any DB connection it makes.

### Integration Points
- New `apps/sidecar/` (FastAPI + schwab-py v1.5.1), third Railway service, internal private network
  only (GW-05), reachable solely by `apps/server`.
- Chain re-source: worker `fetch-schwab-chain` → sidecar `/sidecar/chain` via the new client adapter;
  CBOE fallback on AUTH_EXPIRED/unreachable (JRNL-02/SC3).
- `refresh-tokens` removal: `apps/worker/src/schedule.ts` + `TRACKED_JOBS` + `main.ts` wiring + the
  `schedule.test.ts` expectations (drops from 6 scheduled jobs to 5).

</code_context>

<specifics>
## Specific Ideas

- schwab-py `client_from_access_functions` is the **library-recommended** DB-token pattern (user
  verified the docs in-session). Its "store the token opaquely, don't inspect" guidance is the source
  of the D-02 mapping tension — pin **schwab-py v1.5.1** (per D22) so the token-object shape is stable
  and guard it with a round-trip contract test.
- **Railway private networking:** prefer the internal URL (no egress cost) for server→sidecar; the
  sidecar has no public route. Confirm the binding/hostname at infra setup (ROADMAP research flag).
- **500-symbol streamer cap:** confirm on the Schwab Developer Portal; subscriptions are legs-only
  regardless — but that's Phase 12 work, surfaced here only so the advisory-lock guard is sized right.
- **One-time prod re-dance** at go-live (dead prod token) — fold into the deploy runbook alongside the
  carried prod-deploy-debt (fix `DATABASE_URL`, redeploy).

</specifics>

<deferred>
## Deferred Ideas

- **positions/orders/transactions REST proxy** → Phase 12 (co-located with `/sidecar/positions`
  stream reconcile, STRM-05). Completes GW-02.
- **Live streamer `login()` + LEVELONE_OPTION / ACCT_ACTIVITY subscriptions + `GET /api/stream`
  fan-out** → Phase 12 (STRM-01..05). Phase 11 only establishes the advisory-lock guard.
- **Collapsing the two-app model to one Schwab app** → not pursued; keep trader + market (D-05).
- **Re-auth alert (T-24h) + one-click/operator re-auth** → Phase 15 (AUTH-05/06).
- **Runtime feature-flag for chain-source toggle** → rejected (D-06); CBOE fallback covers continuity.

None of these are dropped — each has a named home.

</deferred>

---

*Phase: 11-sidecar-scaffold-auth-migration*
*Context gathered: 2026-06-25*
