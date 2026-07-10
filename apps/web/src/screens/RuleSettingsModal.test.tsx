/**
 * RuleSettingsModal.test.tsx — TDD suite for the Phase 29-14 gear-icon settings modal.
 *
 * Behaviors under test:
 *   - The gear trigger opens the modal (closed until clicked, mirrors Overview.test.tsx's
 *     "exit rules live behind the header dialog" pattern).
 *   - Three engine groups render: Entry/Picker, Exit Advisor, Regime Bands.
 *   - An overridden knob (picker.maxOpenCalendars) shows both its effective value AND its
 *     default value alongside.
 *   - Each group's reset button calls resetGroup(group).
 *   - Saving an edited knob calls saveGroup(group, patch).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { GetRuleSettingsResponse } from "@morai/contracts";

const { mockUseRuleSettings, mockSaveGroup, mockResetGroup } = vi.hoisted(() => ({
  mockUseRuleSettings: vi.fn(),
  mockSaveGroup: vi.fn(() => Promise.resolve()),
  mockResetGroup: vi.fn(() => Promise.resolve()),
}));
vi.mock("../hooks/useRuleSettings.ts", () => ({ useRuleSettings: mockUseRuleSettings }));

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

describe("RuleSettingsModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stays closed until the gear trigger is clicked, then renders three engine groups", () => {
    mockReturn();
    render(<RuleSettingsModal />);

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
    render(<RuleSettingsModal />);
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    const maxOpenInput = screen.getByLabelText("Max Open Calendars");
    expect(maxOpenInput).toHaveProperty("value", "8");
    expect(pickerGroup.textContent).toContain("default 6");
  });

  it("reset button calls resetGroup for that group", () => {
    mockReturn();
    render(<RuleSettingsModal />);
    fireEvent.click(screen.getByTestId("settings-trigger"));

    const pickerGroup = screen.getByTestId("settings-group-picker");
    fireEvent.click(within(pickerGroup).getByText("Reset to defaults"));

    expect(mockResetGroup).toHaveBeenCalledWith("picker");
  });

  it("save calls saveGroup with the edited group patch", () => {
    mockReturn();
    render(<RuleSettingsModal />);
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
});
