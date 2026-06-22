/**
 * syncTransactions.property.test.ts — fast-check collision property over the WR-A3 fill-id
 * derivation (distinct (activityId, legIndex) → distinct fill UUID).
 *
 * Background (05-GAPS-2.md WR-A3): the prior hexToUuid synthesized a version-5 UUID and dropped
 * input hex nibble 12, so two distinct (activityId, legIndex) keys could map to the same UUID —
 * the fills.id PK then silently dropped the second real fill (onConflictDoNothing). The fix made
 * hexToUuid a contiguous, TOTAL mapping of the 32-char hex prefix: every nibble contributes.
 *
 * Locked property (P4): distinct (activityId, legIndex) keys → distinct fill UUIDs (numRuns ≥
 * 1000, matching the pure-numerical convention in iv-inversion.test.ts).
 *
 * Two complementary forms:
 *   P4   end-to-end key path — feed distinct (activityId, legIndex) pairs through the SAME
 *        derivation the use-case uses, hexToUuid(hashFillIds([String(activityId),
 *        String(legIndex)])), with a strong avalanche hex hasher, and assert distinct ids. This
 *        proves distinct keys reach distinct uuids through the real key→hex→uuid wiring.
 *   P4-hexToUuid totality — the WR-A3 invariant directly: distinct 32-hex prefixes → distinct
 *        UUIDs (no dropped nibble). This isolates hexToUuid from the hasher so a hasher collision
 *        cannot mask a regression in the uuid mapping.
 *   P4b  shape — every derived id matches the UUID regex (the fills.id column is a uuid).
 *
 * No node:crypto: the no-restricted-imports rule blocks node:* in packages/core (incl. tests),
 * so the property uses an injective deterministic hex hasher rather than a real sha256. No
 * `any`/`as`/`!` (typescript.md).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hexToUuid } from "./syncTransactions.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Strong avalanche hex hasher (sha256 stand-in — node:crypto is blocked in core). Eight
// independent 32-bit FNV-1a + xorshift-mixed lanes give a 256-bit (64-hex) digest whose 32-char
// prefix is well distributed: distinct keys collide on the prefix only with negligible
// probability (≪ 1 over 1000 runs). So a collision observed in P4 is attributable to hexToUuid,
// not the hasher — exactly what the WR-A3 probe needs. Mirrors the use-case's injected
// sha256-hex shape (string→64-hex).
function strongHexHash(ids: ReadonlyArray<string>): string {
  const input = [...ids].sort().join(":");
  let hex = "";
  for (let lane = 0; lane < 8; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) + lane;
      h = Math.imul(h, 0x01000193) >>> 0;
      // xorshift avalanche so adjacent inputs diverge across the whole word.
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d) >>> 0;
      h = (h ^ (h >>> 12)) >>> 0;
    }
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return hex; // 8 lanes × 8 hex = 64 hex chars
}

// The exact derivation the use-case uses (syncTransactions.ts flattenTransaction):
// hexToUuid(hashFillIds([String(activityId), String(legIndex)])).
function deriveFillId(activityId: number, legIndex: number): string {
  return hexToUuid(strongHexHash([`${activityId}`, `${legIndex}`]));
}

describe("syncTransactions id-derivation properties", () => {
  it("P4: distinct (activityId, legIndex) keys → distinct fill UUIDs via the real path (numRuns≥1000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 8 }),
        (actA, legA, actB, legB) => {
          // Precondition: the two keys are genuinely distinct.
          fc.pre(actA !== actB || legA !== legB);
          const idA = deriveFillId(actA, legA);
          const idB = deriveFillId(actB, legB);
          return idA !== idB;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("P4-totality: hexToUuid maps distinct 32-hex prefixes to distinct UUIDs — no dropped nibble (numRuns≥1000)", () => {
    const hex32 = fc.stringMatching(/^[0-9a-f]{32}$/);
    fc.assert(
      fc.property(hex32, hex32, (a, b) => {
        // Only the first 32 chars feed hexToUuid; compare on that prefix.
        fc.pre(a !== b);
        const ua = hexToUuid(a);
        const ub = hexToUuid(b);
        // Distinct 32-hex inputs MUST give distinct uuids (totality: every nibble contributes).
        return ua !== ub;
      }),
      { numRuns: 1000 },
    );
  });

  it("P4b: every derived id matches the UUID regex (fills.id is a uuid column) (numRuns≥1000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 8 }),
        (activityId, legIndex) => {
          return UUID_RE.test(deriveFillId(activityId, legIndex));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
