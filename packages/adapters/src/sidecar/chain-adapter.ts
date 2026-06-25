import { z } from "zod";
import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingChain, RawChain, RawQuote, FetchError } from "@morai/core";

// ─── Adapter-local Zod schema (D-08 — MUST NOT live in packages/contracts) ───

const SidecarQuoteSchema = z.object({
  occSymbol: z.string(),
  contractType: z.enum(["C", "P"]),
  strike: z.number(),
  expiry: z.string().datetime(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  mark: z.number().nullable(),
  iv: z.number().nullable(),
  delta: z.number().nullable(),
  gamma: z.number().nullable(),
  theta: z.number().nullable(),
  vega: z.number().nullable(),
  openInterest: z.number().int(),
  volume: z.number().int(),
});

// Schema for non-2xx error bodies (e.g. 503 AUTH_EXPIRED)
const SidecarErrorBodySchema = z.object({
  error: z.string(),
});

export const SidecarChainResponseSchema = z.object({
  root: z.enum(["SPX", "SPXW"]),
  observedAt: z.string().datetime(),
  spot: z.number(),
  quotes: z.array(SidecarQuoteSchema),
  source: z.literal("schwab_chain"),
});

type SidecarQuote = z.infer<typeof SidecarQuoteSchema>;

export type SidecarChainAdapter = {
  readonly fetchChain: ForFetchingChain;
};

/**
 * mapSidecarQuote — converts a Zod-parsed sidecar quote to RawQuote.
 *
 * Parses the occSymbol string through parseOccSymbol → formatOccSymbol to produce
 * a branded OccSymbol without type assertions (typescript.md: no as/!/any).
 * Quotes with unparseable OCC symbols are silently dropped (null → caller skips).
 */
function mapSidecarQuote(q: SidecarQuote): RawQuote | null {
  const parsedOcc = parseOccSymbol(q.occSymbol);
  if (!parsedOcc.ok) {
    return null;
  }
  const occSymbol = formatOccSymbol(parsedOcc.value);

  return {
    occSymbol,
    contractType: q.contractType,
    strike: q.strike,
    expiry: new Date(q.expiry),
    bid: q.bid,
    ask: q.ask,
    mark: q.mark,
    iv: q.iv,
    delta: q.delta,
    gamma: q.gamma,
    theta: q.theta,
    vega: q.vega,
    openInterest: q.openInterest,
    volume: q.volume,
  };
}

/**
 * makeSidecarChainAdapter — HTTP adapter for the Python sidecar's /sidecar/chain endpoint.
 *
 * Implements the existing ForFetchingChain port (MKT-01).
 * Calls GET {sidecarUrl}/sidecar/chain?root={root} and Zod-safeParses the response.
 *
 * T-11-03-01: SidecarChainResponseSchema.safeParse at the boundary — err on failure, never throw.
 * T-11-03-02: Returns only {kind, message} — no token/secret material on the chain path.
 * T-11-03-03: Network error → err({kind:'fetch-error'}) — never throws to the caller.
 *
 * Injection contract: deps.fetch is always injected (never globalThis.fetch inside the adapter)
 * so Vitest's msw/in-memory swaps work without patching global scope.
 */
export function makeSidecarChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  sidecarUrl: string;
}): SidecarChainAdapter {
  const fetchChain: ForFetchingChain = async (
    root: "SPX" | "SPXW",
  ): Promise<Result<RawChain, FetchError>> => {
    let rawBody: unknown;
    try {
      const resp = await deps.fetch(
        `${deps.sidecarUrl}/sidecar/chain?root=${root}`,
      );
      if (!resp.ok) {
        // AUTH_EXPIRED (503) → extract error key from body; fallback to HTTP <status>
        let errorMsg: string;
        try {
          const rawErrBody: unknown = await resp.json();
          const errParsed = SidecarErrorBodySchema.safeParse(rawErrBody);
          errorMsg = errParsed.success
            ? errParsed.data.error
            : `HTTP ${resp.status}`;
        } catch {
          errorMsg = `HTTP ${resp.status}`;
        }
        return err({ kind: "fetch-error", message: errorMsg });
      }
      rawBody = await resp.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Zod-parse before core sees any data (T-11-03-01)
    const parsed = SidecarChainResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `sidecar chain parse error: ${parsed.error.message}`,
      });
    }

    const d = parsed.data;

    // Map each quote — silently drop entries with unparseable OCC symbols
    const quotes: RawQuote[] = [];
    for (const q of d.quotes) {
      const quote = mapSidecarQuote(q);
      if (quote !== null) {
        quotes.push(quote);
      }
    }

    const chain: RawChain = {
      root: d.root,
      observedAt: new Date(d.observedAt),
      spot: d.spot,
      quotes,
      source: d.source,
    };

    return ok(chain);
  };

  return { fetchChain };
}
