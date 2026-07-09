# Data Model

Postgres 16 (Supabase-managed, D18) + Drizzle. Schema lives in
`packages/adapters/postgres/schema.ts` and is an **adapter concern** — core works with domain
types, repositories translate. Supabase is just the Postgres host; the schema, Drizzle code, and
migrations are provider-agnostic (drizzle-kit migrations run over the direct/session connection —
see `deployment.md`).

## Design Stance

- **Append-only observation tables** for anything time-stamped (snapshots, quotes). No updates;
  corrections are new rows.
- **Time-leading composite keys** on observation tables — `(time, calendar_id)`,
  `(time, contract)` — so the Timescale upgrade (hypertables partition on time) is a pure
  migration with zero application change.
- **Store raw AND computed**: vendor-reported values (Schwab greeks/IV) alongside our own
  BSM-computed values. Lesson from the old dashboard — vendor greeks are black-box; ours are
  consistent and attributable. Server prefers computed, falls back to raw.

## Core Tables (initial — journal context)

### `calendars` — position metadata
```
id            uuid PK
underlying    varchar          -- 'SPX'
strike        int              -- 7100 stored as int (×1000 convention: 7100000)
front_expiry  date
back_expiry   date
qty           int
status        enum: open | closed
opened_at     timestamptz
closed_at     timestamptz NULL
open_net_debit  numeric NULL
close_net_credit numeric NULL
notes         text NULL        -- regime context at entry, etc.
```

### `calendar_snapshots` — THE JOURNAL. 30-min RTH cadence per open calendar
```
time            timestamptz    ┐ PK (time, calendar_id)
calendar_id     uuid FK        ┘
spot            numeric
net_mark        numeric        -- calendar value at snapshot
front_mark, back_mark          numeric
front_iv, back_iv              numeric    -- our BSM inversion
front_iv_raw, back_iv_raw      numeric    -- vendor-reported
net_delta, net_gamma, net_theta, net_vega numeric   -- our BSM, display-scaled
term_slope      numeric        -- back_iv - front_iv (forward vol signal)
dte_front, dte_back            int
pnl_open        numeric        -- net_mark vs open_net_debit
source          enum: schwab_chain | cboe | computed_only
trigger         text NULL      -- provenance (SNAP-01/D-12): scheduled | event-move
```
13 rows/day/calendar. Answers: "how did price and greeks move over this trade's life?"

`trigger` (migration 0016, additive nullable) records why a snapshot fired: `scheduled`
is the normal 30-min worker cron cadence; `event-move` is a mid-cycle snapshot fired by
the server-side SPX move detector. Existing rows are NULL and read as `scheduled` — the
column adds no NOT NULL constraint and backfills nothing.

### `leg_observations` — raw per-contract quotes (audit + recompute source)
```
time, contract(occ_symbol)     PK
bid, ask, mark, last           numeric
underlying_price               numeric
iv, delta, gamma, theta, vega  numeric NULL   -- vendor raw
bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega numeric NULL  -- ours, filled by job
open_interest, volume          int
source                         enum
```
Partial index `WHERE bsm_iv IS NULL AND mark IS NOT NULL` → cheap "pending compute" scan
(pattern carried from old dashboard).

### `contracts` — first-seen contract metadata
```
occ_symbol      varchar(32) PK     -- O:SPX260515P7100
schwab_symbol   varchar(32)        -- 'SPX  260515P7100' (root padded to 6)
underlying, root, contract_type, exercise_style, strike(int), expiration, multiplier
```
SPX/SPXW = European cash-settled; strike stored ×1000 int, ÷1000 on parse.

### `fills` / `orders` — Schwab transaction feed (journal rebuild source)
Journal positions are **rebuilt from broker fills, never hand-written** — same source-of-truth
discipline as the trade-advisor plugin's `rebuild-journal`.

`position_effect` (migration 0018, additive nullable) records each fill's OWN broker-reported
OPENING/CLOSING role (journal-pnl-opennetdebit-units round 4). It drives OPEN/CLOSE/ROLL
classification directly — sync-fills no longer re-derives this from the calendar's current
`status` column, which reflects the calendar's LATEST known state, not what a historical
fill's role was at trade time (deriving classification from status folded a calendar's real
CLOSE fills into OPEN events, or vice versa, whenever status hadn't kept pace with reality).
Existing rows read NULL and fall back to `"UNKNOWN"` (orphan-parked, never a fabricated
classification).

### `rate_observations` — FRED DGS3MO daily
```
date PK, rate numeric          -- fallback 4.5% if FRED unreachable (rho impact tiny)
```
Unchanged by Phase 14 (D-02) — stays the single-series BSM risk-free-rate path. `readRate` /
`computeBsmGreeks.ts` keep reading this table exactly as before.

### `macro_observations` — expanded FRED + VVIX series (Phase 14, MAC-01)

NEW table (D-01) — not a widening of `rate_observations`. Backs `GET /api/analytics/macro`
and MCP `get_macro` (MAC-02).

```
date        date NOT NULL      ┐ PK (date, series_id) — time-leading (DATA-01)
series_id   text NOT NULL      ┘
value       numeric NOT NULL   -- RAW as reported by the source, NO /100 (D-14): DFF stored
                                -- as 4.33 (percent), VIXCLS/VVIX stored as index levels (~18.9,
                                -- ~89.0) — this is a display-only table, no cross-series
                                -- arithmetic requiring normalization
source      text                -- 'fred' | 'cboe' (provenance)
```

Nine series land here: `DFF`, `DGS1MO`, `DGS3MO`, `SOFR`, `T10Y2Y`, `T10Y3M`, `VIXCLS`, `VXVCLS`
(source `fred`) and `VVIX` (source `cboe`, via the existing CBOE index-quote adapter). `VXVCLS`
(VIX3M) is an index level like `VIXCLS`, stored raw with no `/100` (D-14, Phase 23).
DGS3MO is double-written — once here (raw, source `fred`) and once in `rate_observations`
(decimal-fraction, unchanged BSM path, D-02).

**RLS enabled**, mirroring `cot_observations`. Idempotent upsert on `(date, series_id)` — a
second run for the same date is a no-op for unchanged values (D-05 self-healing incremental
fetch). ENABLE ROW LEVEL SECURITY per the standard observation-table convention.

### Analytics tables (analytics context, Phase 6)

Three append-only observation tables, written by the `compute-analytics` job after each
`snapshot-calendars` cycle. Each has a time-leading composite PK that doubles as the per-grain
UNIQUE key, so a same-snapshot-time re-run inserts zero new rows (`onConflictDoNothing`).

#### `skew_observations` — per-strike volatility smile
```
snapshot_time   timestamptz    ┐
underlying      varchar(16)    │ PK (snapshot_time, underlying, expiration, strike)
expiration      date           │  = per-grain UNIQUE key
strike          int            ┘  -- ×1000 convention (7100 → 7100000)
iv              numeric        -- from leg_observations.bsm_iv
delta           numeric NULL   -- interpolation source for the ±25Δ points
moneyness       numeric NULL
```
One row per smile point — `(underlying, expiration, strike)` in `leg_observations`.

#### `risk_reversal_observations` — 25Δ risk-reversal + trailing rank
```
snapshot_time   timestamptz    ┐ PK (snapshot_time, underlying, expiration)
underlying      varchar(16)    │  = per-grain UNIQUE key
expiration      date           ┘
risk_reversal   numeric NULL   -- IV(25Δ put) − IV(25Δ call); NULL when ±25Δ unbracketable
rr_rank         numeric NULL   -- trailing-window inclusive percentile; NULL when RR or history absent
```
`risk_reversal = IV(25Δ put) − IV(25Δ call)`, interpolated linear-in-delta from the smile's
`(delta, iv)` pairs to the ±0.25 points. `rr_rank` is the inclusive percentile of that value
over a trailing window for the same `(underlying, expiration)` — last 252, or all when shorter.
Forward-only: no backfill of pre-phase history.

#### `term_structure_observations` — forward-vol slope per calendar
```
snapshot_time   timestamptz    ┐ PK (snapshot_time, calendar_id)
calendar_id     uuid           ┘  = per-grain UNIQUE key
value           numeric        -- back_iv − front_iv; equals calendar_snapshots.term_slope
front_iv        numeric
back_iv         numeric
```

**Two non-negotiable invariants.** (1) **No recompute drift** — `term_structure_observations.value` MUST equal the `term_slope` in the matching `calendar_snapshots` row; the job reads it through, never recomputes.
(2) **Never fabricate a risk-reversal** — when the smile cannot bracket ±25Δ, `risk_reversal` is NULL (never guessed) and a NULL value is excluded from the rank.

## Postgres vs Timescale — The Decision

| Scenario | Rows/year | Plain PG verdict |
|---|---|---|
| 10 calendars, 30-min journal | ~33k | trivial |
| + full 500-contract chain @ 30-min | ~1.6M | fine with indexes |
| Minute-level chain polling (NOT planned) | ~50M | revisit → Timescale |

**Decision (D7)**: plain Postgres. **Revisit trigger**: any observations table >10M rows OR
p95 journal query >500ms. **Upgrade**: Timescale-enabled image on Railway,
`create_hypertable` + compression-policy migration. Schema shape already compatible.

### `calendar_events` — trade ledger (Phase 5, L1)

The L1 trade-ledger layer. Each row records one OPEN, CLOSE, or ROLL event for a calendar,
sourced from broker fills. Distinct from `calendar_snapshots` (the L2 greeks time-series).

```
id                uuid PK
calendar_id       uuid FK → calendars.id
event_type        enum: OPEN | CLOSE | ROLL
evented_at        timestamptz          -- timestamp of the first fill in this event
fill_ids_hash     varchar(64) UNIQUE   -- SHA-256 hex of sorted fill UUIDs (idempotency key)
leg_occ_symbol    varchar(32)          -- OCC symbol of the primary leg
rolled_from_occ_symbol varchar(32) NULL -- OLD leg being closed; NULL for OPEN and CLOSE events
qty               int
avg_price         numeric              -- qty-weighted average fill price
net_amount        numeric              -- OPEN debit = positive; CLOSE credit = negative (D-08)
realized_pnl      numeric NULL         -- populated on CLOSE and ROLL only (D-09)
leg_breakdown     text NULL            -- JSON: per-leg amounts for L3 attribution (D-09, required)
entry_thesis      text NULL            -- D-07 free-text hook, set at OPEN time
created_at        timestamptz
```

**Realized P&L (D-08/D-09).** Realized P&L on a CLOSE or ROLL is the gain or loss of the
leg being closed, not a forward-looking cost:

```
realizedPnl = closeCredit − originalOpenDebit − feesOnClose
```

`originalOpenDebit` is the debit recorded on the prior OPEN event for the same leg — read
from that leg's earlier `calendar_events` row at close time. `closeCredit` is the credit
received on the close. `feesOnClose` is the commission plus fees paid on the closing fills
only. When no prior OPEN event exists for the leg, `realized_pnl` stays NULL — a missing
result, never a wrong number.

On a ROLL the new leg's premium is cost basis. It lands in `net_amount`, never in
`realized_pnl`. The roll's `realized_pnl` reflects only the closed (old) leg:
`closeCredit_oldLeg − originalOpenDebit_oldLeg − feesOnClose`. The new leg's
`originalOpenDebit` is its own future cost basis and is irrelevant to the closed leg's
result.

Idempotency: `fill_ids_hash` is a `varchar(64)` UNIQUE index (exactly 64 hex chars = SHA-256).
Re-running `sync-fills` against the same fill set produces the same hash and the insert is a
no-op (`onConflictDoNothing`). This prevents duplicate events across job re-runs.

ROLL events set `rolled_from_occ_symbol` to the old leg and `leg_occ_symbol` to the new leg,
preserving the "same trade continued" chain (D-03).

### `orphan_fills` — unmatched fill parking (Phase 5)

Fills that cannot be matched to any calendar leg are parked here. They are never silently
dropped and never auto-deleted (D-05). An operator reviews them to detect missing calendars or
ambiguous legs.

```
fill_id     uuid PK              -- same UUID as fills.id
occ_symbol  varchar(32)
side        varchar(4)           -- "buy" | "sell"
qty         int
price       numeric
filled_at   timestamptz
reason      text                 -- "no matching calendar" | "ambiguous calendar: [ids]"
created_at  timestamptz
```

### `calendars` column addition (Phase 5)

The `calendars` table gains a nullable `entry_thesis` column (D-07):

```
entry_thesis  text NULL    -- free-text or tag for L4 strategy-rules attach point (D-07)
```

This is set at OPEN event creation and is never required. It acts as a hook for the future L4
strategy-rules layer. No default value; non-destructive ALTER TABLE.

### `calendar_event_annotations` — strategy-rule tags, orthogonal to rebuild (Phase 20, RULE-01)

```
fill_ids_hash   varchar(64) PK    -- soft reference to calendar_events.fill_ids_hash; NOT a
                                   -- foreign key (D24 — see stack-decisions.md)
rule_tags       text[] NOT NULL DEFAULT '{}'   -- enterRuleTag | exitRuleTag | rollRuleTag values
other_note      text NULL         -- free text; required by the CONTRACT layer (not a DB CHECK)
                                   -- when 'other' is among rule_tags (D-21)
updated_at      timestamptz NOT NULL DEFAULT now()
```

**No foreign key, by design (D24/D-09).** `rebuildJournal` deletes and re-derives `calendar_events`
rows; a FK from this table to `calendar_events` would either CASCADE-wipe the annotation on delete
or RESTRICT-block the rebuild. `fill_ids_hash` is deterministic (SHA-256 of the sorted fill UUIDs),
so a rebuild that reproduces the same fill set reproduces the same hash and the annotation
transparently re-attaches. A hash that no longer matches any current event is orphaned — the read
use-case (plan 20-09) logs and omits it, never deletes it.

Ships empty (D-16) — no backfill, and `calendars.entry_thesis` free text is not migrated here.

### `broker_tokens` — Schwab OAuth token storage (brokerage context, Phase 4)

```
app_id            text PK            -- 'trader' | 'market' — one row per Schwab app
access_token      bytea NOT NULL     -- pgp_sym_encrypt(token, TOKEN_ENCRYPTION_KEY)
refresh_token     bytea NOT NULL     -- pgp_sym_encrypt(token, TOKEN_ENCRYPTION_KEY)
issued_at         timestamptz        -- when access token was issued
refresh_issued_at timestamptz        -- when refresh token was issued (7-day clock)
expires_at        timestamptz        -- issued_at + 30 min (cached, not authoritative)
updated_at        timestamptz
```

Design rationale:

- **One row per Schwab app** (`app_id` PK discriminator). Trader app and market app
  are independent OAuth clients — their token lifetimes are independent (D-09).
- **Encrypted at rest via pgcrypto** (`pgp_sym_encrypt` / `pgp_sym_decrypt`). The
  symmetric key (`TOKEN_ENCRYPTION_KEY`) is injected at query time from env/secrets
  and never stored in the database (D-03). Key appears only as a `$N` parameter in the
  wire protocol, never in query logs or slow-query output.
- **bytea columns** for the encrypted fields — pgcrypto returns `bytea`, not `text`.
  Drizzle schema uses `customType<{ data: string; driverData: Buffer }>` for these
  columns; `pgp_sym_decrypt` unwraps them back to plaintext strings on read.
- **pgcrypto extension**: migration includes `CREATE EXTENSION IF NOT EXISTS pgcrypto`
  as its first statement (idempotent; pre-enabled in Supabase by default).
- **No expiry column for refresh token** — the 7-day hard cutoff is computed from
  `refresh_issued_at` at read time by the `isTokenExpired` pure domain function.

## Migrations

- drizzle-kit generated SQL in `packages/adapters/postgres/migrations/`.
- Tracked, lexicographically ordered, each in its own transaction, idempotent runner —
  safe across container restarts (old-dashboard pattern).
- Auto-migrate on server/worker boot.
