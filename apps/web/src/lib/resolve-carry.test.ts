import { describe, it, expect } from "vitest";
import { resolveCarry, DEFAULT_RATE, DEFAULT_DIV } from "./resolve-carry.ts";
import type { GexSnapshotResponse } from "@morai/contracts";

/**
 * resolveCarry: a pure per-expiry {rate, divYield} lookup over the GEX snapshot's
 * `impliedCarry` (34-04) — degrades to the flat DEFAULT_RATE/DEFAULT_DIV whenever the
 * snapshot, the field, or the matching expiry entry is absent. No client-side FRED
 * interpolation (the server already solves r and q together, 34-04 delivery note).
 */

const GEX: GexSnapshotResponse = {
  spot: 7400,
  flip: null,
  callWall: null,
  putWall: null,
  netGammaAtSpot: 0,
  profile: [],
  strikes: [],
  byExpiry: [],
  nearTerm: null,
  impliedCarry: [
    { expiration: "2026-07-24", rate: 0.0512, divYield: 0.0141 },
    { expiration: "2026-08-21", rate: 0.049, divYield: 0.0138 },
  ],
  computedAt: "2026-07-11T14:00:00.000Z",
};

describe("resolveCarry", () => {
  it("returns the per-expiry {rate, divYield} when the snapshot has a matching entry", () => {
    expect(resolveCarry(GEX, "2026-07-24")).toEqual({ rate: 0.0512, divYield: 0.0141 });
    expect(resolveCarry(GEX, "2026-08-21")).toEqual({ rate: 0.049, divYield: 0.0138 });
  });

  it("degrades to DEFAULT_RATE/DEFAULT_DIV when gex is undefined", () => {
    expect(resolveCarry(undefined, "2026-07-24")).toEqual({ rate: DEFAULT_RATE, divYield: DEFAULT_DIV });
  });

  it("degrades to DEFAULT_RATE/DEFAULT_DIV when impliedCarry is null", () => {
    const gex: GexSnapshotResponse = { ...GEX, impliedCarry: null };
    expect(resolveCarry(gex, "2026-07-24")).toEqual({ rate: DEFAULT_RATE, divYield: DEFAULT_DIV });
  });

  it("degrades to DEFAULT_RATE/DEFAULT_DIV when no entry matches the expiration", () => {
    expect(resolveCarry(GEX, "2026-12-31")).toEqual({ rate: DEFAULT_RATE, divYield: DEFAULT_DIV });
  });
});
