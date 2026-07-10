import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type {
  ForRunningGetRuleSettings,
  ForRunningSetRuleOverrides,
  ForRunningPreviewRuleOverrides,
  PickerPreviewResult,
  StorageError,
} from "@morai/core";
import { getRuleSettingsResponse, setRuleOverridesResponse, previewRuleOverridesResponse } from "@morai/contracts";
import { settingsRoutes } from "./settings.routes.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// A full ruleConfig-shaped defaults object (packages/contracts/src/rule-settings.ts).
// Deliberately NOT typed `RuleConfig` (core's JsonObject alias) — kept as its own concrete
// literal type so `.picker`/`.exits`/`.regime` stay individually addressable in this file.

const DEFAULTS = {
  picker: {
    deltaBandMin: -0.49,
    deltaBandMax: -0.3,
    frontDteMin: 21,
    frontDteMax: 36,
    backDteMinGap: 15,
    backDteMaxGap: 90,
    weights: {
      slope: 10,
      fwdEdge: 25,
      gexFit: 10,
      eventAdjustment: 5,
      beVsEm: 15,
      deltaNeutral: 15,
      thetaVega: 10,
      vrp: 5,
      debitFit: 5,
    },
    debitIdealMin: 3200,
    debitIdealMax: 5000,
    vixLadder: { normalMin: 15, elevatedMin: 20, crisisMin: 25 },
    maxOpenCalendars: 6,
    sizingContracts: { low: 2, normal: 2, elevated: 1, crisis: 0 },
  },
  exits: {
    take: {
      plus15Arm: 0.15,
      plus15Disarm: 0.13,
      plus10Arm: 0.1,
      plus10Disarm: 0.08,
      plus5Arm: 0.05,
      plus5Disarm: 0.03,
    },
    stop: {
      minus50Arm: -0.5,
      minus50Disarm: -0.48,
      minus25Arm: -0.25,
      minus25Disarm: -0.23,
    },
  },
  regime: {
    vixTermStructureWarn: 0.9,
    vixTermStructureCrisis: 0.95,
    vvixWarn: 100,
    vvixCrisis: 115,
    vix9dRatioWarn: 1.0,
    vix9dRatioCrisis: 1.1,
    hyOasWarn: 3.0,
    hyOasCrisis: 5.0,
  },
};

// ─── Test app builder ──────────────────────────────────────────────────────────

function buildTestApp(
  getRuleSettings: ForRunningGetRuleSettings,
  setRuleOverrides: ForRunningSetRuleOverrides,
  previewRuleOverrides: ForRunningPreviewRuleOverrides = noopPreviewRuleOverrides,
) {
  const app = new Hono();
  app.route("/api", settingsRoutes(getRuleSettings, setRuleOverrides, previewRuleOverrides));
  return app;
}

const noopSetRuleOverrides: ForRunningSetRuleOverrides = async () =>
  ok({ overrides: {}, effective: DEFAULTS });

const noopPreviewRuleOverrides: ForRunningPreviewRuleOverrides = async () =>
  ok({ asOf: null, picker: null, exits: null });

describe("GET /api/settings/rules", () => {
  it("returns 200 with { defaults, overrides, effective }", async () => {
    const getRuleSettings: ForRunningGetRuleSettings = async () =>
      ok({ defaults: DEFAULTS, overrides: {}, effective: DEFAULTS });
    const app = buildTestApp(getRuleSettings, noopSetRuleOverrides);

    const res = await app.request("/api/settings/rules");
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = getRuleSettingsResponse.parse(body);
    expect(parsed.defaults.picker.deltaBandMin).toBe(-0.49);
    expect(parsed.overrides).toEqual({});
    expect(parsed.effective).toEqual(parsed.defaults);
  });

  it("reflects a stored override in the effective config", async () => {
    const overridden = { picker: { deltaBandMin: -0.4 } };
    const effective = { ...DEFAULTS, picker: { ...DEFAULTS.picker, deltaBandMin: -0.4 } };
    const getRuleSettings: ForRunningGetRuleSettings = async () =>
      ok({ defaults: DEFAULTS, overrides: overridden, effective });
    const app = buildTestApp(getRuleSettings, noopSetRuleOverrides);

    const res = await app.request("/api/settings/rules");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = getRuleSettingsResponse.parse(body);
    expect(parsed.effective.picker.deltaBandMin).toBe(-0.4);
    expect(parsed.defaults.picker.deltaBandMin).toBe(-0.49);
  });

  it("returns 500 when the use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getRuleSettings: ForRunningGetRuleSettings = async () => err(storageError);
    const app = buildTestApp(getRuleSettings, noopSetRuleOverrides);

    const res = await app.request("/api/settings/rules");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("DB down");
  });
});

describe("PUT /api/settings/rules", () => {
  const okGetRuleSettings: ForRunningGetRuleSettings = async () =>
    ok({ defaults: DEFAULTS, overrides: {}, effective: DEFAULTS });

  it("returns 200 with { overrides, effective } on a valid partial body", async () => {
    let captured: unknown = null;
    const overridden = { picker: { deltaBandMin: -0.4 } };
    const effective = { ...DEFAULTS, picker: { ...DEFAULTS.picker, deltaBandMin: -0.4 } };
    const setRuleOverrides: ForRunningSetRuleOverrides = async (patch) => {
      captured = patch;
      return ok({ overrides: overridden, effective });
    };
    const app = buildTestApp(okGetRuleSettings, setRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: { deltaBandMin: -0.4 } }),
    });

    expect(res.status).toBe(200);
    expect(captured).toEqual({ picker: { deltaBandMin: -0.4 } });
    const body: unknown = await res.json();
    const parsed = setRuleOverridesResponse.parse(body);
    expect(parsed.effective.picker.deltaBandMin).toBe(-0.4);
  });

  it("resets a group to defaults when the request patch sets it to null", async () => {
    let captured: unknown = null;
    const setRuleOverrides: ForRunningSetRuleOverrides = async (patch) => {
      captured = patch;
      return ok({ overrides: {}, effective: DEFAULTS });
    };
    const app = buildTestApp(okGetRuleSettings, setRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: null }),
    });

    expect(res.status).toBe(200);
    expect(captured).toEqual({ picker: null });
    const body: unknown = await res.json();
    const parsed = setRuleOverridesResponse.parse(body);
    expect(parsed.effective.picker).toEqual(DEFAULTS.picker);
  });

  it("returns 400 when the body has an unknown top-level key (contract .strict())", async () => {
    let called = false;
    const setRuleOverrides: ForRunningSetRuleOverrides = async () => {
      called = true;
      return ok({ overrides: {}, effective: DEFAULTS });
    };
    const app = buildTestApp(okGetRuleSettings, setRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 when picker.weights does not sum to exactly 100", async () => {
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        picker: {
          weights: {
            slope: 10,
            fwdEdge: 25,
            gexFit: 10,
            eventAdjustment: 5,
            beVsEm: 15,
            deltaNeutral: 15,
            thetaVega: 10,
            vrp: 5,
            debitFit: 10, // sums to 105, not 100
          },
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 on a single-sided TAKE hysteresis edit", async () => {
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exits: { take: { plus15Arm: 0.15 } } }), // no plus15Disarm
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 when the use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const setRuleOverrides: ForRunningSetRuleOverrides = async () => err(storageError);
    const app = buildTestApp(okGetRuleSettings, setRuleOverrides);

    const res = await app.request("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: { deltaBandMin: -0.4 } }),
    });

    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("DB down");
  });
});

describe("POST /api/settings/rules/preview", () => {
  const okGetRuleSettings: ForRunningGetRuleSettings = async () =>
    ok({ defaults: DEFAULTS, overrides: {}, effective: DEFAULTS });

  const AVAILABLE_PICKER: PickerPreviewResult = {
    available: true,
    asOf: "2026-07-01",
    candidates: [],
    gate: {
      before: {
        vix: 10,
        vix3m: 20,
        ratio: 0.5,
        asOf: "2026-07-01",
        state: "open",
        penaltyMultiplier: 1,
        brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
        reasons: [],
      },
      after: {
        vix: 10,
        vix3m: 20,
        ratio: 0.5,
        asOf: "2026-07-01",
        state: "open",
        penaltyMultiplier: 1,
        brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
        reasons: [],
      },
    },
    sizing: {
      before: { tier: "low", contracts: 2, vix: 10 },
      after: { tier: "low", contracts: 2, vix: 10 },
    },
    universeNote: null,
  };

  it("200 + snapshot asOf for a valid picker-weights body", async () => {
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async () =>
      ok({ asOf: "2026-07-01", picker: AVAILABLE_PICKER, exits: null });
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const res = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: { weights: DEFAULTS.picker.weights } }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = previewRuleOverridesResponse.parse(body);
    expect(parsed.asOf).toBe("2026-07-01");
    expect(parsed.picker).not.toBeNull();
  });

  it("a staged universe knob returns the honest note, never a fabricated candidate diff", async () => {
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async () =>
      ok({
        asOf: "2026-07-01",
        picker: { ...AVAILABLE_PICKER, universeNote: "Affects the next compute cycle — no live candidate re-selection without a chain re-read." },
        exits: null,
      });
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const res = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: { deltaBandMax: -0.2 } }),
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = previewRuleOverridesResponse.parse(body);
    expect(parsed.picker?.universeNote).toMatch(/next compute cycle/i);
  });

  it("an empty-but-present picker group byte-parity: newScore === oldScore, group reaches the use-case (not dropped as absent)", async () => {
    let captured: unknown = null;
    const candidate = {
      id: "cand-1",
      name: "cand-1",
      score: 72,
      breakdown: [],
      debit: 4000,
      theta: 1,
      vega: 1,
      delta: 0,
      fwdIv: 0.15,
      fwdIvGuard: "ok" as const,
      slope: 0.1,
      fwdEdge: 0.01,
      expectedMove: 100,
      frontEvents: [],
      backEvents: [],
      context: [],
      bucket: "standard" as const,
      frontLeg: { strike: 7500, putCall: "P" as const, dte: 30, iv: 0.14 },
      backLeg: { strike: 7500, putCall: "P" as const, dte: 56, iv: 0.155 },
      exitPlan: { profitTargetPct: 0.5, stopPct: -0.5, manageShortDte: 21, closeByExpiry: "2026-07-31", thetaCapturePct: 1 },
      oldScore: 72,
    };
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async (input) => {
      captured = input;
      return ok({ asOf: "2026-07-01", picker: { ...AVAILABLE_PICKER, candidates: [candidate] }, exits: null });
    };
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const res = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: {} }),
    });

    expect(res.status).toBe(200);
    expect(captured).toEqual({ picker: {} });
    const body: unknown = await res.json();
    const parsed = previewRuleOverridesResponse.parse(body);
    const [previewed] = parsed.picker?.candidates ?? [];
    expect(previewed).toBeDefined();
    expect(previewed?.score).toBe(previewed?.oldScore);
  });

  it("returns 400 on an unknown top-level key (contract .strict())", async () => {
    let called = false;
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async () => {
      called = true;
      return ok({ asOf: null, picker: null, exits: null });
    };
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const res = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("never persists: two identical requests return identical output (no stored side effect)", async () => {
    let callCount = 0;
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async () => {
      callCount += 1;
      return ok({ asOf: "2026-07-01", picker: AVAILABLE_PICKER, exits: null });
    };
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const body = JSON.stringify({ picker: { deltaBandMax: -0.2 } });
    const res1 = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const res2 = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(await res1.json()).toEqual(await res2.json());
    expect(callCount).toBe(2);
  });

  it("returns 500 when the use-case returns a storage error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const previewRuleOverrides: ForRunningPreviewRuleOverrides = async () => err(storageError);
    const app = buildTestApp(okGetRuleSettings, noopSetRuleOverrides, previewRuleOverrides);

    const res = await app.request("/api/settings/rules/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picker: {} }),
    });

    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("DB down");
  });
});
