/**
 * resolveRootCandidates tests (Phase 40, Plan 01, HIST-01) — example + fast-check property.
 *
 * Invariants:
 *   - "SPX" -> ["SPX", "SPXW"] (stored root first, sibling second).
 *   - "SPXW" -> ["SPXW"] only (unambiguous — no split possible).
 *   - Pure, total: never throws.
 *   - fast-check: for any underlying in {"SPX","SPXW"}, the result is non-empty, contains
 *     only valid roots, has no duplicates, and always includes the input root.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveRootCandidates } from "./occ-root.ts";

describe("resolveRootCandidates", () => {
  it('returns ["SPX", "SPXW"] for "SPX" (stored root first, sibling second)', () => {
    expect(resolveRootCandidates("SPX")).toEqual(["SPX", "SPXW"]);
  });

  it('returns ["SPXW"] only for "SPXW" (unambiguous)', () => {
    expect(resolveRootCandidates("SPXW")).toEqual(["SPXW"]);
  });

  it("fast-check: non-empty, valid roots only, no duplicates, always includes the input root", () => {
    fc.assert(
      fc.property(fc.constantFrom("SPX", "SPXW"), (underlying) => {
        const result = resolveRootCandidates(underlying);
        expect(result.length).toBeGreaterThan(0);
        for (const root of result) {
          expect(["SPX", "SPXW"]).toContain(root);
        }
        expect(new Set(result).size).toBe(result.length);
        expect(result).toContain(underlying);
      }),
    );
  });
});
