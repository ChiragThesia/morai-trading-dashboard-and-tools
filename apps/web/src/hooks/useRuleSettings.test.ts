/**
 * useRuleSettings.test.ts — TDD suite for the Phase 29-14 settings data hook.
 *
 * Behaviors under test:
 *   1. Fetch → GET /api/settings/rules, parses + exposes defaults/overrides/effective.
 *   2. saveGroup success → PUT { [group]: overrides }, non-optimistic (no local flip before
 *      the PUT resolves) + invalidates the settings query so the next read is server-confirmed.
 *   3. resetGroup → PUT { [group]: null } (reset-per-group sentinel).
 *   4. Failure → surfaces an error keyed by group; state doesn't flip.
 *
 * Mirrors useRuleTags.test.ts's apiFetch-mock harness exactly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { GetRuleSettingsResponse, SetRuleOverridesResponse } from "@morai/contracts";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
  rpc: {},
}));

import { useRuleSettings } from "./useRuleSettings.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PICKER_DEFAULTS = {
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
};

const EXITS_DEFAULTS = {
  take: { plus15Arm: 15, plus15Disarm: 10, plus10Arm: 10, plus10Disarm: 5, plus5Arm: 5, plus5Disarm: 2 },
  stop: { minus50Arm: -50, minus50Disarm: -40, minus25Arm: -25, minus25Disarm: -15 },
};

const REGIME_DEFAULTS = {
  vixTermStructureWarn: 0.9,
  vixTermStructureCrisis: 0.95,
  vvixWarn: 100,
  vvixCrisis: 115,
  vix9dRatioWarn: 1.0,
  vix9dRatioCrisis: 1.1,
  hyOasWarn: 3.0,
  hyOasCrisis: 5.0,
};

const SETTINGS_RESPONSE: GetRuleSettingsResponse = {
  defaults: { picker: PICKER_DEFAULTS, exits: EXITS_DEFAULTS, regime: REGIME_DEFAULTS },
  overrides: { picker: { maxOpenCalendars: 8 } },
  effective: {
    picker: { ...PICKER_DEFAULTS, maxOpenCalendars: 8 },
    exits: EXITS_DEFAULTS,
    regime: REGIME_DEFAULTS,
  },
};

function makeOkResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function makeErrorResponse(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

function makeSetResponse(maxOpenCalendars: number): SetRuleOverridesResponse {
  return {
    overrides: { picker: { maxOpenCalendars } },
    effective: { picker: { ...PICKER_DEFAULTS, maxOpenCalendars }, exits: EXITS_DEFAULTS, regime: REGIME_DEFAULTS },
  };
}

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRuleSettings", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("fetches and parses defaults/overrides/effective", async () => {
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(SETTINGS_RESPONSE));

    const { result } = renderHook(() => useRuleSettings(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.defaults).toEqual(SETTINGS_RESPONSE.defaults);
    expect(result.current.overrides).toEqual(SETTINGS_RESPONSE.overrides);
    expect(result.current.effective).toEqual(SETTINGS_RESPONSE.effective);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/settings/rules");
  });

  it("saveGroup is non-optimistic — effective reflects the new value only after the PUT resolves + refetch", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(SETTINGS_RESPONSE)) // initial GET
      .mockResolvedValueOnce(makeOkResponse(makeSetResponse(9))) // PUT
      .mockResolvedValueOnce(
        makeOkResponse({
          ...SETTINGS_RESPONSE,
          overrides: { picker: { maxOpenCalendars: 9 } },
          effective: { ...SETTINGS_RESPONSE.effective, picker: { ...PICKER_DEFAULTS, maxOpenCalendars: 9 } },
        }),
      ); // refetch GET

    const { result } = renderHook(() => useRuleSettings(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.effective?.picker.maxOpenCalendars).toBe(8);

    await act(async () => {
      await result.current.saveGroup("picker", { maxOpenCalendars: 9 });
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/settings/rules",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ picker: { maxOpenCalendars: 9 } }) }),
    );
    await waitFor(() => expect(result.current.effective?.picker.maxOpenCalendars).toBe(9));
    expect(result.current.errors["picker"]).toBeUndefined();
  });

  it("resetGroup PUTs { [group]: null }", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(SETTINGS_RESPONSE)) // initial GET
      .mockResolvedValueOnce(makeOkResponse({ overrides: {}, effective: SETTINGS_RESPONSE.defaults })) // PUT reset
      .mockResolvedValueOnce(
        makeOkResponse({ ...SETTINGS_RESPONSE, overrides: {}, effective: SETTINGS_RESPONSE.defaults }),
      ); // refetch GET

    const { result } = renderHook(() => useRuleSettings(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    await act(async () => {
      await result.current.resetGroup("picker");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/settings/rules",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ picker: null }) }),
    );
    await waitFor(() => expect(result.current.effective?.picker.maxOpenCalendars).toBe(6));
  });

  it("save failure surfaces an error keyed by group; effective does not flip", async () => {
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(SETTINGS_RESPONSE)) // initial GET
      .mockResolvedValueOnce(makeErrorResponse(400)); // PUT fails

    const { result } = renderHook(() => useRuleSettings(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    await act(async () => {
      await result.current.saveGroup("picker", { maxOpenCalendars: 9 });
    });

    expect(result.current.errors["picker"]).toBe("Couldn't save picker settings.");
    expect(result.current.effective?.picker.maxOpenCalendars).toBe(8);
  });
});
