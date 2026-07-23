import { z } from "zod";

// Trade Ledger contract — ONE schema source for GET /api/trade-history and the
// get_trade_history MCP tool (MCP-02 pattern).
//
// execTime/openedAt/closedAt/asOf are ISO strings serialized server-side via
// Date.toISOString() — Schwab's raw "+0000" offset format fails z.string().datetime(),
// so the raw string must never pass through unconverted.

export const tradeHistoryGreeks = z.object({
  netDelta: z.number().nullable(),
  netTheta: z.number().nullable(),
  netVega: z.number().nullable(),
  frontIv: z.number().nullable(),
  backIv: z.number().nullable(),
  termSlope: z.number().nullable(),
  asOf: z.string().datetime(),
});
export type TradeHistoryGreeksResponse = z.infer<typeof tradeHistoryGreeks>;

export const tradeHistoryRoundTrip = z.object({
  calendarId: z.string().uuid(),
  underlying: z.string(),
  strike: z.number(), // ×1000 int (calendars convention)
  optionType: z.enum(["C", "P"]),
  frontExpiry: z.string(),
  backExpiry: z.string(),
  qty: z.number(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  openNetDebit: z.number(),
  realizedPnl: z.number().nullable(),
  greeks: tradeHistoryGreeks.nullable(),
});
export type TradeHistoryRoundTripResponse = z.infer<typeof tradeHistoryRoundTrip>;

export const tradeHistoryExecution = z.object({
  activityId: z.number(),
  execTime: z.string().datetime().nullable(),
  tradeDate: z.string(),
  orderId: z.number().nullable(),
  occSymbol: z.string(),
  expiry: z.string(),
  strike: z.number(), // points (not ×1000)
  type: z.enum(["C", "P"]),
  side: z.enum(["buy", "sell"]),
  qty: z.number(),
  positionEffect: z.enum(["OPENING", "CLOSING", "UNKNOWN"]),
  price: z.number(),
  netAmount: z.number(),
  fees: z.number().nullable(),
});
export type TradeHistoryExecutionResponse = z.infer<typeof tradeHistoryExecution>;

export const tradeHistoryResponse = z.object({
  roundTrips: z.array(tradeHistoryRoundTrip),
  executions: z.array(tradeHistoryExecution),
  totals: z.object({ realizedPnl: z.number().nullable() }),
  vix: z.object({ value: z.number(), date: z.string() }).nullable(),
});
export type TradeHistoryResponse = z.infer<typeof tradeHistoryResponse>;
