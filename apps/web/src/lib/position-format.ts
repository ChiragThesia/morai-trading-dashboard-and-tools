/**
 * position-format.ts — shared money/number formatting helpers + the positions-table Row/
 * ExpiryCell types, used by BOTH Overview's desktop `<table>` and the mobile `PositionCard`
 * (35-04). Extracted out of Overview.tsx so PositionCard doesn't import from Overview.tsx —
 * that would create an Overview → PositionCard → Overview runtime cycle.
 *
 * Moved verbatim (no output/behavior change) — same default `dp` args, same rounding.
 */
import type { BrokerPositionResponse } from "@morai/contracts";

/**
 * Truncate a non-negative number to `dp` decimals WITHOUT rounding, padded to `dp` places.
 * Round at dp+2 first (kills float noise like 186.5799999) then string-slice — so the
 * displayed digits never round the value up.
 */
function truncFixed(absV: number, dp: number): string {
  const s = absV.toFixed(dp + 2);
  const dot = s.indexOf(".");
  return dp === 0 ? s.slice(0, dot) : s.slice(0, dot + 1 + dp);
}

export function signed(v: number, dp = 3): string {
  return `${v >= 0 ? "+" : "−"}${truncFixed(Math.abs(v), dp)}`;
}

export function signedUsd(v: number, dp = 3): string {
  return `${v >= 0 ? "+" : "−"}$${truncFixed(Math.abs(v), dp)}`;
}

/** Dollar value without a forced + sign (negatives keep the − minus). */
export function usd(v: number, dp = 3): string {
  return `${v < 0 ? "−" : ""}$${truncFixed(Math.abs(v), dp)}`;
}

export function signClass(v: number): string {
  return v >= 0 ? "text-up" : "text-down";
}

/** Structured expiry/DTE cell (OVW-03). */
export type ExpiryCell = {
  readonly line1: string;
  readonly line2: string;
};

export type Row = {
  key: string;
  label: string;
  expiry: ExpiryCell;
  legs: ReadonlyArray<BrokerPositionResponse>;
};
