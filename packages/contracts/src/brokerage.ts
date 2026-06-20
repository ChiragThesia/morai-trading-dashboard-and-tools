import { z } from "zod";

// MCP-02: ONE schema source for both HTTP routes and MCP tools (positions, transactions, orders).
// Both adapters import from here; a one-sided field rename fails typecheck.

// ─── Shared sub-schemas ────────────────────────────────────────────────────────

/** brokerPosition — one option position as returned by the trader adapter (BRK-02). */
export const brokerPosition = z.object({
  occSymbol: z.string().length(21),
  putCall: z.enum(["C", "P"]),
  longQty: z.number(),
  shortQty: z.number(),
  averagePrice: z.number().nullable(),
  marketValue: z.number().nullable(),
  underlyingSymbol: z.string(),
});

export type BrokerPositionResponse = z.infer<typeof brokerPosition>;

/** positionsResponse — array of positions (MCP-02 shared schema). */
export const positionsResponse = z.object({
  positions: z.array(brokerPosition),
});

export type PositionsResponse = z.infer<typeof positionsResponse>;

// ─── Transactions ─────────────────────────────────────────────────────────────

/** brokerTransactionLeg — one leg of a trade transaction. */
export const brokerTransactionLeg = z.object({
  occSymbol: z.string().length(21),
  qty: z.number(),
  price: z.number(),
  positionEffect: z.enum(["OPENING", "CLOSING", "UNKNOWN"]),
});

/** brokerTransaction — one trade as returned by the trader adapter. */
export const brokerTransaction = z.object({
  activityId: z.number(),
  tradeDate: z.string(),
  netAmount: z.number(),
  orderId: z.number().nullable(),
  legs: z.array(brokerTransactionLeg),
});

export type BrokerTransactionResponse = z.infer<typeof brokerTransaction>;

/** transactionsResponse — array of transactions (MCP-02 shared schema). */
export const transactionsResponse = z.object({
  transactions: z.array(brokerTransaction),
});

export type TransactionsResponse = z.infer<typeof transactionsResponse>;

// ─── Orders ───────────────────────────────────────────────────────────────────

/** brokerOrderLeg — one leg of an order. */
export const brokerOrderLeg = z.object({
  occSymbol: z.string().length(21),
  qty: z.number(),
  side: z.enum(["BUY", "SELL", "UNKNOWN"]),
});

/** brokerOrder — one read-only order (BRK-02, read-only phase). */
export const brokerOrder = z.object({
  orderId: z.number(),
  status: z.string(),
  legs: z.array(brokerOrderLeg),
});

export type BrokerOrderResponse = z.infer<typeof brokerOrder>;

/** ordersResponse — array of orders (MCP-02 shared schema). */
export const ordersResponse = z.object({
  orders: z.array(brokerOrder),
});

export type OrdersResponse = z.infer<typeof ordersResponse>;

// ─── Paused payload (D-09 AUTH_EXPIRED response shape) ────────────────────────

/**
 * brokerageAuthExpiredPayload — returned by HTTP routes/MCP tools when trader token
 * is AUTH_EXPIRED (D-09). Market flows are unaffected; trader reads are paused.
 */
export const brokerageAuthExpiredPayload = z.object({
  paused: z.literal(true),
  reason: z.literal("AUTH_EXPIRED"),
});

export type BrokerageAuthExpiredPayload = z.infer<typeof brokerageAuthExpiredPayload>;
