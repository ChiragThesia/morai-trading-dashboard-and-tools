import {
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  date,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── bytea customType for pgcrypto-encrypted columns ─────────────────────────
// pgp_sym_encrypt returns bytea; pgp_sym_decrypt accepts bytea and returns text.
// data: string  — the decrypted value as seen by application code
// driverData: Buffer — the raw bytea value as read from Postgres wire protocol
// RESEARCH open question A6: verified correct — round-trip tested in plan 04-02
const byteaColumn = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ─── Enums ───────────────────────────────────────────────────────────────────

export const calendarStatusEnum = pgEnum("calendar_status", ["open", "closed"]);
// Phase 5 — additive enum, no existing enum changed
export const calendarEventTypeEnum = pgEnum("calendar_event_type", [
  "OPEN",
  "CLOSE",
  "ROLL",
]);
export const snapshotSourceEnum = pgEnum("snapshot_source", [
  "schwab_chain",
  "cboe",
  "computed_only",
]);
export const observationSourceEnum = pgEnum("observation_source", [
  "schwab_chain",
  "cboe",
  "computed_only",
]);
export const contractTypeEnum = pgEnum("contract_type", ["C", "P"]);
export const exerciseStyleEnum = pgEnum("exercise_style", [
  "american",
  "european",
]);

// ─── 1. calendars — position metadata ────────────────────────────────────────

export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  underlying: varchar("underlying", { length: 16 }).notNull(),
  // Strike stored ×1000 int convention (7100 → 7100000); same-strike both legs (D-02)
  strike: integer("strike").notNull(),
  // D-01: option type shared by both legs (C=call, P=put); added via Phase 3 migration
  optionType: contractTypeEnum("option_type").notNull(),
  frontExpiry: date("front_expiry").notNull(),
  backExpiry: date("back_expiry").notNull(),
  qty: integer("qty").notNull(),
  status: calendarStatusEnum("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openNetDebit: numeric("open_net_debit"),
  closeNetCredit: numeric("close_net_credit"),
  notes: text("notes"),
  // D-07: free-text/tag entry thesis hook — nullable, no default (non-destructive ALTER)
  entryThesis: text("entry_thesis"),
}).enableRLS();

// ─── 2. calendar_snapshots — THE JOURNAL. 30-min RTH cadence ─────────────────

export const calendarSnapshots = pgTable(
  "calendar_snapshots",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    calendarId: uuid("calendar_id").notNull(),
    spot: numeric("spot").notNull(),
    netMark: numeric("net_mark").notNull(),
    frontMark: numeric("front_mark").notNull(),
    backMark: numeric("back_mark").notNull(),
    // BSM-inverted IVs (our own)
    frontIv: numeric("front_iv").notNull(),
    backIv: numeric("back_iv").notNull(),
    // Vendor-reported IVs
    frontIvRaw: numeric("front_iv_raw").notNull(),
    backIvRaw: numeric("back_iv_raw").notNull(),
    // BSM greeks, display-scaled
    netDelta: numeric("net_delta").notNull(),
    netGamma: numeric("net_gamma").notNull(),
    netTheta: numeric("net_theta").notNull(),
    netVega: numeric("net_vega").notNull(),
    // back_iv - front_iv (forward vol signal)
    termSlope: numeric("term_slope").notNull(),
    dteFront: integer("dte_front").notNull(),
    dteBack: integer("dte_back").notNull(),
    pnlOpen: numeric("pnl_open").notNull(),
    source: snapshotSourceEnum("source").notNull(),
    // SNAP-01 / D-12 (0016, additive nullable): provenance marker — 'scheduled'
    // (worker cron cadence) vs 'event-move' (server-side large-move detector).
    // NULL for pre-existing rows; the repo maps NULL to "scheduled" at read time.
    trigger: text("trigger"),
  },
  (table) => [
    // Time-leading composite PK — (time, calendar_id)
    primaryKey({ columns: [table.time, table.calendarId] }),
  ],
).enableRLS();

// ─── 3. leg_observations — raw per-contract quotes ───────────────────────────

export const legObservations = pgTable(
  "leg_observations",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    // OCC symbol, e.g. O:SPX260515P7100
    contract: varchar("contract", { length: 32 }).notNull(),
    bid: numeric("bid").notNull(),
    ask: numeric("ask").notNull(),
    mark: numeric("mark").notNull(),
    last: numeric("last"),
    underlyingPrice: numeric("underlying_price").notNull(),
    // Vendor-reported greeks/IV (nullable — not always present)
    iv: numeric("iv"),
    delta: numeric("delta"),
    gamma: numeric("gamma"),
    theta: numeric("theta"),
    vega: numeric("vega"),
    // BSM-computed greeks/IV (filled by background job)
    bsmIv: numeric("bsm_iv"),
    bsmDelta: numeric("bsm_delta"),
    bsmGamma: numeric("bsm_gamma"),
    bsmTheta: numeric("bsm_theta"),
    bsmVega: numeric("bsm_vega"),
    openInterest: integer("open_interest").notNull(),
    volume: integer("volume").notNull(),
    source: observationSourceEnum("source").notNull(),
  },
  (table) => [
    // Time-leading composite PK — (time, contract)
    primaryKey({ columns: [table.time, table.contract] }),
    // Partial index: cheap "pending BSM compute" scan
    index("leg_obs_pending_bsm_idx")
      .on(table.time, table.contract)
      .where(sql`bsm_iv IS NULL AND mark IS NOT NULL`),
  ],
).enableRLS();

// ─── 4. contracts — first-seen contract metadata ─────────────────────────────

export const contracts = pgTable("contracts", {
  occSymbol: varchar("occ_symbol", { length: 32 }).primaryKey(),
  schwabSymbol: varchar("schwab_symbol", { length: 32 }),
  underlying: varchar("underlying", { length: 16 }).notNull(),
  root: varchar("root", { length: 8 }).notNull(),
  contractType: contractTypeEnum("contract_type").notNull(),
  exerciseStyle: exerciseStyleEnum("exercise_style").notNull(),
  // Strike stored ×1000 int convention
  strike: integer("strike").notNull(),
  expiration: date("expiration").notNull(),
  multiplier: integer("multiplier").notNull().default(100),
}).enableRLS();

// ─── 5. fills — Schwab transaction feed (journal rebuild source) ──────────────

export const fills = pgTable("fills", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: varchar("order_id", { length: 64 }).notNull(),
  occSymbol: varchar("occ_symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(), // "buy" | "sell"
  qty: integer("qty").notNull(),
  price: numeric("price").notNull(),
  filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  commission: numeric("commission"),
  fees: numeric("fees"),
  raw: text("raw"), // broker JSON, for audit
  // WR-A2 (05-15, additive nullable): set once a fill is incorporated into exactly ONE
  // calendar_event (paired) or orphan-parked. readUnprocessedFills filters
  // WHERE processed_at IS NULL — paired fills are never re-read / re-paired (no double-count).
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // journal-pnl-opennetdebit-units (round 4, additive nullable): the fill's OWN broker-reported
  // OPENING/CLOSING role (BrokerTransaction.legs[].positionEffect), persisted per fill instead
  // of re-derived from the calendar's current (mutable) status column. Existing rows read NULL
  // (mapFillRow falls back to "UNKNOWN", which safely orphan-parks rather than misclassifying).
  positionEffect: varchar("position_effect", { length: 8 }), // "OPENING" | "CLOSING" | "UNKNOWN"
}).enableRLS();

// ─── 6. orders — Schwab order feed ───────────────────────────────────────────

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerId: varchar("broker_id", { length: 64 }).notNull(),
  occSymbol: varchar("occ_symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(), // "buy" | "sell"
  qty: integer("qty").notNull(),
  orderType: varchar("order_type", { length: 16 }).notNull(), // "limit" | "market"
  limitPrice: numeric("limit_price"),
  status: varchar("status", { length: 16 }).notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  raw: text("raw"), // broker JSON, for audit
}).enableRLS();

// ─── 7. rate_observations — FRED DGS3MO daily ────────────────────────────────

export const rateObservations = pgTable("rate_observations", {
  date: date("date").primaryKey(),
  rate: numeric("rate").notNull(),
}).enableRLS();

// ─── 8. broker_tokens — Schwab OAuth tokens, encrypted at rest (Phase 4) ─────

export const brokerTokens = pgTable("broker_tokens", {
  // 'trader' | 'market' — one row per Schwab app (D-09 per-app independence)
  appId: text("app_id").primaryKey(),
  // Encrypted via pgp_sym_encrypt; key injected at query time — never in DB (D-03)
  accessToken: byteaColumn("access_token").notNull(),
  refreshToken: byteaColumn("refresh_token").notNull(),
  // When the access token was issued (issued_at + 30 min → expires_at)
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  // 7-day hard cutoff clock starts at refresh_issued_at (no sliding window)
  refreshIssuedAt: timestamp("refresh_issued_at", { withTimezone: true }).notNull(),
  // Cached expiry (issued_at + 30 min); not authoritative — used for staleness check
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  // D-14 (05-05, additive): per-app refresh failure flag; null = last refresh succeeded.
  // Persisted so the server process can surface it at GET /api/status (worker writes it;
  // server reads it via readTokenFreshness — separate processes require DB persistence).
  // NEVER contains token values — only appId + error reason (T-05-11).
  lastRefreshError: text("last_refresh_error"),
  // GW-01 relaxation (D-02, Phase 11 plan 01): full schwab-py wrapped token blob (opaque);
  // sidecar is sole writer (GW-03); decomposed access/refresh also kept in the discrete
  // encrypted columns above for the TS reader (D-01). NULL until first sidecar OAuth dance
  // seeds it (D-03). refresh_issued_at is never touched by the sidecar write callback.
  tokenJson: jsonb("token_json"),
}).enableRLS();

// ─── 9. calendar_events — L1 trade ledger (Phase 5) ──────────────────────────
// One row per OPEN, CLOSE, or ROLL event sourced from broker fills.
// fill_ids_hash UNIQUE = idempotency key (SHA-256 of sorted fill UUIDs, exactly 64 hex chars
// per RESEARCH Pitfall 7 — prevents duplicate event injection via re-runs).

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // FK → calendars.id (which calendar this event belongs to)
  calendarId: uuid("calendar_id").notNull(),
  eventType: calendarEventTypeEnum("event_type").notNull(), // OPEN | CLOSE | ROLL
  // ISO timestamp of the first fill that produced this event
  eventedAt: timestamp("evented_at", { withTimezone: true }).notNull(),
  // Idempotency key: SHA-256 of sorted fill UUIDs (exactly 64 hex chars for SHA-256)
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).notNull().unique(),
  // OCC symbol of the primary leg (front for OPEN, new leg for ROLL)
  legOccSymbol: varchar("leg_occ_symbol", { length: 32 }).notNull(),
  // For ROLL events only: OCC symbol of the OLD leg being closed (D-03)
  rolledFromOccSymbol: varchar("rolled_from_occ_symbol", { length: 32 }),
  qty: integer("qty").notNull(),
  // Qty-weighted average fill price (D-04 aggregated partial fills)
  avgPrice: numeric("avg_price").notNull(),
  // Net debit/credit: OPEN debit = positive; CLOSE credit = negative (D-08 includes fees)
  netAmount: numeric("net_amount").notNull(),
  // Realized P&L: closeCredit − openDebit − totalFees; NULL on OPEN events (D-09)
  realizedPnl: numeric("realized_pnl"),
  // WR-A1 (05-15, additive nullable): explicit ROLL split components recompute reads.
  // NULL for OPEN/CLOSE; set for ROLL (open-leg debit → openNetDebit, close-leg credit →
  // closeNetCredit) so a calendar containing a roll reconciles after rebuild (SC5).
  rollOpenDebit: numeric("roll_open_debit"),
  rollCloseCredit: numeric("roll_close_credit"),
  // Per-leg JSON breakdown for L3 attribution — hard requirement (D-09)
  legBreakdown: text("leg_breakdown"),
  // D-07: entry thesis free-text hook (set at OPEN time, carried to CLOSE/ROLL)
  entryThesis: text("entry_thesis"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ─── 10. orphan_fills — unmatched fill parking (Phase 5, D-05) ───────────────
// Fills that cannot be matched to any calendar leg land here.
// Never silently dropped; never auto-deleted. fill_id PK → one row per unmatched fill.

export const orphanFills = pgTable("orphan_fills", {
  // Fill UUID is PK — one orphan row per unmatched fill (D-05)
  fillId: uuid("fill_id").primaryKey(),
  occSymbol: varchar("occ_symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(), // "buy" | "sell"
  qty: integer("qty").notNull(),
  price: numeric("price").notNull(),
  filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  // "no matching calendar" | "ambiguous calendar: [calendarIds]" etc.
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ─── 11. skew_observations — per-strike volatility smile (analytics, Phase 6) ─
// Append-only smile detail. One row per (underlying, expiration, strike) present in
// leg_observations at a snapshot time. Time-leading composite PK = per-grain UNIQUE key;
// re-run for the same snapshot time is a no-op (onConflictDoNothing).

export const skewObservations = pgTable(
  "skew_observations",
  {
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    underlying: varchar("underlying", { length: 16 }).notNull(),
    expiration: date("expiration").notNull(),
    // Strike stored ×1000 int convention (7100 → 7100000), like contracts.strike
    strike: integer("strike").notNull(),
    // IV from leg_observations.bsm_iv
    iv: numeric("iv").notNull(),
    // Interpolation source for the ±25Δ points; nullable when delta unavailable
    delta: numeric("delta"),
    moneyness: numeric("moneyness"),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotTime, table.underlying, table.expiration, table.strike],
    }),
  ],
).enableRLS();

// ─── 12. risk_reversal_observations — 25Δ RR + trailing rank (analytics) ──────
// riskReversal = IV(25Δ put) − IV(25Δ call); NULL when ±25Δ cannot be bracketed (never
// fabricated). rrRank = trailing-window inclusive percentile; NULL when RR is null or no
// history exists. Time-leading composite PK = per-grain UNIQUE key.

export const riskReversalObservations = pgTable(
  "risk_reversal_observations",
  {
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    underlying: varchar("underlying", { length: 16 }).notNull(),
    expiration: date("expiration").notNull(),
    // NULL when ±25Δ cannot be bracketed — never a guessed number
    riskReversal: numeric("risk_reversal"),
    // NULL when riskReversal is null or no trailing history
    rrRank: numeric("rr_rank"),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotTime, table.underlying, table.expiration],
    }),
  ],
).enableRLS();

// ─── 13. term_structure_observations — forward-vol slope per calendar ─────────
// value MUST equal the source calendar_snapshots.term_slope (no recompute drift).
// One row per calendar per snapshot time. Time-leading composite PK = per-grain UNIQUE key.

export const termStructureObservations = pgTable(
  "term_structure_observations",
  {
    snapshotTime: timestamp("snapshot_time", { withTimezone: true }).notNull(),
    calendarId: uuid("calendar_id").notNull(),
    // back_iv − front_iv; equals calendar_snapshots.term_slope (read through, never recomputed)
    value: numeric("value").notNull(),
    frontIv: numeric("front_iv").notNull(),
    backIv: numeric("back_iv").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotTime, table.calendarId] }),
  ],
).enableRLS();

// ─── 14. gex_snapshots — computed GEX snapshot per cycle (Phase 8) ───────────
// Single-row upsert idempotency via cycle_time PRIMARY KEY (SC-2 idempotency anchor).
// profile, strikes, byExpiry stored as JSONB blobs — never fanned out to per-row inserts
// (avoids 65,534-param insert ceiling; T-08-02).

export const gexSnapshots = pgTable("gex_snapshots", {
  cycleTime: timestamp("cycle_time", { withTimezone: true }).primaryKey(),
  spot: numeric("spot").notNull(),
  // Nullable: flip level is null when the GEX profile never crosses zero.
  flip: numeric("flip"),
  // Nullable: call/put walls are null when no dominant wall exists.
  // numeric (not integer): SPX half-point strikes produce fractional wall values
  // (e.g. 7412500 stored strike → 7412500/1000 = 7412.5 as a spot level).
  callWall: numeric("call_wall"),
  putWall: numeric("put_wall"),
  netGammaAtSpot: numeric("net_gamma_at_spot").notNull(),
  // JSONB blobs: [{spot, gamma}], [{k, gex, coi, poi, vol}], [{date, gex}]
  // $type<> parameters give Drizzle the JS type so adapters need no as-casts (lint: no-as).
  // Profile field is `spot` (WR-01: axis is a simulated spot-price level, not an option strike).
  profile: jsonb("profile").$type<ReadonlyArray<{ readonly spot: number; readonly gamma: number }>>().notNull(),
  strikes: jsonb("strikes").$type<ReadonlyArray<{ readonly k: number; readonly gex: number; readonly coi: number; readonly poi: number; readonly vol: number }>>().notNull(),
  byExpiry: jsonb("by_expiry").$type<ReadonlyArray<{ readonly date: string; readonly gex: number }>>().notNull(),
  // Near-term (≤45d DTE) level set — nullable: null when no near-term legs solve,
  // and on rows written before migration 0019.
  nearTerm: jsonb("near_term").$type<{
    readonly callWall: number | null;
    readonly putWall: number | null;
    readonly flip: number | null;
  } | null>(),
  // When the snapshot was COMPUTED (wall-clock from deps.now()), distinct from cycleTime
  // (the data-cycle anchor). Persisted so the dashboard can show true freshness.
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
}).enableRLS();

// ─── 15. cot_observations — CFTC COT TFF positioning per week (Phase 13) ─────
// One row per (contract_code, as_of) week. UNIQUE(contract_code, as_of) is the
// COT-01 idempotency key (D-09): a second fetch of the same week inserts 0 rows.
// NET values are NOT stored (D-04); derived at the API/use-case layer.
// published_at = fetch timestamp (Friday, D-07); as_of = Tuesday report date (D-08).

export const cotObservations = pgTable(
  "cot_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** CFTC contract market code — '13874A' for E-mini S&P 500 TFF futures-only. */
    contractCode: text("contract_code").notNull(),
    /** Tuesday report date (from report_date_as_yyyy_mm_dd, D-08). */
    asOf: date("as_of").notNull(),
    /** Fetch timestamp (Friday ~17:00 ET, D-07); stamped by the use-case. */
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    openInterest: integer("open_interest").notNull(),
    // Dealer / Intermediary raw legs
    dealerLong: integer("dealer_long").notNull(),
    dealerShort: integer("dealer_short").notNull(),
    // Asset Manager / Institutional raw legs
    assetMgrLong: integer("asset_mgr_long").notNull(),
    assetMgrShort: integer("asset_mgr_short").notNull(),
    // Leveraged Funds raw legs (D-05 primary signal)
    levMoneyLong: integer("lev_money_long").notNull(),
    levMoneyShort: integer("lev_money_short").notNull(),
    // Other Reportable raw legs
    otherReptLong: integer("other_rept_long").notNull(),
    otherReptShort: integer("other_rept_short").notNull(),
    // Non-Reportable raw legs
    nonreptLong: integer("nonrept_long").notNull(),
    nonreptShort: integer("nonrept_short").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // COT-01 idempotency key (D-09): one row per contract+week; re-run inserts 0 rows
    unique("cot_observations_contract_code_as_of_unique").on(table.contractCode, table.asOf),
  ],
).enableRLS();

// ─── 16. macro_observations — FRED/CBOE macro series (Phase 14) ──────────────
// One row per (date, series_id). Composite time-leading PK is the MAC-01
// idempotency key (D-05) — a second same-day fetch upserts, never duplicates.
// value stored RAW as reported by the source (D-14) — no unit conversion here.
// NOT a widening of rate_observations (D-02) — that table + readRate/BSM stay untouched.

export const macroObservations = pgTable(
  "macro_observations",
  {
    date: date("date").notNull(),
    seriesId: text("series_id").notNull(),
    value: numeric("value").notNull(),
    // Provenance: 'fred' | 'cboe' (VVIX)
    source: text("source").notNull(),
  },
  (table) => [
    // Time-leading composite PK — (date, series_id)
    primaryKey({ columns: [table.date, table.seriesId] }),
  ],
).enableRLS();

// ─── 17. economic_events — FOMC/CPI/NFP forward calendar (Phase 19, PICK-03) ──
// One row per (event_date, event_name). event_date is a plain `date`, NEVER timestamptz
// (Pitfall 3, mirrors the CBOE-UTC lesson in reverse — the release day IS the ET calendar day
// as published, no conversion needed). Composite PK is the idempotency key: a re-fetch of the
// same (date, name) upserts, never duplicates.

export const economicEvents = pgTable(
  "economic_events",
  {
    eventDate: date("event_date").notNull(),
    // 'FOMC' | 'CPI' | 'NFP'
    eventName: text("event_name").notNull(),
    // 'fred' | 'seed'
    source: text("source").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventDate, table.eventName] }),
  ],
).enableRLS();

// ─── 18. picker_snapshot — append-history picker snapshot blob (Phase 19, PICK-02) ──
// One row per observedAt (a real timestamptz instant, D-06) — INSERT only, never
// onConflictDoUpdate (D-06 append-history keeps every computed snapshot for PICK-04's
// future slope backtest). snapshot is the WHOLE pickerSnapshotResponse as one JSONB blob
// (D-05) — validated through pickerSnapshotResponse.parse at the adapter boundary on
// write AND read (T-19-10), never trusted as loosely-typed JSON.

export const pickerSnapshots = pgTable("picker_snapshot", {
  observedAt: timestamp("observed_at", { withTimezone: true }).primaryKey(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
}).enableRLS();

// ─── 19. calendar_event_annotations — RULE-01 strategy-rule tags (Phase 20) ──
// Orthogonal to calendar_events — survives rebuildJournal's delete-then-reinsert cycle
// (D-09/D24). fillIdsHash is a SOFT reference to calendar_events.fillIdsHash: a plain
// varchar(64) PRIMARY KEY, deliberately NOT a foreign key. rebuildJournal deletes and
// re-derives calendar_events rows; a real FK would either CASCADE-wipe this table's rows
// on delete or RESTRICT-block the rebuild outright (RESEARCH Pitfall 3). Do NOT add a
// .references() call here — see docs/architecture/stack-decisions.md D24.
// Ships EMPTY — no backfill (D-16); calendars.entryThesis is not migrated into this table.

export const calendarEventAnnotations = pgTable("calendar_event_annotations", {
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).primaryKey(),
  ruleTags: text("rule_tags").array().notNull().default([]),
  // D-21: 'other' among ruleTags requires a non-empty otherNote — enforced at the
  // contract layer (packages/contracts/src/journal-rules.ts), NOT a DB CHECK constraint.
  otherNote: text("other_note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ─── Re-export sql helper used by partial index ───────────────────────────────
import { sql } from "drizzle-orm";
export { sql };
