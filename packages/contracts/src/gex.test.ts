/**
 * GEX contract tests (Phase 8, Plan 08-02).
 *
 * gexSnapshotEntry is the single Zod schema source for both GET /api/analytics/gex and the
 * get_gex MCP tool (MCP-02). gexSnapshotResponse = gexSnapshotEntry (single object, not an
 * array — D-03). Oracle values from mockups/gex-snapshot.json + mockups/gex-profile.json.
 */

import { describe, it, expect } from "vitest";
import { gexSnapshotEntry, gexSnapshotResponse, gexWallEntry } from "./gex.ts";

// Oracle payload from mockups/gex-snapshot.json + gex-profile.json.
// spot 7381, flip 7488, callWall 7600, putWall 7400, netGammaAtSpot -47
const oraclePayload = {
  spot: 7381.1201,
  flip: 7488,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -47,
  // WR-01: profile axis field is `spot` (simulated spot-price level), not `strike`
  profile: [
    { spot: 6900, gamma: -34.16 },
    { spot: 7380, gamma: -47.43 },
    { spot: 7500, gamma: 5.98 },
  ],
  strikes: [
    { k: 7400, gex: -5974395559.112409, coi: 17071, poi: 52786, vol: 8406 },
    { k: 7600, gex: 1230277553.8345654, coi: 69015, poi: 39475, vol: 2228 },
  ],
  byExpiry: [
    { date: "2026-06-27", gex: -12345678.9 },
    { date: "2026-07-17", gex: 9876543.2 },
  ],
  nearTerm: { callWall: 7600, putWall: 7400, flip: 7490.5 },
  // 34-04 (TOSP-02): resolved per-expiry carry — FRED-interpolated rate + parity-implied divYield.
  impliedCarry: [{ expiration: "2026-06-27", rate: 0.045, divYield: 0.013 }],
  computedAt: "2026-06-23T14:00:24.000Z",
};

describe("gexSnapshotEntry", () => {
  it("parses the oracle payload (spot 7381, flip 7488, callWall 7600, putWall 7400, netGammaAtSpot -47)", () => {
    expect(() => gexSnapshotEntry.parse(oraclePayload)).not.toThrow();
  });

  it("parsed result matches oracle values", () => {
    const parsed = gexSnapshotEntry.parse(oraclePayload);
    expect(parsed.spot).toBe(7381.1201);
    expect(parsed.flip).toBe(7488);
    expect(parsed.callWall).toBe(7600);
    expect(parsed.putWall).toBe(7400);
    expect(parsed.netGammaAtSpot).toBe(-47);
  });

  it("accepts null flip (no-flip case)", () => {
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, flip: null })).not.toThrow();
  });

  it("accepts null callWall (no call-wall case)", () => {
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, callWall: null })).not.toThrow();
  });

  it("accepts null putWall (no put-wall case)", () => {
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, putWall: null })).not.toThrow();
  });

  it("accepts all three null (flip + callWall + putWall) simultaneously", () => {
    expect(() =>
      gexSnapshotEntry.parse({ ...oraclePayload, flip: null, callWall: null, putWall: null }),
    ).not.toThrow();
  });

  it("rejects a strikes[] entry missing required field coi", () => {
    const badStrikes = [{ k: 7400, gex: -5974395559.112409, poi: 52786, vol: 8406 }]; // coi missing
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, strikes: badStrikes })).toThrow();
  });

  it("rejects a strikes[] entry missing required field gex", () => {
    const badStrikes = [{ k: 7400, coi: 17071, poi: 52786, vol: 8406 }]; // gex missing
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, strikes: badStrikes })).toThrow();
  });

  it("rejects a missing computedAt field", () => {
    const { computedAt: _omit, ...withoutAt } = oraclePayload;
    expect(() => gexSnapshotEntry.parse(withoutAt)).toThrow();
  });

  it("accepts null nearTerm (no near-term legs / pre-0019 snapshot)", () => {
    expect(() => gexSnapshotEntry.parse({ ...oraclePayload, nearTerm: null })).not.toThrow();
  });

  it("accepts nearTerm with null members (e.g. no near-term flip)", () => {
    expect(() =>
      gexSnapshotEntry.parse({
        ...oraclePayload,
        nearTerm: { callWall: 7600, putWall: null, flip: null },
      }),
    ).not.toThrow();
  });

  // 34-04 (TOSP-02): impliedCarry — per-expiry resolved {rate, divYield}.
  it("parsed result includes impliedCarry (resolved per-expiry rate + divYield)", () => {
    const parsed = gexSnapshotEntry.parse(oraclePayload);
    expect(parsed.impliedCarry).toEqual([
      { expiration: "2026-06-27", rate: 0.045, divYield: 0.013 },
    ]);
  });

  it("accepts null impliedCarry (macro/ATM-pair unresolved, or pre-0023 snapshot)", () => {
    expect(() =>
      gexSnapshotEntry.parse({ ...oraclePayload, impliedCarry: null }),
    ).not.toThrow();
  });
});

describe("gexSnapshotResponse (single object, NOT an array)", () => {
  it("parses the oracle payload as a single object", () => {
    expect(() => gexSnapshotResponse.parse(oraclePayload)).not.toThrow();
  });

  it("FAILS when given an array (D-03: single object only)", () => {
    expect(() => gexSnapshotResponse.parse([oraclePayload])).toThrow();
  });
});

describe("gexWallEntry", () => {
  const validWall = { k: 7600, gex: 1230277553.83, coi: 69015, poi: 39475, vol: 2228 };

  it("parses a valid wall entry", () => {
    expect(() => gexWallEntry.parse(validWall)).not.toThrow();
  });

  it("accepts a fractional k (BLOCKER: SPX half-point strikes are valid)", () => {
    // BLOCKER fix: k is z.number() not z.number().int() — fractional strikes are valid
    expect(() => gexWallEntry.parse({ ...validWall, k: 7600.5 })).not.toThrow();
  });
});
