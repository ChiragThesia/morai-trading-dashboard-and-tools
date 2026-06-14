import {
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

// ─── Enums ───────────────────────────────────────────────────────────────────

export const calendarStatusEnum = pgEnum("calendar_status", ["open", "closed"]);
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

// ─── Re-export sql helper used by partial index ───────────────────────────────
import { sql } from "drizzle-orm";
export { sql };
