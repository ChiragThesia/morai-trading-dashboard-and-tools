/**
 * chain-format.tsx — the number formatting both chain surfaces share.
 *
 * Lifted verbatim out of the old single ChainTable when it split into Browse + Pair. One copy,
 * because the two surfaces must render the same value identically — an IV that reads 14.52% in
 * the strike ladder and 14.5% in the pair panel is a bug report waiting to happen.
 *
 * The em-dash rule is the reason `Num` exists at all: every derived field in this feature is
 * `number | null`, and null renders as an em dash in tertiary — never 0, never a fabricated
 * number. Zero and no-data are different facts.
 */
import * as React from "react";
import { signClass } from "../../lib/position-format.ts";

export const DASH = "—";
const INT = new Intl.NumberFormat("en-US");

/**
 * Take the sign from the ROUNDED value, not the raw one. Deriving it from the raw value prints
 * "−0.00" for -0.0001 — a minus sign on a displayed zero, which reads as "slightly negative"
 * while showing nothing, the same zero-vs-no-data ambiguity the em-dash rule exists to kill.
 * Rounding first also folds -0 into +0.
 */
function round(v: number, dp: number): number {
  return Number(v.toFixed(dp));
}

/** Minus sign is U+2212 throughout the app (see lib/position-format.ts). */
export function dec(v: number, dp: number): string {
  const r = round(v, dp);
  return r < 0 ? `−${Math.abs(r).toFixed(dp)}` : r.toFixed(dp);
}

export function signedDec(v: number, dp: number): string {
  const r = round(v, dp);
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
}

/** Decimal vol → percent: 0.1452 → "14.52%". Via dec() for the U+2212 minus. */
export function pct(v: number): string {
  return `${dec(v * 100, 2)}%`;
}

/** Decimal vol difference → signed vol points: -0.0061 → "−0.61". */
export function pts(v: number): string {
  return signedDec(v * 100, 2);
}

export function int(v: number): string {
  return INT.format(v);
}

/** "2026-08-11" → "Aug 11". Expiries are calendar dates, so read them in UTC. */
export function shortYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Strike ×1000 → display level. 7412500 → "7412.5". */
export function strikeLabel(strike: number): string {
  return String(strike / 1000);
}

/**
 * One numeric cell. Null is the whole point of this component: it renders the em dash in
 * tertiary, never a zero. `sign` colours by sign — signed numbers only, per the design system
 * (an accent colour must never stand in for a sign).
 */
export function Num({
  v,
  fmt,
  sign = false,
}: {
  v: number | null;
  fmt: (n: number) => string;
  sign?: boolean;
}): React.ReactElement {
  if (v === null) return <span className="text-fg-tertiary">{DASH}</span>;
  return <span className={sign ? signClass(v) : undefined}>{fmt(v)}</span>;
}
