/**
 * Streaming bounded context — domain types and driven ports
 *
 * Hexagon rule: this file imports ONLY @morai/shared. No frameworks, no SSE primitives,
 * no process.env, no hono, no fastapi types.
 *
 * Naming convention: ForVerbingNoun function-type ports (architecture-boundaries.md §5).
 */

import type { Result } from "@morai/shared";

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * RawOptionTick — a single LEVELONE_OPTIONS message from the sidecar streamer.
 *
 * mark, bid, ask, underlyingPrice are nullable: Schwab sends only changed fields
 * on incremental ticks (Pitfall 4). mark may be absent if unchanged since last tick.
 * underlyingPrice is UNDERLYING_PRICE (field 35) — eliminates a separate index subscription.
 *
 * ts is an ISO-8601 UTC string, always ending in "Z" (chain_proxy.py Z-suffix lesson).
 */
export type RawOptionTick = {
  readonly occSymbol: string;
  readonly mark: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly underlyingPrice: number | null;
  readonly ts: string;
};

/**
 * LiveGreekTick — a recomputed live greek snapshot for one OCC symbol.
 *
 * All greek values are BSM-derived (D-02) — never Schwab raw LEVELONE greeks.
 * Display-only (STRM-04): this type is never persisted to leg_observations.
 *
 * mark: the price used for IV inversion (mark if available, else midpoint).
 * bid/ask: passed through from the raw tick for display.
 * ts: ISO-8601 UTC string ending in "Z".
 */
export type LiveGreekTick = {
  readonly occSymbol: string;
  readonly mark: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bsmIv: number;
  readonly bsmDelta: number;
  readonly bsmGamma: number;
  readonly bsmTheta: number;
  readonly bsmVega: number;
  readonly ts: string;
};

/**
 * ReconciledPosition — a current open position from the sidecar /sidecar/positions endpoint.
 *
 * Shape mirrors streamReconcileEvent positions items (structural parity enforced by
 * the position-reconciler contract test). marketValue nullable because it may not be
 * available for all positions.
 */
export type ReconciledPosition = {
  readonly occSymbol: string;
  readonly longQty: number;
  readonly shortQty: number;
  readonly underlyingSymbol: string;
  readonly marketValue: number | null;
};

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * StreamReconcileError — reasons the position reconciler can fail.
 */
export type StreamReconcileError =
  | { readonly kind: "AuthExpired" }
  | { readonly kind: "NetworkError" }
  | { readonly kind: "ParseError"; readonly detail: string };

// ─── Driven port ──────────────────────────────────────────────────────────────

/**
 * ForReconcilingPositions — fetch the current open positions for stream subscription seeding.
 *
 * Called on stream connect and reconnect (STRM-05) to provide the reconcile event and
 * the initial subscription symbol set. The sidecar /sidecar/positions endpoint implements
 * this in production; the in-memory twin implements it for tests.
 *
 * Named ForVerbingNoun per architecture convention (ForStreamingQuotes-style port).
 * Returns a ReadonlyArray so callers cannot mutate the result.
 */
export type ForReconcilingPositions = () => Promise<
  Result<ReadonlyArray<ReconciledPosition>, StreamReconcileError>
>;
