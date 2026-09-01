# Requirements: Morai Journal

**Defined:** 2026-08-29
**Core Value:** The ledger is correct across rolls and settlements — the sum of realised P&L over any
window equals the broker's cash delta over that same window, checked every ingest cycle.

**Scope:** Backend only. No rendered UI this milestone. Every requirement below is satisfied by an
API, a job, or a stored invariant.

---

## v1 Requirements

### Identity and access

- [x] **AUTH-01**: Admin can create a user account and issue a single-use setup link
- [x] **AUTH-02**: User can set their password from that link, which is consumed on first use and never works twice
- [x] **AUTH-03**: User can log in with username and password and stay logged in across sessions
- [x] **AUTH-04**: User can log out, invalidating the session server-side rather than only client-side
- [x] **AUTH-05**: Admin can reset a user's password without any email service in the loop
- [ ] **AUTH-06**: User can delete their own account, purging their data and destroying their data key
- [x] **AUTH-07**: No endpoint returns one user's trading data to another user, including to the admin
- [x] **AUTH-08**: Every privileged read of user data writes an audit entry naming reader, subject, and time

### Encryption

- [ ] **CRYPT-01**: Each user gets a data key at account creation, wrapped by a master key held outside the database
- [ ] **CRYPT-02**: Prices, quantities, P&L, and free-text entry fields are stored encrypted under that user's key
- [ ] **CRYPT-03**: The plaintext column set is explicit and documented with the reason each column must stay readable
- [ ] **CRYPT-04**: The master key can be rotated without re-encrypting any user's trade data
- [ ] **CRYPT-05**: A database dump taken without the master key yields no readable price, quantity, or P&L

### Schwab connection

- [x] **CONN-01**: User can connect their own Schwab account through an OAuth flow they start themselves
- [x] **CONN-02**: The OAuth CSRF state is a single-use, TTL'd server-side nonce consumed by one atomic delete
- [x] **CONN-03**: An OAuth code and its redirect URL never appear in a log, an error response, or a response body
- [x] **CONN-04**: User can read their connection health as healthy, expiring-soon, or expired, with an `expires_at`
- [x] **CONN-05**: User can re-authorise an expired connection themselves, repairing the existing connection record rather than creating a second one
- [x] **CONN-06**: A token refresh holds a lock scoped to that one user, so one user's refresh never blocks or corrupts another's
- [x] **CONN-07**: User can see when their connection last synced successfully, so a silent gap is a queryable fact

### Ingest

- [ ] **INGEST-01**: The system pulls each connected user's fills from Schwab on a schedule
- [ ] **INGEST-02**: A raw fill is stored immutably as the broker reported it, including its signed amount and its position effect
- [ ] **INGEST-03**: Re-running ingest over an overlapping window is a no-op past the first successful write
- [ ] **INGEST-04**: User can trigger a re-sync manually, and running it repeatedly is safe
- [ ] **INGEST-05**: A user connecting for the first time gets existing open positions and recent history backfilled, not only fills from that moment forward
- [ ] **INGEST-06**: User can see what a sync did — when it ran, how many fills landed, and what errored

### The ledger

- [x] **LEDGER-01**: Events are derived from stored fills and are never the primary source of truth
- [x] **LEDGER-02**: A fill's OPEN/CLOSE role is classified from the broker's own `positionEffect`, never from a position's current status
- [x] **LEDGER-03**: A fill on a contract shared by two positions resolves via the other legs in the same broker order, and stays unresolved rather than guessed when no single anchor exists
- [ ] **LEDGER-04**: A ROLL stores its open debit and its close credit as two separate fields, with a database constraint making a netted-only value impossible to store
- [ ] **LEDGER-05**: A position's closed state is derived from net quantity per leg, never from a stored status column
- [ ] **LEDGER-06**: A SETTLEMENT event is generated from a leg's expiry and strike, with no fill required
- [ ] **LEDGER-07**: Settlement style is recorded per leg, so a PM-settled SPXW front leg and an AM-settled SPX back leg coexist inside one position
- [x] **LEDGER-08**: Every money field's unit is fixed by its type, so passing index points where dollars are expected fails type-check
- [x] **LEDGER-09**: Re-deriving the events for a broker order is idempotent and produces the same result as the first derivation
- [ ] **LEDGER-10**: A campaign — a chain of rolled positions — is a read model computed from events, not a separately maintained table
- [x] **LEDGER-11**: The 13-calendar oracle passes, including the shared-front-leg case and the stale-status case
- [x] **LEDGER-12**: Recompute is a pure function of stored fills and makes no broker call

### Reconciliation

- [ ] **RECON-01**: The sum of realised P&L over a window equals the broker's cash delta over that window, net of transfers
- [ ] **RECON-02**: That check runs automatically every ingest cycle as a test, not as a displayed number
- [ ] **RECON-03**: User can query reconciliation status cheaply, and a failure names the failing window
- [ ] **RECON-04**: When reconciliation fails, the API reports the failure and marks dependent numbers untrustworthy

### The pre-commitment record

- [ ] **INTENT-01**: User records a thesis before the position opens
- [ ] **INTENT-02**: User records an invalidation condition as a structured if-then trigger before the position opens
- [ ] **INTENT-03**: User records an exit plan with a numeric profit target and a numeric stop before the position opens
- [ ] **INTENT-04**: User records a planned DTE window as two integers before the position opens
- [ ] **INTENT-05**: User records the combo mid at submit and the net price submitted
- [ ] **INTENT-06**: Entry-intent fields cannot be edited once the position opens, enforced structurally rather than by convention
- [ ] **INTENT-07**: User records a plan-followed yes/no plus one sentence at close
- [ ] **INTENT-08**: Tags come from a closed vocabulary of four — structure, entry trigger, exit reason, plan-followed — and free text is rejected

### Snapshot capture

- [ ] **SNAP-01**: Every open position is repriced and snapshotted on a 30-minute RTH cadence
- [ ] **SNAP-02**: A slot with no market data stores an explicit gap, never a fabricated, interpolated, or carried-forward value
- [ ] **SNAP-03**: A gap can be healed by a later real observation; a real observation is never replaced by a gap
- [ ] **SNAP-04**: The snapshot writer ships with a runnable repair path that rebuilds snapshots from raw observations
- [ ] **SNAP-05**: Capture runs for a user whose connection is healthy and records an honest gap for one whose is not

### API surface

- [ ] **API-01**: Reconciliation status is its own lightweight endpoint, cheap enough to poll before rendering anything
- [ ] **API-02**: Campaign view returns one row per campaign with its roll events nested underneath
- [ ] **API-03**: Drift is queryable — positions held past their stated DTE window, exits that overrode the declared stop, sizes outside the declared cap
- [ ] **API-04**: A cohort's numbers are returned alongside the user's own trailing baseline
- [ ] **API-05**: No ratio is returned with statistical confidence language attached to it
- [ ] **API-06**: User can export their complete data losslessly as JSON, and tabular objects as CSV
- [x] **API-07**: Every response is validated against a typed schema before it leaves the process

### Engineering and operations

- [x] **OPS-01**: The type checker runs in strict mode and fails the build on any `Any`, `cast`, or unjustified ignore
- [x] **OPS-02**: Every test is written before the implementation it covers
- [x] **OPS-03**: Money values round-trip Python ↔ Postgres ↔ JSON with no precision loss
- [x] **OPS-04**: The system runs as separate web and worker processes in Railway containers against Postgres
- [ ] **OPS-05**: A batch insert never exceeds the Postgres bind-parameter ceiling
- [x] **OPS-06**: Mutation testing runs against the ledger and reports surviving mutants

---

## v2 Requirements

Deferred. Tracked, not in this roadmap.

### Snapshot analytics

Capture ships in v1 precisely so these become possible later on data that already exists.

- **ATTR-01**: Greek attribution per snapshot interval, summed across the campaign, with the residual on its own line
- **ATTR-02**: MAE and MFE computed by full spread reprice, never inferred from spot movement
- **ATTR-03**: Combo effective spread against the mid at submit, in dollars and percent
- **ATTR-04**: Portfolio net vega and gamma against account equity
- **ATTR-05**: Theta captured versus theta expected, net of delta and vega P&L

### Connection convenience

- **CONN-08**: Catch-up sync triggered automatically on a successful re-auth
- **CONN-09**: Admin-facing view of which users are stale, showing connection health only and never trade data

### Portability

- **API-08**: Sync-run history beyond the minimum needed to debug a reconciliation failure

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| A rendered UI | Deferred by decision. Backend ships first; the UI is designed separately from a prompt handed to Claude Design once the API is stable. |
| Order execution of any kind | The advise/execute boundary held across three v1 milestones and is structural (`NN-37`). No order-placing port exists anywhere. |
| The analyzer, picker, ranking engine, GEX | A different product surface. Three measurements are owed before ranking returns. |
| CBOE chain ingest, dual-source breadth | The journal needs marks for the user's own open legs. Schwab supplies those per-user. Breadth is an analyzer requirement. |
| Zero-knowledge encryption | Incompatible with unattended snapshots and with running reconciliation while nobody is logged in. Rejected explicitly rather than half-built. |
| Group leaderboard, anonymised cross-user stats | Structurally incompatible with per-user keys and no-cross-user-read. Also arithmetically defeated at n=4-5: a group average plus your own number back-solves everyone else's. |
| Admin impersonation, "view as user" | It *is* a privileged cross-user read path, dressed as a support tool. Conflicts with AUTH-07 directly. |
| Self-serve public signup | No growth goal. The user set is fixed and known. It is also unnecessary attack surface on a system holding brokerage credentials. |
| Email infrastructure | None exists or is planned. Building around an assumed email channel builds a channel that sits unused. |
| RBAC, roles, permission matrix | Every user is a peer owning exactly their own data. One `is_admin` boolean covers the whole need. |
| Billing, plans, quotas, metering | Nothing to bill. |
| SSO, third-party auth, MFA | Four to five accounts provisioned by hand. The security budget is better spent on the encryption and audit posture already required. |
| Outbound webhooks | No third-party consumer exists. The polling status endpoint is already scoped. Add one when a second consumer actually appears. |
| Form 8949 tax export | SPX and SPXW are IRC Section 1256 contracts — marked to market, 60/40 treatment, reported on **Form 6781**. An 8949-shaped export would hand the user the wrong form. Any tax export needs a tax professional's sign-off, not a web search. Deferred to v2+. |
| Win rate as a headline, Sharpe, profit factor, Sortino, Calmar, percentage of max profit, rolling ROI on margin, per-leg slippage, per-trade Kelly | Each is specifically misleading for this structure, with the mechanism recorded per metric in `trading-journal-research.md` §6. |
| A letter grade, an emotion field, a conviction score graded against outcomes | Zero-validity environment. Grading them produces noise dressed as insight. |
| Confidence language on any ratio | Separating a true 55% win rate from a coin flip needs ~783 closed trades. This book produces dozens a year. |
| Automated weight fitting, rule optimisation, ML regime classification | The sample cannot support the estimate. |
| Screenshots, free-text tags | Both are named failure modes in the research. |

---

## Traceability

Mapped during roadmap creation. See `.planning/ROADMAP.md` for phase goals and success criteria.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 3 | Pending |
| AUTH-07 | Phase 2 | Complete |
| AUTH-08 | Phase 2 | Complete |
| CRYPT-01 | Phase 3 | Pending |
| CRYPT-02 | Phase 3 | Pending |
| CRYPT-03 | Phase 3 | Pending |
| CRYPT-04 | Phase 3 | Pending |
| CRYPT-05 | Phase 3 | Pending |
| CONN-01 | Phase 4 | Complete |
| CONN-02 | Phase 4 | Complete |
| CONN-03 | Phase 4 | Complete |
| CONN-04 | Phase 4 | Complete |
| CONN-05 | Phase 4 | Complete |
| CONN-06 | Phase 4 | Complete |
| CONN-07 | Phase 4 | Complete |
| INGEST-01 | Phase 6 | Pending |
| INGEST-02 | Phase 6 | Pending |
| INGEST-03 | Phase 6 | Pending |
| INGEST-04 | Phase 6 | Pending |
| INGEST-05 | Phase 6 | Pending |
| INGEST-06 | Phase 6 | Pending |
| LEDGER-01 | Phase 5 | Complete |
| LEDGER-02 | Phase 5 | Complete |
| LEDGER-03 | Phase 5 | Complete |
| LEDGER-04 | Phase 3 | Pending |
| LEDGER-05 | Phase 7 | Pending |
| LEDGER-06 | Phase 7 | Pending |
| LEDGER-07 | Phase 7 | Pending |
| LEDGER-08 | Phase 1 | Complete |
| LEDGER-09 | Phase 5 | Complete |
| LEDGER-10 | Phase 7 | Pending |
| LEDGER-11 | Phase 5 | Complete |
| LEDGER-12 | Phase 5 | Complete |
| RECON-01 | Phase 9 | Pending |
| RECON-02 | Phase 9 | Pending |
| RECON-03 | Phase 9 | Pending |
| RECON-04 | Phase 9 | Pending |
| INTENT-01 | Phase 10 | Pending |
| INTENT-02 | Phase 10 | Pending |
| INTENT-03 | Phase 10 | Pending |
| INTENT-04 | Phase 10 | Pending |
| INTENT-05 | Phase 10 | Pending |
| INTENT-06 | Phase 10 | Pending |
| INTENT-07 | Phase 10 | Pending |
| INTENT-08 | Phase 10 | Pending |
| SNAP-01 | Phase 8 | Pending |
| SNAP-02 | Phase 8 | Pending |
| SNAP-03 | Phase 8 | Pending |
| SNAP-04 | Phase 8 | Pending |
| SNAP-05 | Phase 8 | Pending |
| API-01 | Phase 9 | Pending |
| API-02 | Phase 11 | Pending |
| API-03 | Phase 11 | Pending |
| API-04 | Phase 11 | Pending |
| API-05 | Phase 11 | Pending |
| API-06 | Phase 11 | Pending |
| API-07 | Phase 1 | Complete |
| OPS-01 | Phase 1 | Complete |
| OPS-02 | Phase 1 | Complete |
| OPS-03 | Phase 1 | Complete |
| OPS-04 | Phase 1 | Complete |
| OPS-05 | Phase 6 | Pending |
| OPS-06 | Phase 5 | Complete |

**Coverage:**

- v1 requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0 ✓

The earlier count of 62 was wrong. Counting the requirement IDs above the line gives 68: AUTH 8,
CRYPT 5, CONN 7, INGEST 6, LEDGER 12, RECON 4, INTENT 8, SNAP 5, API 7, OPS 6. No requirement was
added or removed to reach it — only the total was miscounted.

---
*Requirements defined: 2026-08-29*
*Last updated: 2026-08-29 after roadmap creation — traceability populated, coverage corrected to 68*
