/**
 * brokerage.routes.ts — HTTP routes for BRK-02 trader data (positions, transactions, orders).
 *
 * Architecture law: zero business logic here.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * MCP-02: positionsResponse/transactionsResponse/ordersResponse are the single schema
 *         sources shared by these routes AND the MCP tools (tools.ts).
 *         A one-sided field rename fails typecheck on both surfaces.
 *
 * D-09: AUTH_EXPIRED from the use-case → 200 with brokerageAuthExpiredPayload.
 *        Market flows are unaffected; only trader reads are paused.
 *
 * T-04-22: Read-only — only GET endpoints (no order placement).
 */
import { Hono } from "hono";
import {
  positionsResponse,
  transactionsResponse,
  ordersResponse,
  brokerageAuthExpiredPayload,
} from "@morai/contracts";
import type { ForGettingPositions, ForGettingTransactions, ForGettingOrders } from "@morai/core";

/**
 * brokerageRoutes — factory returning a Hono router for brokerage read endpoints.
 *
 * GET /positions  — current positions
 * GET /transactions?from=YYYY-MM-DD&to=YYYY-MM-DD — trade transactions in range
 * GET /orders     — current orders (read-only)
 */
export function brokerageRoutes(
  getPositions: ForGettingPositions,
  getTransactions: ForGettingTransactions,
  getOrders: ForGettingOrders,
) {
  const router = new Hono();

  // ─── GET /positions ────────────────────────────────────────────────────────

  router.get("/positions", async (c) => {
    const result = await getPositions();

    if (!result.ok) {
      // D-09: AUTH_EXPIRED → 200 with paused payload (market flows unaffected)
      if (result.error.kind === "auth-expired") {
        return c.json(brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" }));
      }
      // Surface the adapter's FetchError message (no secrets in these messages) +
      // log it server-side — a generic "internal" hides why Schwab rejected the call.
      console.error(`brokerage route fetch-error: ${result.error.message}`);
      return c.json({ error: result.error.message }, 500);
    }

    // MCP-02: same positionsResponse schema used by the MCP get_positions tool
    return c.json(
      positionsResponse.parse({ positions: result.value }),
    );
  });

  // ─── GET /transactions ──────────────────────────────────────────────────────

  router.get("/transactions", async (c) => {
    // Default to last 90 days if query params not provided
    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

    const from = c.req.query("from") ?? ninetyDaysAgo.toISOString().slice(0, 10);
    const to = c.req.query("to") ?? today.toISOString().slice(0, 10);

    const result = await getTransactions(from, to);

    if (!result.ok) {
      // D-09: AUTH_EXPIRED → 200 with paused payload
      if (result.error.kind === "auth-expired") {
        return c.json(brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" }));
      }
      // Surface the adapter's FetchError message (no secrets in these messages) +
      // log it server-side — a generic "internal" hides why Schwab rejected the call.
      console.error(`brokerage route fetch-error: ${result.error.message}`);
      return c.json({ error: result.error.message }, 500);
    }

    // MCP-02: same transactionsResponse schema used by the MCP get_transactions tool
    return c.json(
      transactionsResponse.parse({ transactions: result.value }),
    );
  });

  // ─── GET /orders ───────────────────────────────────────────────────────────

  router.get("/orders", async (c) => {
    const result = await getOrders();

    if (!result.ok) {
      // D-09: AUTH_EXPIRED → 200 with paused payload
      if (result.error.kind === "auth-expired") {
        return c.json(brokerageAuthExpiredPayload.parse({ paused: true, reason: "AUTH_EXPIRED" }));
      }
      // Surface the adapter's FetchError message (no secrets in these messages) +
      // log it server-side — a generic "internal" hides why Schwab rejected the call.
      console.error(`brokerage route fetch-error: ${result.error.message}`);
      return c.json({ error: result.error.message }, 500);
    }

    // MCP-02: same ordersResponse schema used by the MCP get_orders tool
    return c.json(
      ordersResponse.parse({ orders: result.value }),
    );
  });

  return router;
}
