/**
 * rule-explainers.ts — the ONE typed per-knob help-copy registry (Phase 32, Plan 01, B6).
 *
 * Every entry is keyed by the DOTTED path a knob has inside `ruleConfig` (rule-settings.ts),
 * including its group prefix (e.g. "picker.weights.slope", "exits.take.plus15Arm",
 * "regime.vvixWarn"). This is the single source of trader-facing knob copy the Rule Settings
 * modal renders — never a scattered inline string (32-CONTEXT.md "Knob explainer copy lives
 * in ONE typed registry").
 *
 * Completeness is enforced by rule-explainers.test.ts, which walks the REAL `ruleConfig`
 * schema recursively and asserts a 1:1 mapping — a knob added here without copy (or copy
 * added for a knob that doesn't exist) fails that test.
 *
 * Copy tone: Hemingway, trader-facing (this user trades SPX put calendars). Rationale prose
 * is reused from RULE_SET_METADATA (picker/domain/rules.ts) and EXIT_RULE_METADATA
 * (exits/domain/exit-rules.ts) where it already reads well for a knob-level sentence.
 */

/** Which engine output a knob's value change ultimately shows up in. */
export type RuleAffectedSurface = "Picker candidates" | "Exit verdicts" | "Regime board";

export type RuleExplainer = {
  /** One plain sentence: what this knob gates or scores. */
  readonly summary: string;
  /** The unit the value is expressed in (e.g. "delta (Δ)", "days", "$", "% of debit"). */
  readonly unit: string;
  /** Direction-of-effect sentence: what happens when the value goes up. */
  readonly direction: string;
  readonly affects: RuleAffectedSurface;
};

const PICKER: "Picker candidates" = "Picker candidates";
const EXITS: "Exit verdicts" = "Exit verdicts";
const REGIME: "Regime board" = "Regime board";

export const RULE_EXPLAINERS: Readonly<Record<string, RuleExplainer>> = {
  // ─── picker: delta band + DTE windows (candidate-selection.ts) ────────────────
  "picker.deltaBandMin": {
    summary: "Deep edge of the short-put delta band — the closest-to-the-money strike allowed.",
    unit: "delta (Δ)",
    direction: "Lower (more negative, toward −0.49) = candidates closer to at-the-money allowed.",
    affects: PICKER,
  },
  "picker.deltaBandMax": {
    summary: "Upper edge of the short-put delta band.",
    unit: "delta (Δ)",
    // CR-02: deltas are negative -- deltaBandMax's default (−0.30) is already the SHALLOW
    // (further-OTM) edge, not the near-ATM one (that's deltaBandMin, −0.49 by default). Raising
    // deltaBandMax admits deltas LESS negative than today's default, i.e. further out of the
    // money (candidate-selection.ts: DELTA_BAND_MIN=-0.49, DELTA_BAND_MAX=-0.3, filter keeps
    // deltaMin <= delta <= deltaMax).
    direction: "Higher (less negative, away from −0.49) = further-out-of-the-money candidates allowed.",
    affects: PICKER,
  },
  "picker.frontDteMin": {
    summary: "Shortest days-to-expiration a short front leg can have.",
    unit: "days",
    direction: "Higher = the front leg must have more time left to qualify.",
    affects: PICKER,
  },
  "picker.frontDteMax": {
    summary: "Longest days-to-expiration a short front leg can have.",
    unit: "days",
    direction: "Higher = further-out front expiries are allowed into the universe.",
    affects: PICKER,
  },
  "picker.backDteMinGap": {
    summary: "Smallest expiry gap allowed between the front and back legs.",
    unit: "days",
    direction: "Higher = the back leg must sit further out past the front leg.",
    affects: PICKER,
  },
  "picker.backDteMaxGap": {
    summary: "Largest expiry gap allowed between the front and back legs.",
    unit: "days",
    direction: "Higher = back expiries further out from the front leg are allowed.",
    affects: PICKER,
  },

  // ─── picker.weights: the 9 scoring criteria (rules.ts, sum-to-100) ────────────
  "picker.weights.slope": {
    summary: "Score points for term-structure slope — how rich the front leg is vs. the back leg.",
    unit: "points (of 100)",
    direction:
      "Higher = the picker rewards mild front-richness (the VRP-harvest edge) more heavily in the ranking.",
    affects: PICKER,
  },
  "picker.weights.fwdEdge": {
    summary: "Score points for forward-IV edge — the structural calendar edge between the two legs.",
    unit: "points (of 100)",
    direction: "Higher = the picker weights the core forward-edge signal more heavily.",
    affects: PICKER,
  },
  "picker.weights.gexFit": {
    summary: "Score points for GEX placement — dampen regime and dealer-defended-range fit.",
    unit: "points (of 100)",
    direction: "Higher = candidates sitting inside the dealer-defended GEX range rank higher.",
    affects: PICKER,
  },
  "picker.weights.eventAdjustment": {
    summary: "Score points for front-leg event risk (FOMC/CPI/NFP inside the short leg).",
    unit: "points (of 100)",
    direction: "Higher = event-risk penalties move the ranking more.",
    affects: PICKER,
  },
  "picker.weights.beVsEm": {
    summary: "Score points for breakeven width vs. the expected move by front expiry.",
    unit: "points (of 100)",
    direction: "Higher = wider profit-zone coverage matters more to the ranking.",
    affects: PICKER,
  },
  "picker.weights.deltaNeutral": {
    summary: "Score points for net delta neutrality (staying flat, near 0).",
    unit: "points (of 100)",
    direction: "Higher = the picker penalizes skew-driven directional tilt more heavily.",
    affects: PICKER,
  },
  "picker.weights.thetaVega": {
    summary: "Score points for the theta/vega carry ratio — decay earned per unit of vol risk.",
    unit: "points (of 100)",
    direction: "Higher = candidates with more carry per vol-risk dollar rank higher.",
    affects: PICKER,
  },
  "picker.weights.vrp": {
    summary: "Score points for volatility risk premium — front IV over realized vol.",
    unit: "points (of 100)",
    direction: "Higher = candidates whose implied trades rich to realized rank higher.",
    affects: PICKER,
  },
  "picker.weights.debitFit": {
    summary: "Score points for how close the debit paid sits to the ideal spend band.",
    unit: "points (of 100)",
    direction: "Higher = spend fit matters more to the ranking; all 9 weights must still sum to 100.",
    affects: PICKER,
  },

  // ─── picker: debitFit ideal band (rules.ts) ───────────────────────────────────
  "picker.debitIdealMin": {
    summary: "Bottom of the ideal spend band — the debit level that earns full debitFit credit.",
    unit: "$",
    direction: "Higher = a pricier calendar is required before debitFit stops crediting cheapness.",
    affects: PICKER,
  },
  "picker.debitIdealMax": {
    summary: "Top of the ideal spend band before debitFit starts fading toward 0.",
    unit: "$",
    direction: "Higher = more expensive calendars still earn full debitFit credit.",
    affects: PICKER,
  },

  // ─── picker.vixLadder: tier boundaries (entry-gate.ts) ────────────────────────
  "picker.vixLadder.normalMin": {
    summary: "VIX level where the ladder leaves the \"low\" tier and enters \"normal\".",
    unit: "VIX",
    direction: "Higher = VIX must climb further before entries drop out of the full-size low tier.",
    affects: PICKER,
  },
  "picker.vixLadder.elevatedMin": {
    summary: "VIX level where the ladder leaves \"normal\" and enters \"elevated\" (sizing tier boundary).",
    unit: "VIX",
    // CR-02: the ladder tiers sizing/display ONLY -- the entry gate's own penalty-band trigger
    // is a fixed constant (VIX_PENALTY_FLOOR=20, entry-gate.ts) that this knob does NOT move
    // (ResolveEntryGateInput.vixLadder doc comment, entry-gate.ts:236-240).
    direction:
      "Higher = VIX must climb further before sizing drops to the elevated-tier contract count. Does not move the entry gate's own penalty-band trigger (fixed at VIX 20).",
    affects: PICKER,
  },
  "picker.vixLadder.crisisMin": {
    summary: "VIX level where the ladder enters \"crisis\" (sizing drops to zero contracts).",
    unit: "VIX",
    // CR-02: same fixed-constant caveat as elevatedMin above -- the hard entry block is
    // VIX_BLOCK_ARM=25 (entry-gate.ts), unmoved by this ladder knob.
    direction:
      "Higher = VIX must climb further before sizing drops to zero. Does not move the entry gate's own hard-block trigger (fixed at VIX 25).",
    affects: PICKER,
  },

  // ─── picker: maxOpenCalendars brake (brakes.ts) ───────────────────────────────
  "picker.maxOpenCalendars": {
    summary: "Max simultaneously-open calendars before new entries pause.",
    unit: "calendars",
    direction: "Higher = more calendars can be open at once before the max-open brake trips.",
    affects: PICKER,
  },

  // ─── picker.sizingContracts: VIX-tiered contract counts (sizing.ts) ──────────
  "picker.sizingContracts.low": {
    summary: "Contracts to size a new entry at when VIX is in the calm/low tier.",
    unit: "contracts",
    direction: "Higher = larger recommended size on calm-VIX entries.",
    affects: PICKER,
  },
  "picker.sizingContracts.normal": {
    summary: "Contracts to size a new entry at when VIX is in the normal tier.",
    unit: "contracts",
    direction: "Higher = larger recommended size on normal-VIX entries.",
    affects: PICKER,
  },
  "picker.sizingContracts.elevated": {
    summary: "Contracts to size a new entry at when VIX is in the elevated (penalty-band) tier.",
    unit: "contracts",
    direction: "Higher = larger recommended size while the entry gate is already penalizing score.",
    affects: PICKER,
  },
  "picker.sizingContracts.crisis": {
    summary: "Contracts to size a new entry at when VIX is in the crisis tier.",
    unit: "contracts",
    direction:
      "Higher = larger recommended size during crisis VIX — the entry gate hard-blocks here by default, so this rarely fires.",
    affects: PICKER,
  },

  // ─── exits.take: TAKE profit rungs (exit-rules.ts) ────────────────────────────
  "exits.take.plus15Arm": {
    summary: "Profit % that arms the TAKE +15% exit rung.",
    unit: "% of debit",
    direction: "Higher = the calendar must run further into profit before this rung can trigger.",
    affects: EXITS,
  },
  "exits.take.plus15Disarm": {
    summary: "Profit % the +15% TAKE rung must fall back below to disarm (hysteresis floor).",
    unit: "% of debit",
    direction: "Higher = the rung stays armed through a smaller profit pullback before disarming.",
    affects: EXITS,
  },
  "exits.take.plus10Arm": {
    summary: "Profit % that arms the TAKE +10% exit rung.",
    unit: "% of debit",
    direction: "Higher = the calendar must run further into profit before this rung can trigger.",
    affects: EXITS,
  },
  "exits.take.plus10Disarm": {
    summary: "Profit % the +10% TAKE rung must fall back below to disarm (hysteresis floor).",
    unit: "% of debit",
    direction: "Higher = the rung stays armed through a smaller profit pullback before disarming.",
    affects: EXITS,
  },
  "exits.take.plus5Arm": {
    summary: "Profit % that arms the TAKE +5% exit rung.",
    unit: "% of debit",
    direction: "Higher = the calendar must run further into profit before this rung can trigger.",
    affects: EXITS,
  },
  "exits.take.plus5Disarm": {
    summary: "Profit % the +5% TAKE rung must fall back below to disarm (hysteresis floor).",
    unit: "% of debit",
    direction: "Higher = the rung stays armed through a smaller profit pullback before disarming.",
    affects: EXITS,
  },

  // ─── exits.stop: STOP loss rungs (exit-rules.ts) ──────────────────────────────
  "exits.stop.minus50Arm": {
    summary: "Loss % that arms the STOP −50% exit rung.",
    unit: "% of debit",
    direction: "More negative (deeper) = the calendar must lose more before this rung can trigger.",
    affects: EXITS,
  },
  "exits.stop.minus50Disarm": {
    summary: "Loss % the −50% STOP rung must recover back above to disarm (hysteresis floor).",
    unit: "% of debit",
    direction: "More negative = the rung stays armed through a smaller recovery before disarming.",
    affects: EXITS,
  },
  "exits.stop.minus25Arm": {
    summary: "Loss % that arms the STOP −25% exit rung.",
    unit: "% of debit",
    direction: "More negative (deeper) = the calendar must lose more before this rung can trigger.",
    affects: EXITS,
  },
  "exits.stop.minus25Disarm": {
    summary: "Loss % the −25% STOP rung must recover back above to disarm (hysteresis floor).",
    unit: "% of debit",
    direction: "More negative = the rung stays armed through a smaller recovery before disarming.",
    affects: EXITS,
  },

  // ─── regime: the four warn/crisis band pairs (regime.ts) ─────────────────────
  "regime.vixTermStructureWarn": {
    summary: "VIX/VIX3M ratio where the regime board's term-structure indicator flips from calm to warning.",
    unit: "ratio",
    direction: "Higher = the ratio must climb further before the board leaves calm.",
    affects: REGIME,
  },
  "regime.vixTermStructureCrisis": {
    summary: "VIX/VIX3M ratio where the term-structure indicator flips from warning to crisis.",
    unit: "ratio",
    direction: "Higher = the ratio must climb further before the board reads crisis.",
    affects: REGIME,
  },
  "regime.vvixWarn": {
    summary: "VVIX level where the regime board's vol-of-vol indicator flips from calm to warning.",
    unit: "VVIX",
    direction: "Higher = VVIX must climb further before the board leaves calm.",
    affects: REGIME,
  },
  "regime.vvixCrisis": {
    summary: "VVIX level where the vol-of-vol indicator flips from warning to crisis.",
    unit: "VVIX",
    direction: "Higher = VVIX must climb further before the board reads crisis.",
    affects: REGIME,
  },
  "regime.vix9dRatioWarn": {
    summary: "VIX9D/VIX ratio where the short-term-stress indicator flips from calm to warning.",
    unit: "ratio",
    direction: "Higher = the ratio must climb further before the board leaves calm.",
    affects: REGIME,
  },
  "regime.vix9dRatioCrisis": {
    summary: "VIX9D/VIX ratio where the short-term-stress indicator flips from warning to crisis.",
    unit: "ratio",
    direction: "Higher = the ratio must climb further before the board reads crisis.",
    affects: REGIME,
  },
  "regime.hyOasWarn": {
    summary: "High-yield credit spread level where the regime board's credit indicator flips from calm to warning.",
    unit: "%",
    direction: "Higher = the spread must widen further before the board leaves calm.",
    affects: REGIME,
  },
  "regime.hyOasCrisis": {
    summary: "High-yield credit spread level where the credit indicator flips from warning to crisis.",
    unit: "%",
    direction: "Higher = the spread must widen further before the board reads crisis.",
    affects: REGIME,
  },
};
