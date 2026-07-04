/**
 * Picker contract tests (Phase 18, D-01).
 *
 * pickerCandidate/pickerSnapshotResponse is the single Zod schema source for both the
 * Phase-19 GET /api/picker/candidates response and the get_picker_candidates MCP tool
 * (MCP-02). Oracle values ported from mockups/playground-v4.html's real buildCandidates()
 * output over the 2026-07-01 chain snapshot (D-03).
 */

import { describe, it, expect } from "vitest";
import { breakdownEntry, pickerCandidate, pickerSnapshotResponse } from "./picker.ts";
import { pickerSnapshotFixture } from "./__fixtures__/picker-candidates.fixture.ts";

// Oracle payload — one real candidate from mockups/playground-v4.html buildCandidates()
// OUTPUT (top-scored: 7500P Jul 23 / Aug 14, score 47).
const oraclePayload = {
  id: "7500-260723-260814",
  name: "7500P Jul 23 / Aug 14",
  score: 47,
  breakdown: [
    { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
    { criterion: "fwdEdge", weight: 25, rawValue: -0.028487, contribution: 0 },
    { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
    { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
    { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
  ],
  debit: 4627.55,
  theta: 45.896,
  vega: 305.343,
  delta: 1.198,
  fwdIv: 0.153387,
  fwdIvGuard: "ok",
  slope: 0.253841,
  fwdEdge: -0.028487,
  expectedMove: 224.657,
  frontEvents: ["NFP", "CPI"],
  backEvents: ["FOMC"],
  frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.1249 },
  backLeg: { strike: 7500, putCall: "P", dte: 43, iv: 0.1402 },
  exitPlan: {
    profitTargetPct: 0.25,
    stopPct: 0.175,
    manageShortDte: 21,
    closeByExpiry: "2026-07-23",
  },
};

describe("pickerCandidate", () => {
  it("parses the oracle payload (7500P Jul 23 / Aug 14, score 47)", () => {
    expect(() => pickerCandidate.parse(oraclePayload)).not.toThrow();
  });

  it("REJECTS a malformed breakdown entry with an out-of-enum criterion", () => {
    const malformed = {
      ...oraclePayload,
      breakdown: [
        { criterion: "ivRankGate", weight: 40, rawValue: 0.5, contribution: 50 },
        ...oraclePayload.breakdown.slice(1),
      ],
    };
    expect(() => pickerCandidate.parse(malformed)).toThrow();
  });

  it("REJECTS a breakdown entry missing a required numeric field", () => {
    const malformed = {
      ...oraclePayload,
      breakdown: [
        { criterion: "slope", weight: 40, contribution: 42.31 }, // rawValue missing
        ...oraclePayload.breakdown.slice(1),
      ],
    };
    expect(() => pickerCandidate.parse(malformed)).toThrow();
  });

  it("parses a guard-case candidate (fwdIv: null, fwdIvGuard: 'inverted') clean", () => {
    const guardPayload = { ...oraclePayload, fwdIv: null, fwdIvGuard: "inverted", fwdEdge: 0 };
    expect(() => pickerCandidate.parse(guardPayload)).not.toThrow();
  });
});

describe("breakdownEntry.criterion (closed enum, structurally excludes REFUTED criteria)", () => {
  const base = { weight: 10, rawValue: 0.5, contribution: 50 };

  it.each(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"] as const)(
    "accepts criterion '%s'",
    (criterion) => {
      expect(() => breakdownEntry.parse({ ...base, criterion })).not.toThrow();
    },
  );

  it("rejects a REFUTED criterion (e.g. ivRankGate) — not in the closed enum", () => {
    expect(() => breakdownEntry.parse({ ...base, criterion: "ivRankGate" })).toThrow();
  });

  it("rejects any other out-of-enum criterion string", () => {
    expect(() => breakdownEntry.parse({ ...base, criterion: "ivDiffBand" })).toThrow();
  });
});

describe("pickerSnapshotFixture (frozen fixture — D-03)", () => {
  it("parses the frozen pickerSnapshotFixture clean", () => {
    expect(() => pickerSnapshotResponse.parse(pickerSnapshotFixture)).not.toThrow();
  });

  it("carries an asOf reference date the DTE fields are relative to (WR-03)", () => {
    expect(typeof pickerSnapshotFixture.asOf).toBe("string");
  });

  it("REJECTS a snapshot missing asOf (the DTE/event x-axis needs a reference date — WR-03)", () => {
    const { asOf: _omit, ...withoutAsOf } = pickerSnapshotFixture;
    expect(() => pickerSnapshotResponse.parse(withoutAsOf)).toThrow();
  });

  it("contains exactly ONE guard-case candidate (fwdIv null + fwdIvGuard 'inverted')", () => {
    const guardCandidates = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIv === null && c.fwdIvGuard === "inverted",
    );
    expect(guardCandidates).toHaveLength(1);
  });

  it("every non-guard candidate has fwdIv !== null and fwdIvGuard === 'ok'", () => {
    const nonGuard = pickerSnapshotFixture.candidates.filter((c) => c.fwdIvGuard !== "inverted");
    expect(nonGuard.every((c) => c.fwdIv !== null && c.fwdIvGuard === "ok")).toBe(true);
  });

  it("the guard-case candidate's expectedMove/theta/vega/score are all finite non-null numbers (Pitfall 3)", () => {
    const guard = pickerSnapshotFixture.candidates.find((c) => c.fwdIvGuard === "inverted");
    expect(guard).toBeDefined();
    expect(Number.isFinite(guard?.expectedMove)).toBe(true);
    expect(Number.isFinite(guard?.theta)).toBe(true);
    expect(Number.isFinite(guard?.vega)).toBe(true);
    expect(Number.isFinite(guard?.score)).toBe(true);
  });

  it("every candidate's breakdown array contains all five criteria exactly once", () => {
    const allCriteria = ["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"].sort();
    for (const candidate of pickerSnapshotFixture.candidates) {
      const criteria = candidate.breakdown.map((entry) => entry.criterion).sort();
      expect(criteria).toEqual(allCriteria);
    }
  });

  it("has between 6 and 8 non-guard candidates plus exactly 1 guard-case candidate", () => {
    const nonGuardCount = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIvGuard !== "inverted",
    ).length;
    const guardCount = pickerSnapshotFixture.candidates.filter(
      (c) => c.fwdIvGuard === "inverted",
    ).length;
    expect(nonGuardCount).toBeGreaterThanOrEqual(6);
    expect(nonGuardCount).toBeLessThanOrEqual(8);
    expect(guardCount).toBe(1);
  });
});
