/**
 * transactions-adapter.ts — Schwab trader transactions adapter (BRK-02).
 *
 * GET /trader/v1/accounts/{accountHash}/transactions?startDate&endDate&types=TRADE
 *
 * T-04-18: Zod safeParse at boundary; failed parse → Result.err, never throw.
 * T-04-19: Bearer token never logged; only {kind,message} returned on error.
 * T-04-20: accountHash (hashValue) used in URL, not the raw account number.
 * T-04-21: AUTH_EXPIRED short-circuits before any network call.
 */
import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { BrokerTransaction, FetchError, AuthExpiredError, ForFetchingTransactions } from "@morai/core";
import { parseSchwabSymbol } from "../market/schwab-symbol.ts";

// ─── Zod schemas (MEDIUM confidence — all optional + passthrough) ──────────────

const TransferInstrumentSchema = z
  .object({
    assetType: z.string().optional(),
    symbol: z.string().optional(),
    putCall: z.string().optional(),
  })
  .passthrough();

const TransferItemSchema = z
  .object({
    instrument: TransferInstrumentSchema.optional(),
    amount: z.number().optional(),
    cost: z.number().optional(),
    price: z.number().optional(),
    feeType: z.string().optional(),
    positionEffect: z.string().optional(),
  })
  .passthrough();

const TransactionSchema = z
  .object({
    activityId: z.number().optional(),
    time: z.string().optional(),
    accountNumber: z.string().optional(),
    type: z.string().optional(),
    tradeDate: z.string().optional(),
    settlementDate: z.string().optional(),
    netAmount: z.number().optional(),
    orderId: z.number().optional(),
    activityType: z.string().optional(),
    transferItems: z.array(TransferItemSchema).optional(),
  })
  .passthrough();

const TransactionsResponseSchema = z.array(TransactionSchema);

// ─── positionEffect mapping ────────────────────────────────────────────────────

function mapPositionEffect(
  raw: string | undefined,
): "OPENING" | "CLOSING" | "UNKNOWN" {
  if (raw === "OPENING") return "OPENING";
  if (raw === "CLOSING") return "CLOSING";
  return "UNKNOWN";
}

// ─── Domain mapping ────────────────────────────────────────────────────────────

function mapTransaction(
  tx: z.infer<typeof TransactionSchema>,
): BrokerTransaction | null {
  const activityId = tx.activityId;
  if (activityId === undefined) return null;

  const transferItems = tx.transferItems ?? [];
  const legs: BrokerTransaction["legs"][number][] = [];

  for (const item of transferItems) {
    const symbol = item.instrument?.symbol;
    if (symbol === undefined || symbol.length === 0) continue;

    const parsedSymbol = parseSchwabSymbol(symbol);
    if (!parsedSymbol.ok) continue;

    const occSymbol = formatOccSymbol(parsedSymbol.value);
    const qty = Math.abs(item.amount ?? 0);
    const price = item.price ?? 0;
    const positionEffect = mapPositionEffect(item.positionEffect);

    legs.push({ occSymbol, qty, price, positionEffect });
  }

  return {
    activityId,
    tradeDate: tx.tradeDate ?? tx.time?.slice(0, 10) ?? "",
    netAmount: tx.netAmount ?? 0,
    orderId: tx.orderId ?? null,
    legs,
  };
}

// ─── Adapter type ─────────────────────────────────────────────────────────────

export type SchwabTransactionsAdapter = {
  readonly fetchTransactions: ForFetchingTransactions;
};

/**
 * makeSchwabTransactionsAdapter — Schwab trader transactions adapter.
 *
 * Mirrors the chain adapter factory shape (PATTERNS.md).
 * Implements ForFetchingTransactions behind the port.
 */
export function makeSchwabTransactionsAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): SchwabTransactionsAdapter {
  const fetchTransactions: ForFetchingTransactions = async (
    accountHash: string,
    from: string,
    to: string,
  ): Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>> => {
    // Step 1: Check access token freshness BEFORE any network call (T-04-21)
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      return err(tokenResult.error);
    }
    const accessToken = tokenResult.value;

    // Step 2: Build URL with query params
    const url = new URL(
      `https://api.schwabapi.com/trader/v1/accounts/${accountHash}/transactions`,
    );
    url.searchParams.set("startDate", from);
    url.searchParams.set("endDate", to);
    url.searchParams.set("types", "TRADE");

    let rawBody: unknown;
    try {
      const response = await deps.fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": deps.userAgent,
        },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `Schwab transactions returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Step 3: Zod-parse at boundary (T-04-18, D-12)
    const parsed = TransactionsResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `Schwab transactions parse error: ${parsed.error.message}`,
      });
    }

    const brokerTransactions: BrokerTransaction[] = [];
    for (const tx of parsed.data) {
      const mapped = mapTransaction(tx);
      if (mapped !== null) {
        brokerTransactions.push(mapped);
      }
    }

    return ok(brokerTransactions);
  };

  return { fetchTransactions };
}
