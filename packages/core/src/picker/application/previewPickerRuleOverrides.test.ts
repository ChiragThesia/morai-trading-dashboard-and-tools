/**
 * previewPickerRuleOverrides tests (Phase 32, Plan 02, B1) — per tdd.md's numerical-code rule
 * (fast-check property test) plus example tests for each knob-group branch and port hygiene.
 *
 * Covers:
 *   - byte-parity property (T-32-01 precedent): an ABSENT staged group re-derives the SAME
 *     effective config the stored candidates were scored with, so every candidate's newScore
 *     equals its stored score, and gate/sizing after === before.
 *   - universe branch: staging a delta/DTE knob sets universeNote, never a fabricated diff.
 *   - gate branch: staging maxOpenCalendars flips gate.after.brakes.maxOpen from a fresh
 *     open-count read; cooldown is reused verbatim from the stored gate.
 *   - cold start (no stored snapshot) -> {available:false}, never a throw.
 *   - StorageError propagation from the two critical reads (snapshot, open-calendars).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makePreviewPickerRuleOverridesUseCase } from "./previewPickerRuleOverrides.ts";
import type { PickerPreviewDeps } from "./ports.ts";
import type {
  ForReadingPickerSnapshot,
  PickerCandidateDomain,
  PickerGate,
  PickerSizing,
  PickerSnapshot,
  PickerSnapshotRow,
  StorageError,
} from "./ports.ts";
import { debitFitFraction } from "../domain/rules.ts";
import { resolveSizingTier } from "../domain/sizing.ts";
import type { ForGettingOpenCalendars } from "../../journal/index.ts";
import type { Calendar } from "../../journal/index.ts";
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";
import type { StoredRuleOverrides } from "../../settings/domain/merge.ts";

/** JsonObject's index signature is satisfied by `{}` directly -- no cast needed. */
const EMPTY_OVERRIDES: StoredRuleOverrides = {};

const SNAPSHOT_ASOF = "2026-07-01";

/** vix=10/vix3m=20 sits deep inside the "low" tier and well under every penalty/block rung
 *  floor -- the gate/sizing byte-parity fixture never flaps regardless of ladder edits. */
const OPEN_GATE: PickerGate = {
  vix: 10,
  vix3m: 20,
  ratio: 0.5,
  asOf: SNAPSHOT_ASOF,
  state: "open",
  penaltyMultiplier: 1,
  brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
  reasons: [],
};

/** CR-01 fixture: a stored gate that is BLIND due to stale (not missing) macro data -- the
 *  byte-parity property must hold for this fixture too (gate.after === gate.before), never
 *  silently re-resolving to a live state via the asOf-as-nowIso surrogate. */
const STALE_BLIND_GATE: PickerGate = {
  vix: 30,
  vix3m: 20,
  ratio: 1.5,
  asOf: SNAPSHOT_ASOF,
  state: "blind",
  penaltyMultiplier: 0,
  brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
  reasons: ["macroStale"],
};

/** The sizing a stored gate would ACTUALLY have been persisted with (mirrors
 *  computePickerSnapshot.ts's `toPickerSizing(gate.vix, ...)`, default sizingContracts) --
 *  keeps a gate fixture's `sizing` internally consistent with its own `vix` (the fast-check
 *  gateArb byte-parity property needs this, or `sizing.after` legitimately diverges from a
 *  fixture's arbitrarily-mismatched `sizing.before`). */
function sizingForGate(gate: PickerGate): PickerSizing {
  const resolved = resolveSizingTier(gate.vix);
  return { tier: resolved?.tier ?? null, contracts: resolved?.contracts ?? null, vix: gate.vix };
}

const BREAKDOWN_CRITERIA = [
  "slope",
  "fwdEdge",
  "gexFit",
  "eventAdjustment",
  "beVsEm",
  "deltaNeutral",
  "thetaVega",
  "vrp",
  "debitFit",
] as const;

/** A minimal but structurally complete PickerSnapshot, overridable per test. */
function snapshotRow(overrides: Partial<PickerSnapshot> = {}): PickerSnapshotRow {
  const snapshot: PickerSnapshot = {
    asOf: SNAPSHOT_ASOF,
    observedAt: "2026-07-01T14:30:00.000Z",
    spot: 7500,
    source: "schwab",
    gexContextStatus: "ok",
    eventsContextStatus: "ok",
    marketSession: "rth",
    termStructure: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null, nearTerm: null },
    events: [],
    candidates: [],
    ruleSet: [],
    gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
    gate: OPEN_GATE,
    sizing: { tier: "low", contracts: 2, vix: 10 },
    ...overrides,
  };
  return { observedAt: new Date(snapshot.observedAt), snapshot };
}

/** Fresh, fully-wired fake deps -- each field overridable per test. */
function makeDeps(overrides: Partial<PickerPreviewDeps> = {}): PickerPreviewDeps {
  const readPickerSnapshot: ForReadingPickerSnapshot = async () => ok(snapshotRow());
  const readRuleOverrides: ForReadingRuleOverrides = async () => ok(EMPTY_OVERRIDES);
  const readOpenCalendars: ForGettingOpenCalendars = async (): Promise<
    Result<ReadonlyArray<Calendar>, StorageError>
  > => ok([]);
  return { readPickerSnapshot, readRuleOverrides, readOpenCalendars, ...overrides };
}

/** Builds one PickerCandidateDomain whose breakdown is INTERNALLY CONSISTENT with `weights` +
 *  `debitBand` -- debitFit's contribution is the real `debitFitFraction` output (never an
 *  arbitrary literal), and `.score` is the SAME `Σ weight*contribution/100` reduction the
 *  production rescore uses -- so this is a genuine byte-parity fixture, not a hand-picked one. */
function makeCandidate(
  id: string,
  debit: number,
  weights: Record<(typeof BREAKDOWN_CRITERIA)[number], number>,
  contributions: Record<(typeof BREAKDOWN_CRITERIA)[number], number>,
): PickerCandidateDomain {
  const debitBand = { idealMin: 3200, idealMax: 5000 };
  const breakdown = BREAKDOWN_CRITERIA.map((criterion) => ({
    criterion,
    weight: weights[criterion],
    rawValue: 0,
    contribution: criterion === "debitFit" ? debitFitFraction(debit, debitBand) * 100 : contributions[criterion],
  }));
  const rawScore = breakdown.reduce((sum, entry) => sum + (weights[entry.criterion] * entry.contribution) / 100, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  return {
    bucket: "standard",
    id,
    name: id,
    score,
    breakdown,
    debit,
    theta: 1,
    vega: 1,
    delta: 0,
    fwdIv: 0.15,
    fwdIvGuard: "ok",
    slope: 0.1,
    fwdEdge: 0.01,
    expectedMove: 100,
    frontEvents: [],
    backEvents: [],
    context: [],
    frontLeg: { strike: 7500, putCall: "P", dte: 30, iv: 0.14 },
    backLeg: { strike: 7500, putCall: "P", dte: 56, iv: 0.155 },
    exitPlan: { profitTargetPct: 0.5, stopPct: -0.5, manageShortDte: 21, closeByExpiry: "2026-07-31", thetaCapturePct: 1 },
  };
}

describe("makePreviewPickerRuleOverridesUseCase", () => {
  it("byte-parity: an ABSENT staged group reproduces every stored candidate's score EXACTLY, gate/sizing after === before (fast-check)", async () => {
    const weightArb = fc.record({
      slope: fc.double({ min: 0, max: 40, noNaN: true }),
      fwdEdge: fc.double({ min: 0, max: 40, noNaN: true }),
      gexFit: fc.double({ min: 0, max: 40, noNaN: true }),
      eventAdjustment: fc.double({ min: 0, max: 40, noNaN: true }),
      beVsEm: fc.double({ min: 0, max: 40, noNaN: true }),
      deltaNeutral: fc.double({ min: 0, max: 40, noNaN: true }),
      thetaVega: fc.double({ min: 0, max: 40, noNaN: true }),
      vrp: fc.double({ min: 0, max: 40, noNaN: true }),
      debitFit: fc.double({ min: 0, max: 40, noNaN: true }),
    });
    const contributionArb = fc.record({
      slope: fc.double({ min: 0, max: 100, noNaN: true }),
      fwdEdge: fc.double({ min: 0, max: 100, noNaN: true }),
      gexFit: fc.double({ min: 0, max: 100, noNaN: true }),
      eventAdjustment: fc.double({ min: 0, max: 100, noNaN: true }),
      beVsEm: fc.double({ min: 0, max: 100, noNaN: true }),
      deltaNeutral: fc.double({ min: 0, max: 100, noNaN: true }),
      thetaVega: fc.double({ min: 0, max: 100, noNaN: true }),
      vrp: fc.double({ min: 0, max: 100, noNaN: true }),
      debitFit: fc.double({ min: 0, max: 100, noNaN: true }), // overwritten by debitFitFraction in makeCandidate
    });
    const debitArb = fc.double({ min: 0, max: 10000, noNaN: true });
    // CR-01: exercise both a live-open stored gate and a stale-blind one -- the byte-parity
    // guarantee must hold identically for the blind fixture (never silently un-blinded).
    const gateArb = fc.constantFrom(OPEN_GATE, STALE_BLIND_GATE);

    await fc.assert(
      fc.asyncProperty(weightArb, contributionArb, debitArb, gateArb, async (weights, contributions, debit, gate) => {
        const candidate = makeCandidate("cand-1", debit, weights, contributions);
        // Stored overrides carry the SAME weights + debit band the candidate was scored with --
        // reproducing the effective config an ABSENT staged group falls back to (T-32-01).
        const storedOverrides: StoredRuleOverrides = {
          picker: { weights, debitIdealMin: 3200, debitIdealMax: 5000 },
        };
        const deps = makeDeps({
          readPickerSnapshot: async () => ok(snapshotRow({ candidates: [candidate], gate, sizing: sizingForGate(gate) })),
          readRuleOverrides: async () => ok(storedOverrides),
        });
        const preview = makePreviewPickerRuleOverridesUseCase(deps);
        const result = await preview();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.available).toBe(true);
        if (!result.value.available) return;

        expect(result.value.candidates).toHaveLength(1);
        const [previewed] = result.value.candidates;
        expect(previewed).toBeDefined();
        if (previewed === undefined) return;
        expect(previewed.oldScore).toBe(candidate.score);
        expect(previewed.score).toBe(candidate.score);
        expect(result.value.gate.after).toEqual(result.value.gate.before);
        expect(result.value.sizing.after).toEqual(result.value.sizing.before);
      }),
    );
  });

  it("CR-01: a stored blind gate (macroStale) stays blind in preview even with a staged vixLadder override -- the preview cannot know fresher-than-stored freshness, so it must not silently un-blind a stale gate", async () => {
    // vix=30 would resolve to a live "blocked" state if resolveEntryGate were re-run with
    // nowIso reset to "0 days old" (the CR-01 bug) -- proves the fix isn't accidentally
    // correct just because the reconstructed state happens to match.
    const staleBlindGate: PickerGate = {
      vix: 30,
      vix3m: 20,
      ratio: 1.5,
      asOf: SNAPSHOT_ASOF,
      state: "blind",
      penaltyMultiplier: 0,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: ["macroStale"],
    };
    const deps = makeDeps({
      readPickerSnapshot: async () => ok(snapshotRow({ gate: staleBlindGate })),
    });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)({ vixLadder: { crisisMin: 100 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    expect(result.value.gate.after.state).toBe("blind");
    expect(result.value.gate.after).toEqual(staleBlindGate);
  });

  it("cold start: no stored snapshot yet -> ok({available:false}), never a throw", async () => {
    const deps = makeDeps({ readPickerSnapshot: async () => ok(null) });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)();
    expect(result).toEqual(ok({ available: false }));
  });

  it("staging a universe knob (deltaBandMax) sets universeNote, never a fabricated candidate diff (Pitfall 1)", async () => {
    const candidate = makeCandidate(
      "cand-1",
      4000,
      {
        slope: 10,
        fwdEdge: 10,
        gexFit: 10,
        eventAdjustment: 10,
        beVsEm: 10,
        deltaNeutral: 10,
        thetaVega: 10,
        vrp: 10,
        debitFit: 20,
      },
      { slope: 50, fwdEdge: 50, gexFit: 50, eventAdjustment: 50, beVsEm: 50, deltaNeutral: 50, thetaVega: 50, vrp: 50, debitFit: 50 },
    );
    const deps = makeDeps({ readPickerSnapshot: async () => ok(snapshotRow({ candidates: [candidate] })) });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)({ deltaBandMax: -0.2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    expect(result.value.universeNote).toMatch(/next compute cycle/i);
    // Honest note only -- the candidate LIST itself is untouched (same id, no in/out diff).
    expect(result.value.candidates.map((c) => c.id)).toEqual(["cand-1"]);
  });

  it("full-form staging: universe keys PRESENT but equal to their baseline effective values do NOT set universeNote (client sends the whole form)", async () => {
    // Regression (live UAT 2026-07-10): the modal POSTs the complete flattened form state,
    // so every universe key is present at its CURRENT value. Presence alone must not fire
    // the honest note — only a value that DIFFERS from the baseline effective config does.
    const candidate = makeCandidate(
      "cand-1",
      4000,
      {
        slope: 10,
        fwdEdge: 10,
        gexFit: 10,
        eventAdjustment: 10,
        beVsEm: 10,
        deltaNeutral: 10,
        thetaVega: 10,
        vrp: 10,
        debitFit: 20,
      },
      // Asymmetric contributions: shifting weight from slope (90) to vrp (10) MUST move the score.
      { slope: 90, fwdEdge: 50, gexFit: 50, eventAdjustment: 50, beVsEm: 50, deltaNeutral: 50, thetaVega: 50, vrp: 10, debitFit: 50 },
    );
    const deps = makeDeps({ readPickerSnapshot: async () => ok(snapshotRow({ candidates: [candidate] })) });
    // Universe keys at their code-default (== baseline) values + a real weight change.
    const result = await makePreviewPickerRuleOverridesUseCase(deps)({
      deltaBandMin: -0.49,
      deltaBandMax: -0.3,
      frontDteMin: 21,
      frontDteMax: 36,
      backDteMinGap: 15,
      backDteMaxGap: 90,
      weights: { slope: 5, fwdEdge: 10, gexFit: 10, eventAdjustment: 10, beVsEm: 10, deltaNeutral: 10, thetaVega: 10, vrp: 15, debitFit: 20 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    expect(result.value.universeNote).toBeNull();
    // The weight change must surface as a real mover (score !== oldScore).
    const cand = result.value.candidates[0];
    expect(cand).toBeDefined();
    if (cand === undefined) return;
    expect(cand.score).not.toBe(cand.oldScore);
  });

  it("event-bucket candidate: empty staging reproduces the stored event score EXACTLY (event weights + backEventBonus, never standard weights)", async () => {
    // Regression (live UAT 2026-07-10): event-bucket candidates are scored with the
    // event registry (standard weights ×0.9 + backEventBonus 10). Re-scoring them with
    // STANDARD weights silently dropped ~10 points per candidate in preview deltas.
    const standard = makeCandidate(
      "evt-1",
      4000,
      { slope: 10, fwdEdge: 25, gexFit: 10, eventAdjustment: 5, beVsEm: 15, deltaNeutral: 15, thetaVega: 10, vrp: 5, debitFit: 5 },
      { slope: 80, fwdEdge: 40, gexFit: 50, eventAdjustment: 0, beVsEm: 50, deltaNeutral: 90, thetaVega: 60, vrp: 0, debitFit: 50 },
    );
    // Real stored shape (verified against all 8 live event candidates 2026-07-10):
    // breakdown carries STANDARD weights; stored score = Σ(w×c)/100 + 10×bonus — the
    // engine normalizes by weight sum, so the event registry's ×0.9 cancels.
    const eventScoreRaw =
      standard.breakdown.reduce((sum, e) => sum + (e.weight * e.contribution) / 100, 0) + 10;
    const eventCandidate: typeof standard = {
      ...standard,
      bucket: "event-calendar",
      score: Math.min(100, Math.max(0, Math.round(eventScoreRaw))),
      context: [{ id: "backEventBonus", label: "Event in back window", value: 1, note: "calibrating" }],
    };
    const deps = makeDeps({ readPickerSnapshot: async () => ok(snapshotRow({ candidates: [eventCandidate] })) });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    const cand = result.value.candidates[0];
    expect(cand).toBeDefined();
    if (cand === undefined) return;
    expect(cand.score).toBe(cand.oldScore);
  });

  it("no staged universe knob -> universeNote is null", async () => {
    const deps = makeDeps();
    const result = await makePreviewPickerRuleOverridesUseCase(deps)({ maxOpenCalendars: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    expect(result.value.universeNote).toBeNull();
  });

  it("staging maxOpenCalendars flips gate.after.brakes.maxOpen from the fresh open-count read; cooldown reused verbatim from stored", async () => {
    const OPEN_CALENDAR: Calendar = {
      id: "cal-1",
      underlying: "SPX",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-07-31",
      backExpiry: "2026-08-26",
      qty: 1,
      openNetDebit: 4000,
      status: "open",
      openedAt: new Date("2026-06-01T00:00:00Z"),
      closedAt: null,
      notes: null,
    };
    const storedGate: PickerGate = {
      ...OPEN_GATE,
      brakes: { maxOpen: false, cooldown: true, cooldownUntil: "2026-07-05" },
    };
    const deps = makeDeps({
      readPickerSnapshot: async () => ok(snapshotRow({ gate: storedGate })),
      readOpenCalendars: async () => ok([OPEN_CALENDAR]),
    });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)({ maxOpenCalendars: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available).toBe(true);
    if (!result.value.available) return;
    // 1 open calendar >= staged maxOpenCalendars(1) -- the brake trips even though the stored
    // gate's own maxOpen was false (a live re-read, not a stale replay).
    expect(result.value.gate.after.brakes.maxOpen).toBe(true);
    expect(result.value.gate.before.brakes.maxOpen).toBe(false);
    // Cooldown is not an editable knob -- reused verbatim from the stored gate.
    expect(result.value.gate.after.brakes.cooldown).toBe(true);
    expect(result.value.gate.after.brakes.cooldownUntil).toBe("2026-07-05");
  });

  it("propagates a StorageError from readPickerSnapshot unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readPickerSnapshot: async () => err(storageError) });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("propagates a StorageError from readOpenCalendars unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readOpenCalendars: async () => err(storageError) });
    const result = await makePreviewPickerRuleOverridesUseCase(deps)();
    expect(result).toEqual(err(storageError));
  });

  it("port hygiene: deps structurally exclude any persist/chain/gex/events port -- only these 3 fields exist", async () => {
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual(["readOpenCalendars", "readPickerSnapshot", "readRuleOverrides"].sort());
  });
});
