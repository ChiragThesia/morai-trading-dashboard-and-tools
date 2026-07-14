/**
 * RuleSettingsModal.test.tsx — TDD suite for the Phase 29-14 gear-icon settings modal,
 * extended in Phase 32-06 for the staged-change Preview flow (B1/B2/B3/B5/B7).
 *
 * Behaviors under test:
 *   - The gear trigger opens the modal (closed until clicked, mirrors Overview.test.tsx's
 *     "exit rules live behind the header dialog" pattern).
 *   - Three engine groups render: Entry/Picker, Exit Advisor, Regime Bands.
 *   - An overridden knob (picker.maxOpenCalendars) shows both its effective value AND its
 *     default value alongside.
 *   - Each group's reset button calls resetGroup(group).
 *   - Saving an edited knob calls saveGroup(group, patch).
 *   - Preview (32-06): staging a picker weight -> movers old->new; staging a universe knob
 *     -> the server's honest note (no fake movers); staging a regime threshold -> band
 *     before->after computed client-side; an unstaged group -> "No change."; Save unregressed.
 */
import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  GetRuleSettingsResponse,
  PreviewRuleOverridesResponse,
  RegimeIndicator,
  PickerCandidate,
} from "@morai/contracts";
import { RULE_EXPLAINERS } from "@morai/contracts";
import { assertDefined } from "@morai/shared";

const {
  mockUseRuleSettings,
  mockSaveGroup,
  mockResetGroup,
  mockUseRuleSettingsPreview,
  mockPreviewMutateAsync,
  mockUseRegimeBoard,
} = vi.hoisted(() => ({
  mockUseRuleSettings: vi.fn(),
  mockSaveGroup: vi.fn(() => Promise.resolve()),
  mockResetGroup: vi.fn(() => Promise.resolve()),
  mockUseRuleSettingsPreview: vi.fn(),
  mockPreviewMutateAsync: vi.fn(),
  mockUseRegimeBoard: vi.fn(),
}));
vi.mock("../hooks/useRuleSettings.ts", () => ({ useRuleSettings: mockUseRuleSettings }));
vi.mock("../hooks/useRegimeBoard.ts", () => ({ useRegimeBoard: mockUseRegimeBoard }));
// previewRegimeBands stays REAL (importOriginal) -- only the network-backed mutation hook is
// faked, so the regime test exercises the actual client-side re-band logic.
vi.mock("../hooks/useRuleSettingsPreview.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useRuleSettingsPreview.ts")>();
  return { ...actual, useRuleSettingsPreview: mockUseRuleSettingsPreview };
});

import { RuleSettingsModal } from "./RuleSettingsModal.tsx";

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

const SETTINGS: GetRuleSettingsResponse = {
  defaults: { picker: PICKER_DEFAULTS, exits: EXITS_DEFAULTS, regime: REGIME_DEFAULTS },
  overrides: { picker: { maxOpenCalendars: 8 } },
  effective: {
    picker: { ...PICKER_DEFAULTS, maxOpenCalendars: 8 },
    exits: EXITS_DEFAULTS,
    regime: REGIME_DEFAULTS,
  },
};

function mockReturn(overrides: Partial<ReturnType<typeof baseReturn>> = {}): void {
  mockUseRuleSettings.mockReturnValue({ ...baseReturn(), ...overrides });
}

function baseReturn() {
  return {
    defaults: SETTINGS.defaults,
    overrides: SETTINGS.overrides,
    effective: SETTINGS.effective,
    isPending: false,
    errors: {},
    saveGroup: mockSaveGroup,
    resetGroup: mockResetGroup,
  };
}

const REGIME_INDICATORS: ReadonlyArray<RegimeIndicator> = [
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
];

const SCORED_CANDIDATE: PickerCandidate = {
  id: "7500P-2026-08-03-2026-08-31",
  name: "7500P 2026-08-03 / 2026-08-31",
  score: 72,
  breakdown: [{ criterion: "slope", weight: 10, rawValue: 0.05, contribution: 80 }],
  debit: 4585,
  theta: 12.3,
  vega: 45.1,
  delta: -30.2,
  gamma: null,
  fwdIv: 0.155,
  fwdIvGuard: "ok",
  slope: 0.08,
  fwdEdge: 5.1,
  expectedMove: 200,
  frontEvents: [],
  backEvents: [],
  frontLeg: { strike: 7500, putCall: "P", dte: 21, iv: 0.15 },
  backLeg: { strike: 7500, putCall: "P", dte: 45, iv: 0.16 },
  context: [],
  bucket: "standard",
  exitPlan: {
    profitTargetPct: 0.25,
    stopPct: 0.175,
    manageShortDte: 21,
    closeByExpiry: "2026-08-02",
    thetaCapturePct: null,
  },
};

/** A controllable fake useMutation -- resolves `response` (or throws when `shouldError`) and
 *  updates isPending/isError/data reactively via a real useState, so the component's render
 *  reflects the mutation lifecycle exactly like the real hook would. */
function makePreviewMutationMock(response: PreviewRuleOverridesResponse | undefined, shouldError = false) {
  return function usePreviewMutationMock() {
    const [state, setState] = useState<{
      isPending: boolean;
      isError: boolean;
      data: PreviewRuleOverridesResponse | undefined;
    }>({ isPending: false, isError: false, data: undefined });

    return {
      ...state,
      mutateAsync: async (body: unknown): Promise<PreviewRuleOverridesResponse> => {
        mockPreviewMutateAsync(body);
        if (shouldError) {
          setState({ isPending: false, isError: true, data: undefined });
          throw new Error("preview failed");
        }
        assertDefined(response, "makePreviewMutationMock response");
        setState({ isPending: false, isError: false, data: response });
        return response;
      },
      // WR-02: mirrors react-query's real useMutation().reset() -- clears back to idle so a
      // component-level `previewMutation.reset()` call is observable in a test.
      reset: () => {
        setState({ isPending: false, isError: false, data: undefined });
      },
    };
  };
}

function renderModal(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RuleSettingsModal />
    </QueryClientProvider>,
  );
}

describe("RuleSettingsModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stays closed until the gear trigger is clicked, then renders three engine groups", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();

    expect(screen.queryByTestId("settings-group-picker")).toBeNull();

    fireEvent.click(screen.getByTestId("settings-trigger"));

    expect(screen.getByTestId("settings-group-picker")).toBeTruthy();
    expect(screen.getByTestId("settings-group-exits")).toBeTruthy();
    expect(screen.getByTestId("settings-group-regime")).toBeTruthy();
    expect(screen.getByText("Entry/Picker")).toBeTruthy();
    expect(screen.getByText("Exit Advisor")).toBeTruthy();
    expect(screen.getByText("Regime Bands")).toBeTruthy();
  });

  it("shows both effective and default for an overridden knob", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const maxOpenInput = screen.getByLabelText("Max Open Calendars");
    expect(maxOpenInput).toHaveProperty("value", "8");
    expect(pickerGroup.textContent).toContain("default 6");
  });

  it("reset button calls resetGroup for that group", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    fireEvent.click(within(pickerGroup).getByText("Reset to defaults"));

    expect(mockResetGroup).toHaveBeenCalledWith("picker");
  });

  it("save calls saveGroup with the edited group patch", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const maxOpenInput = screen.getByLabelText("Max Open Calendars");
    fireEvent.change(maxOpenInput, { target: { value: "9" } });
    fireEvent.click(within(pickerGroup).getByText("Save"));

    expect(mockSaveGroup).toHaveBeenCalledWith(
      "picker",
      expect.objectContaining({ maxOpenCalendars: 9 }),
    );
  });

  // WR-02 (29-REVIEW.md): clicking into a field and clearing it (draft becomes "", not
  // undefined) must fall back to the current effective value, never silently save 0 --
  // Number("") === 0 previously slipped past the Number.isFinite guard.
  it("clearing a field before Save falls back to the effective value, not 0", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const maxOpenInput = screen.getByLabelText("Max Open Calendars");
    fireEvent.change(maxOpenInput, { target: { value: "9" } });
    fireEvent.change(maxOpenInput, { target: { value: "" } });
    fireEvent.click(within(pickerGroup).getByText("Save"));

    // effective.picker.maxOpenCalendars is 8 in this fixture (SETTINGS.effective) -- a
    // cleared field must reproduce it, not the empty-string-coerced-to-0 bug.
    expect(mockSaveGroup).toHaveBeenCalledWith(
      "picker",
      expect.objectContaining({ maxOpenCalendars: 8 }),
    );
  });

  // B6: every knob row renders its registry caption + affected-surface tag, sourced from
  // RULE_EXPLAINERS keyed by [group, ...row.path].join(".") -- never an inline copy string.
  it("renders each representative knob's registry summary caption and affected-surface tag", () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerWeightsSlope = RULE_EXPLAINERS["picker.weights.slope"];
    const exitsPlus15Arm = RULE_EXPLAINERS["exits.take.plus15Arm"];
    const regimeVvixWarn = RULE_EXPLAINERS["regime.vvixWarn"];
    assertDefined(pickerWeightsSlope, "picker.weights.slope explainer present");
    assertDefined(exitsPlus15Arm, "exits.take.plus15Arm explainer present");
    assertDefined(regimeVvixWarn, "regime.vvixWarn explainer present");

    expect(screen.getByText(pickerWeightsSlope.summary)).toBeTruthy();
    expect(screen.getByText(exitsPlus15Arm.summary)).toBeTruthy();
    expect(screen.getByText(regimeVvixWarn.summary)).toBeTruthy();

    expect(screen.getAllByText(pickerWeightsSlope.affects).length).toBeGreaterThan(0);
    expect(screen.getAllByText(exitsPlus15Arm.affects).length).toBeGreaterThan(0);
    expect(screen.getAllByText(regimeVvixWarn.affects).length).toBeGreaterThan(0);
  });

  // B9: the info-icon popover (Tooltip primitive's first consumer) surfaces the registry
  // direction + unit copy on focus, keeping the trigger keyboard-focusable.
  it("info-icon popover surfaces the registry direction + unit for a representative row on focus", async () => {
    mockReturn();
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    mockUseRegimeBoard.mockReturnValue({ data: undefined });
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const exitsPlus15Arm = RULE_EXPLAINERS["exits.take.plus15Arm"];
    assertDefined(exitsPlus15Arm, "exits.take.plus15Arm explainer present");

    const trigger = screen.getByLabelText("Take Plus15 Arm details");
    fireEvent.focus(trigger);

    expect(await screen.findByText(new RegExp(exitsPlus15Arm.direction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    expect(await screen.findByText(new RegExp(exitsPlus15Arm.unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
  });
});

// 32-06: explicit Preview button (B1/B2/B3/B5/B7) -- picker/exits dry-run against the server
// preview endpoint, regime re-bands client-side from on-screen indicator values.
describe("RuleSettingsModal — Preview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("staging a weight and clicking Preview renders the movers list (old -> new)", async () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    const response: PreviewRuleOverridesResponse = {
      asOf: "2026-07-09",
      picker: {
        candidates: [{ ...SCORED_CANDIDATE, oldScore: 62 }],
        gate: null,
        sizing: null,
        universeNote: null,
      },
      exits: null,
    };
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(response));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    // weights must sum to exactly 100 (ruleOverrides refinement, T-32-05 identity reuse) --
    // nudge slope up and fwdEdge down by the same amount so the staged body stays valid.
    fireEvent.change(screen.getByLabelText("Weights Slope"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Weights Fwd Edge"), { target: { value: "20" } });
    fireEvent.click(within(pickerGroup).getByText("Preview"));

    await waitFor(() => expect(within(pickerGroup).getByTestId("preview-picker")).toBeTruthy());
    const previewPanel = within(pickerGroup).getByTestId("preview-picker");
    expect(previewPanel.textContent).toContain("62");
    expect(previewPanel.textContent).toContain("72");
    expect(previewPanel.textContent).toContain("Snapshot as of 2026-07-09");
    expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        picker: expect.objectContaining({ weights: expect.objectContaining({ slope: 15, fwdEdge: 20 }) }),
      }),
    );
  });

  it("staging a universe knob and clicking Preview renders the honest note only (no fake movers)", async () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    const response: PreviewRuleOverridesResponse = {
      asOf: "2026-07-09",
      picker: {
        candidates: [],
        gate: null,
        sizing: null,
        universeNote: "Affects next compute cycle, not reflected in this dry-run re-score.",
      },
      exits: null,
    };
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(response));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const frontDteMinInput = screen.getByLabelText("Front Dte Min");
    fireEvent.change(frontDteMinInput, { target: { value: "25" } });
    fireEvent.click(within(pickerGroup).getByText("Preview"));

    await waitFor(() => expect(within(pickerGroup).getByTestId("preview-picker")).toBeTruthy());
    const previewPanel = within(pickerGroup).getByTestId("preview-picker");
    expect(previewPanel.textContent).toContain("Affects next compute cycle");
    expect(previewPanel.textContent).not.toContain("62");
  });

  it("an unstaged picker group preview renders 'No change.'", async () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    const response: PreviewRuleOverridesResponse = {
      asOf: "2026-07-09",
      picker: {
        candidates: [{ ...SCORED_CANDIDATE, oldScore: SCORED_CANDIDATE.score }],
        gate: null,
        sizing: null,
        universeNote: null,
      },
      exits: null,
    };
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(response));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    fireEvent.click(within(pickerGroup).getByText("Preview"));

    await waitFor(() => expect(within(pickerGroup).getByTestId("preview-picker")).toBeTruthy());
    expect(within(pickerGroup).getByTestId("preview-picker").textContent).toContain("No change.");
  });

  it("staging a regime threshold and clicking Preview renders band before -> after (client-side)", () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const regimeGroup = screen.getByTestId("settings-group-regime");
    // VVIX indicator's on-screen value is 108, stored band "warning" (crisis threshold 115).
    // Staging vvixCrisis down to 105 (< 108) re-bands it to "crisis" against the staged
    // threshold -- proves the re-band is computed from the STAGED value, not the stored one.
    const vvixCrisisInput = screen.getByLabelText("Vvix Crisis");
    fireEvent.change(vvixCrisisInput, { target: { value: "105" } });
    fireEvent.click(within(regimeGroup).getByText("Preview"));

    const previewPanel = within(regimeGroup).getByTestId("preview-regime");
    expect(previewPanel.textContent).toContain("VVIX");
    expect(previewPanel.textContent).toContain("warning");
    expect(previewPanel.textContent).toContain("crisis");
    // never calls the server mutation for the regime group (client-side only, T-32-12)
    expect(mockPreviewMutateAsync).not.toHaveBeenCalled();
  });

  // WR-02 (32-REVIEW.md): a rendered Preview panel must not linger after the underlying state
  // changes (Save applies the staged values) -- a stale diff would describe a transition that
  // already happened.
  it("WR-02: Save clears the rendered preview panel (mutation reset)", async () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    const response: PreviewRuleOverridesResponse = {
      asOf: "2026-07-09",
      picker: {
        candidates: [{ ...SCORED_CANDIDATE, oldScore: 62 }],
        gate: null,
        sizing: null,
        universeNote: null,
      },
      exits: null,
    };
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(response));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    fireEvent.change(screen.getByLabelText("Weights Slope"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Weights Fwd Edge"), { target: { value: "20" } });
    fireEvent.click(within(pickerGroup).getByText("Preview"));
    await waitFor(() => expect(within(pickerGroup).getByTestId("preview-picker")).toBeTruthy());

    fireEvent.click(within(pickerGroup).getByText("Save"));

    await waitFor(() => expect(within(pickerGroup).queryByTestId("preview-picker")).toBeNull());
  });

  // WR-02 (32-REVIEW.md): same stale-panel problem on the Reset-per-group path.
  it("WR-02: Reset clears a rendered regime preview panel", async () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const regimeGroup = screen.getByTestId("settings-group-regime");
    const vvixCrisisInput = screen.getByLabelText("Vvix Crisis");
    fireEvent.change(vvixCrisisInput, { target: { value: "105" } });
    fireEvent.click(within(regimeGroup).getByText("Preview"));
    expect(within(regimeGroup).getByTestId("preview-regime")).toBeTruthy();

    fireEvent.click(within(regimeGroup).getByText("Reset to defaults"));

    await waitFor(() => expect(within(regimeGroup).queryByTestId("preview-regime")).toBeNull());
  });

  it("Save still works unregressed alongside the new Preview button", () => {
    mockReturn();
    mockUseRegimeBoard.mockReturnValue({ data: REGIME_INDICATORS });
    mockUseRuleSettingsPreview.mockImplementation(makePreviewMutationMock(undefined));
    renderModal();
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const maxOpenInput = screen.getByLabelText("Max Open Calendars");
    fireEvent.change(maxOpenInput, { target: { value: "9" } });
    fireEvent.click(within(pickerGroup).getByText("Save"));

    expect(mockSaveGroup).toHaveBeenCalledWith("picker", expect.objectContaining({ maxOpenCalendars: 9 }));
  });
});
