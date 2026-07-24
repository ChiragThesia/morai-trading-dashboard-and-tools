import { Hono } from "hono";
import { tradeDetailResponse, tradeHistoryResponse } from "@morai/contracts";
import type { ForRunningGetTradeDetail, ForRunningGetTradeHistory } from "@morai/core";

/**
 * tradeHistoryRoutes — factory returning a Hono router for the Trade Ledger read endpoint.
 *
 * Architecture law: zero business logic here. Pattern is:
 *   call use-case → map Result → parse through contract schema → respond.
 *
 * Date fields serialize via toISOString() — the contract's z.string().datetime() rejects
 * Schwab's raw "+0000" offset format, so raw strings never pass through unconverted.
 *
 * MCP-02: tradeHistoryResponse is the single schema source shared by this route and
 *         the get_trade_history MCP tool.
 */
export function tradeHistoryRoutes(
  getTradeHistory: ForRunningGetTradeHistory,
  getTradeDetail: ForRunningGetTradeDetail,
) {
  const router = new Hono();

  // Per-trade daily history for the Trades-row expansion (legs resolved per snapshot slot).
  router.get("/trade-history/:calendarId/detail", async (c) => {
    const calendarId = c.req.param("calendarId");
    const result = await getTradeDetail(calendarId);

    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    if (result.value === null) {
      return c.json({ error: "not found" }, 404);
    }

    const { days } = result.value;
    return c.json(
      tradeDetailResponse.parse({
        calendarId: result.value.calendarId,
        days: days.map((d) => ({ ...d, asOf: d.asOf.toISOString() })),
      }),
    );
  });

  router.get("/trade-history", async (c) => {
    const result = await getTradeHistory();

    if (!result.ok) {
      // Flat error body — never expose DB internals
      return c.json({ error: "internal" }, 500);
    }

    const { roundTrips, executions, totals, vix } = result.value;
    return c.json(
      tradeHistoryResponse.parse({
        roundTrips: roundTrips.map((r) => ({
          ...r,
          openedAt: r.openedAt.toISOString(),
          closedAt: r.closedAt !== null ? r.closedAt.toISOString() : null,
          greeks:
            r.greeks !== null
              ? { ...r.greeks, asOf: r.greeks.asOf.toISOString() }
              : null,
        })),
        executions: executions.map((e) => ({
          ...e,
          execTime: e.execTime !== null ? e.execTime.toISOString() : null,
        })),
        totals,
        vix,
      }),
    );
  });

  return router;
}
