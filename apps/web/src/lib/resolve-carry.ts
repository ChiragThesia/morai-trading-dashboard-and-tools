/**
 * resolve-carry.ts — per-expiry {rate, divYield} lookup over the GEX snapshot's
 * `impliedCarry` (34-04: FRED-interpolated r AND put-call-parity-implied q, resolved
 * together server-side). Pure lookup — does NOT interpolate FRED client-side, which
 * would risk desyncing r from the q it was solved against.
 */
import type { GexSnapshotResponse } from "@morai/contracts";

/** Flat carry fallback — mirrors Overview.tsx's ScenarioParams floor. */
export const DEFAULT_RATE = 0.045;
export const DEFAULT_DIV = 0.013;

/**
 * Look up a leg's per-expiry carry from `gex.impliedCarry`. Degrades to
 * DEFAULT_RATE/DEFAULT_DIV when `gex` is undefined, `impliedCarry` is null, or no
 * entry matches `expiration` — total, never throws.
 */
export function resolveCarry(
  gex: GexSnapshotResponse | undefined,
  expiration: string,
): { readonly rate: number; readonly divYield: number } {
  const entry = gex?.impliedCarry?.find((e) => e.expiration === expiration);
  return entry === undefined
    ? { rate: DEFAULT_RATE, divYield: DEFAULT_DIV }
    : { rate: entry.rate, divYield: entry.divYield };
}
