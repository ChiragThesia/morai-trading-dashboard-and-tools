/**
 * position-format.ts — shared money/number formatting helpers + the positions-table Row/
 * ExpiryCell types, used by BOTH Overview's desktop `<table>` and the mobile `PositionCard`
 * (35-04). Extracted out of Overview.tsx so PositionCard doesn't import from Overview.tsx —
 * that would create an Overview → PositionCard → Overview runtime cycle.
 *
 * Money helpers show the exact value Schwab returns — no rounding, no fixed-decimal
 * padding (user directive: "all the decimal points ... no rounding, exact numbers").
 */
import type { BrokerPositionResponse } from "@morai/contracts";

/**
 * Exact decimal representation of a non-negative number — every real digit the
 * value carries, no rounding, no padding. Rounds at 8dp first (kills float noise
 * like 37.490000000000002) then trims trailing zeros/dot.
 */
function exactAbs(absV: number): string {
  return absV.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${exactAbs(Math.abs(v))}`;
}

export function signedUsd(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${exactAbs(Math.abs(v))}`;
}

/** Dollar value without a forced + sign (negatives keep the − minus). */
export function usd(v: number): string {
  return `${v < 0 ? "−" : ""}$${exactAbs(Math.abs(v))}`;
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
