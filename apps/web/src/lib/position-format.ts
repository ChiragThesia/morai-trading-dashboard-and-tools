/**
 * position-format.ts — shared money/number formatting helpers + the positions-table Row/
 * ExpiryCell types, used by BOTH Overview's desktop `<table>` and the mobile `PositionCard`
 * (35-04). Extracted out of Overview.tsx so PositionCard doesn't import from Overview.tsx —
 * that would create an Overview → PositionCard → Overview runtime cycle.
 *
 * Decimal policy (2026-07-15 user directive, superseding the 35-04 "exact numbers" ask):
 * $ values cap at 2 decimals, unitless greeks at 3 — full floats read as noise on the
 * positions table and net-greek tiles. Trailing zeros are still trimmed.
 */
import type { BrokerPositionResponse } from "@morai/contracts";

/** Capped-decimal representation: round at `dp`, trim trailing zeros/dot. */
export function exactAbs(absV: number, dp: number = 2): string {
  return absV.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
}

/** Unitless greek scale — 3 decimals so gamma (−0.013) keeps its signal. */
export function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${exactAbs(Math.abs(v), 3)}`;
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
