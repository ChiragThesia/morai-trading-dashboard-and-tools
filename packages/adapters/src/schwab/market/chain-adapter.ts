import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingChain, RawChain, RawQuote, FetchError } from "@morai/core";
import type { AuthExpiredError } from "@morai/core";
import { parseSchwabSymbol } from "./schwab-symbol.ts";

// ─── Schwab market data chains endpoint ───────────────────────────────────────

const SCHWAB_CHAIN_URL = "https://api.schwabapi.com/marketdata/v1/chains";

// ─── Zod schemas (T-04-14: safeParse at boundary — never throw) ───────────────

const OptionContractSchema = z
  .object({
    putCall: z.enum(["CALL", "PUT"]).optional(),
    symbol: z.string().optional(),
    bidPrice: z.number().optional(),
    askPrice: z.number().optional(),
    lastPrice: z.number().optional(),
    markPrice: z.number().optional(),
    totalVolume: z.number().optional(),
    openInterest: z.number().optional(),
    volatility: z.number().optional(),
    delta: z.number().optional(),
    gamma: z.number().optional(),
    theta: z.number().optional(),
    vega: z.number().optional(),
    rho: z.number().optional(),
    strikePrice: z.number().optional(),
    expirationDate: z.string().optional(),
    daysToExpiration: z.number().optional(),
    multiplier: z.number().optional(),
    isIndexOption: z.boolean().optional(),
  })
  .passthrough(); // keep unknown fields, never throw on new Schwab fields

// Nested map: expiry string → strike string → OptionContract[]
// Schema is medium-confidence (RESEARCH.md) — all fields optional + passthrough
const OptionDateMapSchema = z.record(
  z.string(),
  z.record(z.string(), z.array(OptionContractSchema)),
);

const SchwabChainResponseSchema = z
  .object({
    underlyingPrice: z.number().optional(),
    callExpDateMap: OptionDateMapSchema.optional(),
    putExpDateMap: OptionDateMapSchema.optional(),
  })
  .passthrough();

type OptionContract = z.infer<typeof OptionContractSchema>;
type OptionDateMap = z.infer<typeof OptionDateMapSchema>;

// ─── Flattener: nested map → RawQuote[] ───────────────────────────────────────

function mapSchwabContract(contract: OptionContract): RawQuote | null {
  if (contract.symbol === undefined || contract.symbol.length === 0) {
    return null;
  }

  const parsedSymbol = parseSchwabSymbol(contract.symbol);
  if (!parsedSymbol.ok) {
    return null;
  }

  const occSymbol = formatOccSymbol(parsedSymbol.value);

  const bid = contract.bidPrice ?? null;
  const ask = contract.askPrice ?? null;
  // markPrice preferred; fallback to (bid+ask)/2 when both present
  const mark =
    contract.markPrice !== undefined
      ? contract.markPrice
      : bid !== null && ask !== null
        ? (bid + ask) / 2
        : null;

  // strikePrice from Schwab is already in points (e.g. 5950), not ×1000
  const strike = contract.strikePrice ?? parsedSymbol.value.strike;

  // Determine contractType from putCall field or symbol parse
  const contractType: "C" | "P" =
    contract.putCall === "CALL"
      ? "C"
      : contract.putCall === "PUT"
        ? "P"
        : parsedSymbol.value.type;

  return {
    occSymbol,
    contractType,
    strike,
    expiry: parsedSymbol.value.expiry,
    bid,
    ask,
    mark,
    iv: contract.volatility ?? null,
    delta: contract.delta ?? null,
    gamma: contract.gamma ?? null,
    theta: contract.theta ?? null,
    vega: contract.vega ?? null,
    openInterest: contract.openInterest ?? 0,
    volume: contract.totalVolume ?? 0,
  };
}

function flattenExpDateMap(
  expDateMap: OptionDateMap,
): RawQuote[] {
  const quotes: RawQuote[] = [];
  for (const strikeMap of Object.values(expDateMap)) {
    for (const contracts of Object.values(strikeMap)) {
      for (const contract of contracts) {
        const quote = mapSchwabContract(contract);
        if (quote !== null) {
          quotes.push(quote);
        }
      }
    }
  }
  return quotes;
}

// ─── Adapter type ─────────────────────────────────────────────────────────────

export type SchwabChainAdapter = {
  readonly fetchChain: ForFetchingChain;
};

/**
 * makeSchwabChainAdapter — Schwab market data chain adapter.
 *
 * Mirrors the CBOE chain adapter factory shape (PATTERNS.md chain-adapter section).
 * Implements ForFetchingChain behind the same port as the CBOE adapter.
 *
 * T-04-14: SchwabChainResponseSchema.safeParse before any data reaches core.
 * T-04-15: Bearer token never logged; only {kind, message} returned on error.
 * T-04-16: getAccessToken err → short-circuit before network call.
 *
 * SC3 fix: strikeCount/range/fromDate/toDate scope the request so the Schwab gateway
 * does not overflow (HTTP 502 "Body buffer overflow" when fetching the full SPX chain).
 * All four scoping params are injected via deps — no magic numbers in this file.
 *
 * @param deps.fetch          - Injected fetch (never globalThis.fetch directly)
 * @param deps.getAccessToken - Returns ok(token) or err(AUTH_EXPIRED) — checked first
 * @param deps.userAgent      - User-Agent header for requests
 * @param deps.symbol         - Caller-supplied symbol ($SPX vs SPX — RESEARCH A3; not hardcoded)
 * @param deps.strikeCount    - Strikes around ATM to request (e.g. 50) — limits response size
 * @param deps.range          - Schwab range filter (e.g. "NTM") — near-the-money only
 * @param deps.fromDate       - Start expiration date YYYY-MM-DD — bounds the chain to near-term
 * @param deps.toDate         - End expiration date YYYY-MM-DD — covers near + calendar back months
 */
export function makeSchwabChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
  symbol: string;
  strikeCount: number;
  range: string;
  fromDate: string;
  toDate: string;
}): SchwabChainAdapter {
  const fetchChain: ForFetchingChain = async (
    root: "SPX" | "SPXW",
  ): Promise<Result<RawChain, FetchError>> => {
    // Step 1: Check access token freshness BEFORE any network call (T-04-16)
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      // Never log the token; only return the error kind
      return err({ kind: "fetch-error", message: "AUTH_EXPIRED" });
    }
    const accessToken = tokenResult.value;

    // Step 2: Fetch the chain from Schwab — symbol is caller-supplied (RESEARCH A3).
    // SC3: scoping params (strikeCount/range/fromDate/toDate) are REQUIRED to keep the
    // response under Schwab's gateway buffer limit. Without them, the full SPX chain
    // (all expirations × all strikes) causes HTTP 502 "Body buffer overflow".
    const url = new URL(SCHWAB_CHAIN_URL);
    url.searchParams.set("symbol", deps.symbol);
    url.searchParams.set("contractType", "ALL");
    url.searchParams.set("strikeCount", String(deps.strikeCount));
    url.searchParams.set("range", deps.range);
    url.searchParams.set("fromDate", deps.fromDate);
    url.searchParams.set("toDate", deps.toDate);

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
          message: `Schwab returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Step 3: Zod-parse before any data reaches core (T-04-14)
    const parsed = SchwabChainResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `Schwab chain parse error: ${parsed.error.message}`,
      });
    }

    const payload = parsed.data;

    // Step 4: Extract spot price from top-level underlyingPrice
    const spot = payload.underlyingPrice;
    if (spot === undefined || spot === 0) {
      return err({
        kind: "fetch-error",
        message: "Schwab chain response missing underlyingPrice",
      });
    }

    // Step 5: Flatten callExpDateMap + putExpDateMap → RawQuote[]
    const callQuotes = payload.callExpDateMap !== undefined
      ? flattenExpDateMap(payload.callExpDateMap)
      : [];
    const putQuotes = payload.putExpDateMap !== undefined
      ? flattenExpDateMap(payload.putExpDateMap)
      : [];
    const quotes: RawQuote[] = [...callQuotes, ...putQuotes];

    // Step 6: observedAt — use current time (Schwab chain response has no top-level timestamp)
    const observedAt = new Date();

    const chain: RawChain = {
      root,
      observedAt,
      spot,
      quotes,
      source: "schwab_chain",
    };

    return ok(chain);
  };

  return { fetchChain };
}
