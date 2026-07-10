/**
 * rule-preview contract tests (Phase 32, Plan 01 — B4/B5/B7).
 *
 * previewRuleOverridesRequest is identity-reused from ruleOverrides (T-32-05): the same
 * .strict() + weight-sum-100 + hysteresis-pair refinements the PUT route already enforces.
 * previewRuleOverridesResponse fixes the picker/exits staged-change wire shape: full
 * re-scored candidate list with oldScore inline, gate/sizing before-after, universe honest
 * note, exits current-vs-staged, and the snapshot asOf staleness marker.
 */

import { describe, it, expect } from "vitest";
import { assertDefined } from "@morai/shared";
import { ruleOverrides } from "./rule-settings.ts";
import { previewRuleOverridesRequest, previewRuleOverridesResponse } from "./rule-preview.ts";
import { pickerSnapshotFixture } from "./__fixtures__/picker-candidates.fixture.ts";

// ─── Request === ruleOverrides (identity reuse, not a copy) ────────────────────────

describe("previewRuleOverridesRequest — identity reuse of ruleOverrides", () => {
  it("is the exact same schema object as ruleOverrides", () => {
    expect(previewRuleOverridesRequest).toBe(ruleOverrides);
  });

  it("accepts the empty-groups request {}", () => {
    expect(previewRuleOverridesRequest.safeParse({}).success).toBe(true);
  });

  it("rejects a body that violates the reused weight-sum-100 invariant", () => {
    const badWeights = {
      slope: 9,
      fwdEdge: 25,
      gexFit: 10,
      eventAdjustment: 5,
      beVsEm: 15,
      deltaNeutral: 15,
      thetaVega: 10,
      vrp: 5,
      debitFit: 5,
    };
    const result = previewRuleOverridesRequest.safeParse({ picker: { weights: badWeights } });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key (same .strict() as the PUT body)", () => {
    expect(previewRuleOverridesRequest.safeParse({ foo: 1 }).success).toBe(false);
  });
});

// ─── Response round-trip ────────────────────────────────────────────────────────────

const oracleCandidate = pickerSnapshotFixture.candidates[0];
assertDefined(oracleCandidate, "rule-preview.test.ts: pickerSnapshotFixture.candidates[0]");

const oracleCandidateWithOldScore = { ...oracleCandidate, oldScore: oracleCandidate.score - 4.5 };

const oracleExitEntry = {
  calendarId: "cal-1",
  current: { verdict: "HOLD", rung: null, ruleId: "hold" },
  staged: {
    verdict: "TAKE",
    rung: "+15%",
    ruleId: "take",
    metric: { name: "pnlPct", value: 0.16, threshold: 0.15 },
  },
};

const representativePickerBranch = {
  candidates: [oracleCandidateWithOldScore],
  gate: { before: pickerSnapshotFixture.gate, after: pickerSnapshotFixture.gate },
  sizing: { before: pickerSnapshotFixture.sizing, after: pickerSnapshotFixture.sizing },
  universeNote: null,
};

const representativeResponse = {
  asOf: pickerSnapshotFixture.asOf,
  picker: representativePickerBranch,
  exits: [oracleExitEntry],
};

describe("previewRuleOverridesResponse", () => {
  it("round-trips a representative response", () => {
    const result = previewRuleOverridesResponse.safeParse(representativeResponse);
    expect(result.success).toBe(true);
  });

  it("carries both oldScore and score (newScore) per picker candidate", () => {
    const result = previewRuleOverridesResponse.safeParse(representativeResponse);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const candidate = result.data.picker?.candidates[0];
    expect(candidate?.oldScore).toBeDefined();
    expect(candidate?.score).toBeDefined();
  });

  it("accepts null asOf/picker/exits (no stored snapshot / no applicable branch yet)", () => {
    const result = previewRuleOverridesResponse.safeParse({ asOf: null, picker: null, exits: null });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown top-level key (.strict())", () => {
    const result = previewRuleOverridesResponse.safeParse({ ...representativeResponse, extra: true });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside the picker branch (.strict())", () => {
    const result = previewRuleOverridesResponse.safeParse({
      asOf: null,
      picker: { ...representativePickerBranch, extra: true },
      exits: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside an exits entry (.strict())", () => {
    const bad = {
      asOf: null,
      picker: null,
      exits: [{ ...oracleExitEntry, extra: true }],
    };
    expect(previewRuleOverridesResponse.safeParse(bad).success).toBe(false);
  });

  it("rejects a picker candidate missing oldScore", () => {
    const { oldScore: _oldScore, ...candidateWithoutOldScore } = oracleCandidateWithOldScore;
    const bad = {
      asOf: pickerSnapshotFixture.asOf,
      picker: { ...representativePickerBranch, candidates: [candidateWithoutOldScore] },
      exits: null,
    };
    expect(previewRuleOverridesResponse.safeParse(bad).success).toBe(false);
  });
});
