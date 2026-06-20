/**
 * orders-adapter.ts — Schwab trader orders adapter (BRK-02, read-only).
 *
 * GET /trader/v1/accounts/{accountHash}/orders
 *
 * T-04-18: Zod safeParse at boundary; failed parse → Result.err, never throw.
 * T-04-19: Bearer token never logged; only {kind,message} returned on error.
 * T-04-20: accountHash (hashValue) used in URL, not the raw account number.
 * T-04-21: AUTH_EXPIRED short-circuits before any network call.
 * T-04-22: Read-only — no write/trade endpoints; only GET implemented.
 */
import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { BrokerOrder, FetchError, AuthExpiredError, ForFetchingOrders } from "@morai/core";
import { parseSchwabSymbol } from "../market/schwab-symbol.ts";

// ─── Zod schemas (MEDIUM confidence — all optional + passthrough) ──────────────

const OrderLegSchema = z
  .object({
    instrument: z
      .object({
        symbol: z.string().optional(),
        assetType: z.string().optional(),
      })
      .passthrough()
      .optional(),
    quantity: z.number().optional(),
    orderLegType: z.string().optional(),
    instruction: z.string().optional(),
  })
  .passthrough();

const OrderSchema = z
  .object({
    orderId: z.number().optional(),
    status: z.string().optional(),
    orderLegCollection: z.array(OrderLegSchema).optional(),
  })
  .passthrough();

const OrdersResponseSchema = z.array(OrderSchema);

// ─── instruction → side mapping ───────────────────────────────────────────────

function mapSide(instruction: string | undefined): "BUY" | "SELL" | "UNKNOWN" {
  if (instruction === undefined) return "UNKNOWN";
  const upper = instruction.toUpperCase();
  if (upper.includes("BUY")) return "BUY";
  if (upper.includes("SELL")) return "SELL";
  return "UNKNOWN";
}

// ─── Domain mapping ────────────────────────────────────────────────────────────

function mapOrder(order: z.infer<typeof OrderSchema>): BrokerOrder | null {
  const orderId = order.orderId;
  if (orderId === undefined) return null;

  const legs: BrokerOrder["legs"][number][] = [];
  const legCollection = order.orderLegCollection ?? [];

  for (const leg of legCollection) {
    const symbol = leg.instrument?.symbol;
    if (symbol === undefined || symbol.length === 0) continue;

    const parsedSymbol = parseSchwabSymbol(symbol);
    if (!parsedSymbol.ok) continue;

    const occSymbol = formatOccSymbol(parsedSymbol.value);
    const qty = leg.quantity ?? 0;
    const side = mapSide(leg.instruction);

    legs.push({ occSymbol, qty, side });
  }

  return {
    orderId,
    status: order.status ?? "UNKNOWN",
    legs,
  };
}

// ─── Adapter type ─────────────────────────────────────────────────────────────

export type SchwabOrdersAdapter = {
  readonly fetchOrders: ForFetchingOrders;
};

/**
 * makeSchwabOrdersAdapter — Schwab trader orders adapter (read-only).
 *
 * Mirrors the chain adapter factory shape (PATTERNS.md).
 * Implements ForFetchingOrders behind the port.
 * No order placement — only GET endpoints (T-04-22).
 */
export function makeSchwabOrdersAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): SchwabOrdersAdapter {
  const fetchOrders: ForFetchingOrders = async (
    accountHash: string,
  ): Promise<Result<ReadonlyArray<BrokerOrder>, FetchError | AuthExpiredError>> => {
    // Step 1: Check access token freshness BEFORE any network call (T-04-21)
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      return err(tokenResult.error);
    }
    const accessToken = tokenResult.value;

    // Step 2: Fetch orders (read-only GET — T-04-22)
    const url = `https://api.schwabapi.com/trader/v1/accounts/${accountHash}/orders`;

    let rawBody: unknown;
    try {
      const response = await deps.fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": deps.userAgent,
        },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `Schwab orders returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Step 3: Zod-parse at boundary (T-04-18, D-12)
    const parsed = OrdersResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `Schwab orders parse error: ${parsed.error.message}`,
      });
    }

    const brokerOrders: BrokerOrder[] = [];
    for (const order of parsed.data) {
      const mapped = mapOrder(order);
      if (mapped !== null) {
        brokerOrders.push(mapped);
      }
    }

    return ok(brokerOrders);
  };

  return { fetchOrders };
}
