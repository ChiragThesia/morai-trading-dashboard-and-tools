import {
  customType,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  date,
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

// ─── Re-export sql helper used by partial index ───────────────────────────────
import { sql } from "drizzle-orm";
export { sql };
