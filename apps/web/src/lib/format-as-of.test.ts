/**
 * format-as-of.test.ts — direct unit coverage for `formatAsOf`, relocated from
 * CandidateCard.test.tsx's "staleness+source tag" block (19-09-PLAN.md Task 3, D-15/D-16)
 * when the orphaned CandidateCard component was deleted.
 *
 * The original three cases asserted the same contract through a rendered card (fresh dot /
 * amber dot / never "Invalid Date"); they assert it here against the function itself, plus
 * the two branches the render tests never reached (the exact freshness boundary and the
 * future-timestamp `ageMs >= 0` guard).
 */
import { describe, it, expect } from "vitest";
import { formatAsOf } from "./format-as-of.ts";
import { GEX_FRESH_MS } from "../screens/Market.tsx";

/** The exact HH:MM the implementation is required to produce for a given instant. */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

describe("formatAsOf — as-of label + freshness (D-15/D-16, T-19-21)", () => {
  it("labels a just-computed snapshot 'as of {HH:MM}' (24h) and reports it fresh", () => {
    const nowIso = new Date().toISOString();

    expect(formatAsOf(nowIso)).toEqual({ label: `as of ${hhmm(nowIso)}`, fresh: true });
  });

  it("reports a snapshot older than the freshness window as stale, keeping its real HH:MM", () => {
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    expect(formatAsOf(staleIso)).toEqual({ label: `as of ${hhmm(staleIso)}`, fresh: false });
  });

  it("treats an age of exactly GEX_FRESH_MS as stale — the window is half-open", () => {
    const boundaryIso = new Date(Date.now() - GEX_FRESH_MS).toISOString();

    expect(formatAsOf(boundaryIso).fresh).toBe(false);
  });

  it("treats a future timestamp as stale — never claims freshness from a negative age", () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    expect(formatAsOf(futureIso).fresh).toBe(false);
  });

  it("falls back to 'as of —' (em-dash) and stale when observedAt fails to parse, never 'Invalid Date'", () => {
    const result = formatAsOf("not-a-real-date");

    expect(result).toEqual({ label: "as of —", fresh: false });
    expect(result.label.includes("Invalid Date")).toBe(false);
  });
});
