/**
 * positions-adapter.ts — Schwab trader positions adapter (BRK-02).
 *
 * GET /trader/v1/accounts/{accountHash}/?fields=positions
 *
 * T-04-18: Zod safeParse at boundary; failed parse → Result.err, never throw.
 * T-04-19: Bearer token never logged; only {kind,message} returned on error.
 * T-04-20: accountHash (hashValue) used in URL, not the raw account number.
 * T-04-21: AUTH_EXPIRED short-circuits before any network call.
 */
import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { BrokerPosition, FetchError, AuthExpiredError, ForFetchingPositions } from "@morai/core";
import { parseSchwabSymbol } from "../market/schwab-symbol.ts";

// ─── Zod schemas (MEDIUM confidence — all optional + passthrough) ──────────────

const InstrumentSchema = z
  .object({
    assetType: z.string().optional(),
    symbol: z.string().optional(),
    putCall: z.enum(["PUT", "CALL", "UNKNOWN"]).optional(),
    optionMultiplier: z.number().optional(),
    underlyingSymbol: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const PositionSchema = z
  .object({
    shortQuantity: z.number().optional(),
    longQuantity: z.number().optional(),
    averagePrice: z.number().optional(),
    marketValue: z.number().optional(),
    currentDayProfitLoss: z.number().optional(),
    instrument: InstrumentSchema.optional(),
  })
  .passthrough();

const SecuritiesAccountSchema = z
  .object({
    positions: z.array(PositionSchema).optional(),
  })
  .passthrough();

const PositionsResponseSchema = z
  .object({
    securitiesAccount: SecuritiesAccountSchema.optional(),
  })
  .passthrough();

// ─── Domain mapping ────────────────────────────────────────────────────────────

function mapPosition(pos: z.infer<typeof PositionSchema>): BrokerPosition | null {
  const instr = pos.instrument;
  if (instr === undefined) return null;
  if (instr.assetType !== "OPTION") return null;

  const symbol = instr.symbol;
  if (symbol === undefined || symbol.length === 0) return null;

  const parsedSymbol = parseSchwabSymbol(symbol);
  if (!parsedSymbol.ok) return null;

  const occSymbol = formatOccSymbol(parsedSymbol.value);

  const rawPutCall = instr.putCall;
  const putCall: "C" | "P" =
    rawPutCall === "CALL"
      ? "C"
      : rawPutCall === "PUT"
        ? "P"
        : parsedSymbol.value.type;

  return {
    occSymbol,
    putCall,
    longQty: pos.longQuantity ?? 0,
    shortQty: pos.shortQuantity ?? 0,
    averagePrice: pos.averagePrice ?? null,
    marketValue: pos.marketValue ?? null,
    underlyingSymbol: instr.underlyingSymbol ?? "",
  };
}

// ─── Adapter type ─────────────────────────────────────────────────────────────

export type SchwabPositionsAdapter = {
  readonly fetchPositions: ForFetchingPositions;
};

/**
 * makeSchwabPositionsAdapter — Schwab trader positions adapter.
 *
 * Mirrors the chain adapter factory shape (PATTERNS.md positions/transactions section).
 * Implements ForFetchingPositions behind the port.
 */
export function makeSchwabPositionsAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): SchwabPositionsAdapter {
  const fetchPositions: ForFetchingPositions = async (
    accountHash: string,
  ): Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>> => {
    // Step 1: Check access token freshness BEFORE any network call (T-04-21)
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      return err(tokenResult.error);
    }
    const accessToken = tokenResult.value;

    // Step 2: Fetch positions. Single-account endpoint is /accounts/{hash}?fields=positions —
    // the trailing slash before the query (/?) returns HTTP 404 against the live API.
    const url = `https://api.schwabapi.com/trader/v1/accounts/${accountHash}?fields=positions`;

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
          message: `Schwab positions returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Step 3: Zod-parse at boundary (T-04-18, D-12)
    const parsed = PositionsResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `Schwab positions parse error: ${parsed.error.message}`,
      });
    }

    const positions = parsed.data.securitiesAccount?.positions ?? [];
    const brokerPositions: BrokerPosition[] = [];

    for (const pos of positions) {
      const mapped = mapPosition(pos);
      if (mapped !== null) {
        brokerPositions.push(mapped);
      }
    }

    return ok(brokerPositions);
  };

  return { fetchPositions };
}
