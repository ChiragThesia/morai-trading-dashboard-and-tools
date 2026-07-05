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

// journal-pnl-opennetdebit-units #2: transferItems[].amount is Schwab's SIGNED per-leg
// contract quantity — positive when contracts are received (BOUGHT), negative when
// delivered (SOLD). This is the authoritative direction signal, independent of
// positionEffect (OPENING/CLOSING): a single order can open one leg by buying and another
// by selling (e.g. a calendar's back-bought/front-sold legs), which positionEffect alone
// cannot distinguish. Deriving `side` from positionEffect (the prior approach) silently
// forced every OPENING leg to "buy" and every CLOSING leg to "sell", corrupting the sign of
// any sold-to-open or bought-to-close leg all the way through to calendars.open_net_debit.
//
// journal-pnl-opennetdebit-units #2 (mapSide hardening, money-path review 🟡 fix): a
// missing or zero `amount` must NOT silently default to "buy" — that fabricates a
// direction with a 50% chance of being wrong. `cost` is an independent, corroborating
// signal Schwab sends on every real fill (confirmed via the schwab-transactions fixture:
// amount +1/cost -1250.00 for a bought/debit leg, amount -1/cost +800.00 for a sold/credit
// leg — cost's sign is the exact negation of amount's): negative cost = money paid = bought,
// positive cost = money received = sold. When amount is unusable, fall back to cost's sign.
// When NEITHER carries a usable signal, direction is genuinely unknown — return null so the
// caller drops the leg (mirrors the existing skip-on-unparseable-symbol pattern below)
// rather than fabricate one.
function mapSide(
  amount: number | undefined,
  cost: number | undefined,
): "buy" | "sell" | null {
  if (amount !== undefined && amount !== 0) return amount < 0 ? "sell" : "buy";
  if (cost !== undefined && cost !== 0) return cost < 0 ? "buy" : "sell";
  return null;
}

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
    const rawAmount = item.amount;
    const side = mapSide(rawAmount, item.cost);
    // No usable direction signal (amount and cost both missing/zero) — never fabricate a
    // side. Drop the leg, same as an unparseable symbol above (D-12 parse-don't-cast).
    if (side === null) continue;
    const qty = Math.abs(rawAmount ?? 0);
    const price = item.price ?? 0;
    const positionEffect = mapPositionEffect(item.positionEffect);

    legs.push({ occSymbol, qty, price, positionEffect, side });
  }

  return {
    activityId,
    // Schwab sends tradeDate/time as full ISO-8601 datetimes; the BrokerTransaction
    // contract is date-only (YYYY-MM-DD). Slice whichever source we use — live, an
    // unsliced datetime + "T00:00:00Z" in the fills write path → Invalid Date.
    tradeDate: (tx.tradeDate ?? tx.time)?.slice(0, 10) ?? "",
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
    // Schwab /transactions requires ISO-8601 datetimes, not date-only (date-only → HTTP 400).
    // The use-case passes YYYY-MM-DD; widen to full-day UTC bounds (inclusive).
    url.searchParams.set("startDate", `${from}T00:00:00.000Z`);
    url.searchParams.set("endDate", `${to}T23:59:59.999Z`);
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
