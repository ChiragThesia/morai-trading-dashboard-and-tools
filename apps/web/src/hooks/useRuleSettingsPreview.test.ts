/**
 * useRuleSettingsPreview.test.ts — TDD suite for the Phase 32-06 staged-preview mutation hook
 * + the client-side regime re-band helper (B1/B2/B3/B5/B7).
 *
 * Behaviors under test:
 *   1. useRuleSettingsPreview() POSTs the staged body to /api/settings/rules/preview and
 *      parses the response (mirrors useAnalyzeCalendar's apiFetch-mock harness).
 *   2. Non-ok HTTP status -> throws (genuine failure, mirrors useAnalyzeCalendar).
 *   3. previewRegimeBands parity: for each of the 4 regime indicators, the helper's `after`
 *      band equals calling the matching @morai/core band<X> function directly with the same
 *      staged thresholds -- no divergence (T-32-12).
 *   4. previewRegimeBands re-bands to the stored (unchanged) band when staged === defaults.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { PreviewRuleOverridesRequest, PreviewRuleOverridesResponse, RegimeIndicator } from "@morai/contracts";
import { bandVixTermStructure, bandVvix, bandVix9dRatio, bandHyOas } from "@morai/core";
import type { RegimeRuleOverrides } from "@morai/core";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useRuleSettingsPreview, previewRegimeBands } from "./useRuleSettingsPreview.ts";

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

const REQUEST_BODY: PreviewRuleOverridesRequest = { picker: { maxOpenCalendars: 8 } };

const RESPONSE_BODY: PreviewRuleOverridesResponse = {
  asOf: "2026-07-09",
  picker: {
    candidates: [],
    gate: null,
    sizing: null,
    universeNote: null,
  },
  exits: [],
};

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRuleSettingsPreview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("POSTs the staged body and resolves the parsed preview response", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(RESPONSE_BODY));

    const { result } = renderHook(() => useRuleSettingsPreview(), { wrapper });

    let resolved: PreviewRuleOverridesResponse | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync(REQUEST_BODY);
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/settings/rules/preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify(REQUEST_BODY) }),
    );
    expect(resolved).toEqual(RESPONSE_BODY);
  });

  it("throws on a genuine HTTP failure", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(500));

    const { result } = renderHook(() => useRuleSettingsPreview(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(REQUEST_BODY)).rejects.toThrow(
        "POST /api/settings/rules/preview failed: 500",
      );
    });
  });
});

describe("previewRegimeBands", () => {
  const INDICATORS: ReadonlyArray<RegimeIndicator> = [
    {
      id: "vix-term-structure",
      label: "VIX/VIX3M Term Structure",
      value: 0.92,
      band: "warning",
      bandWarn: 0.9,
      bandCrisis: 0.95,
      asOf: "2026-07-09",
      source: "test",
      rationale: "test",
    },
    {
      id: "vvix",
      label: "VVIX",
      value: 108,
      band: "warning",
      bandWarn: 100,
      bandCrisis: 115,
      asOf: "2026-07-09",
      source: "test",
      rationale: "test",
    },
    {
      id: "vix9d-vix",
      label: "VIX9D/VIX",
      value: 1.05,
      band: "warning",
      bandWarn: 1.0,
      bandCrisis: 1.1,
      asOf: "2026-07-09",
      source: "test",
      rationale: "test",
    },
    {
      id: "hy-oas",
      label: "HY OAS (Credit Spread)",
      value: 3.4,
      band: "warning",
      bandWarn: 3.0,
      bandCrisis: 5.0,
      asOf: "2026-07-09",
      source: "test",
      rationale: "test",
    },
  ];

  // Fully-populated (non-optional) fixture -- avoids `!` non-null assertions when reading
  // fields below (typescript.md forbids `!`); STAGED narrows to RegimeRuleOverrides at the
  // previewRegimeBands call site since every optional field is structurally compatible.
  const STAGED: Required<RegimeRuleOverrides> = {
    vixTermStructureWarn: 0.85,
    vixTermStructureCrisis: 0.93,
    vvixWarn: 90,
    vvixCrisis: 105,
    vix9dRatioWarn: 0.95,
    vix9dRatioCrisis: 1.02,
    hyOasWarn: 3.2,
    hyOasCrisis: 4.5,
  };

  it("re-bands each of the 4 indicators to exactly what the matching @morai/core band<X> function returns for the staged thresholds", () => {
    const result = previewRegimeBands(STAGED, INDICATORS);

    const byId = new Map(result.map((r) => [r.id, r]));

    expect(byId.get("vix-term-structure")?.after).toBe(
      bandVixTermStructure(0.92, { warn: STAGED.vixTermStructureWarn, crisis: STAGED.vixTermStructureCrisis }),
    );
    expect(byId.get("vvix")?.after).toBe(
      bandVvix(108, { warn: STAGED.vvixWarn, crisis: STAGED.vvixCrisis }),
    );
    expect(byId.get("vix9d-vix")?.after).toBe(
      bandVix9dRatio(1.05, { warn: STAGED.vix9dRatioWarn, crisis: STAGED.vix9dRatioCrisis }),
    );
    expect(byId.get("hy-oas")?.after).toBe(
      bandHyOas(3.4, { warn: STAGED.hyOasWarn, crisis: STAGED.hyOasCrisis }),
    );
  });

  it("carries the indicator's stored band through as `before`", () => {
    const result = previewRegimeBands(STAGED, INDICATORS);
    for (const indicator of INDICATORS) {
      const preview = result.find((r) => r.id === indicator.id);
      expect(preview?.before).toBe(indicator.band);
    }
  });

  it("re-bands to the stored (unchanged) band when staged === defaults", () => {
    const DEFAULTS: RegimeRuleOverrides = {
      vixTermStructureWarn: 0.9,
      vixTermStructureCrisis: 0.95,
      vvixWarn: 100,
      vvixCrisis: 115,
      vix9dRatioWarn: 1.0,
      vix9dRatioCrisis: 1.1,
      hyOasWarn: 3.0,
      hyOasCrisis: 5.0,
    };
    const result = previewRegimeBands(DEFAULTS, INDICATORS);
    for (const indicator of INDICATORS) {
      const preview = result.find((r) => r.id === indicator.id);
      expect(preview?.after).toBe(indicator.band);
    }
  });
});
