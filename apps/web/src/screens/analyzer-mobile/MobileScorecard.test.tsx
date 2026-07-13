/**
 * MobileScorecard.test.tsx — the mobile Analyzer verdict hero (Phase 36, D-08, J7).
 *
 * The component is FULLY CONTROLLED — these tests render it directly with candidates drawn
 * from the frozen pickerSnapshotFixture (@morai/contracts) and the scorecard props the mobile
 * tree feeds it. No hooks, no network, no matchMedia — pure props → DOM.
 *
 * J7a null → renders nothing · J7b not-scored → note only · J7c scored hero · J7d combined
 * book summary · J7e checklist rows (scoreStatus icons, θ GATE, guard n/a, weights, CALIBRATING,
 * gate-drops) · J7f AH session row.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate, RuleSetEntry } from "@morai/contracts";
import { exactAbs } from "../../lib/position-format.ts";
import { MobileScorecard } from "./MobileScorecard.tsx";

const SORTED = [...pickerSnapshotFixture.candidates].sort((a, b) => b.score - a.score);
const TOP = SORTED[0];
const GUARD = pickerSnapshotFixture.candidates.find((c) => c.fwdIv === null);
if (TOP === undefined || GUARD === undefined) {
  throw new Error("fixture must carry a top candidate and a guard (fwdIv null) candidate");
}

const BASE = {
  ruleSet: pickerSnapshotFixture.ruleSet,
  gateDrops: { liquidity: 2, netTheta: 1 },
  marketSession: "rth" as const,
  bookCount: 1,
  bookDebit: TOP.debit,
  bookTheta: TOP.theta,
  bookVega: TOP.vega,
};

/** The verbatim desktop selected-name context tail for a scored candidate. */
function contextTail(c: PickerCandidate): string {
  return ` · debit $${exactAbs(c.debit)} · θ ${c.theta >= 0 ? "+" : ""}${c.theta.toFixed(1)}/d · vega +${exactAbs(c.vega)}`;
}

const REGISTRY_RULESET: ReadonlyArray<RuleSetEntry> = [
  { id: "fwdEdge", label: "Forward-IV edge", kind: "score", weight: 35, status: "active", rationale: "fwd" },
  { id: "slope", label: "Term-structure slope", kind: "score", weight: 30, status: "active", rationale: "vrp" },
  { id: "gexFit", label: "GEX placement", kind: "score", weight: 15, status: "active", rationale: "walls" },
  { id: "eventAdjustment", label: "Front-leg event risk", kind: "score", weight: 10, status: "active", rationale: "events" },
  { id: "beVsEm", label: "Breakeven vs EM", kind: "score", weight: 10, status: "active", rationale: "zone" },
];

afterEach(cleanup);

describe("MobileScorecard — J7 verdict hero", () => {
  it("J7a: candidate === null renders nothing (no scorecard shell)", () => {
    const { container } = render(<MobileScorecard candidate={null} {...BASE} />);
    expect(container.querySelector('[data-testid="mobile-score"]')).toBeNull();
    expect(screen.queryByText("Scorecard")).toBeNull();
    expect(container.querySelector('[data-testid^="checklist-"]')).toBeNull();
  });

  it("J7b: a not-scored candidate (breakdown []) renders only the label + not-scored note", () => {
    const notScored: PickerCandidate = { ...TOP, breakdown: [] };
    const { container } = render(<MobileScorecard candidate={notScored} {...BASE} />);
    expect(screen.getByText("Scorecard")).toBeTruthy();
    expect(screen.getByText("Pasted calendar — not engine-scored.")).toBeTruthy();
    expect(container.querySelector('[data-testid="mobile-score"]')).toBeNull();
    expect(container.querySelector('[data-testid^="checklist-"]')).toBeNull();
  });

  it("J7c: a scored candidate renders the 32px rounded score + verbatim context line, no combined book at bookCount 1", () => {
    render(<MobileScorecard candidate={TOP} {...BASE} />);

    const score = screen.getByTestId("mobile-score");
    expect(score.textContent).toBe(String(Math.round(TOP.score)));
    expect(score.className).toContain("text-[32px]");
    expect(score.className).toContain("font-mono");
    expect(score.className).toContain("font-bold");

    const name = screen.getByTestId("risk-profile-selected-name");
    expect(name.textContent).toBe(TOP.name);
    expect(name.className).toContain("text-violet");
    expect(name.parentElement?.textContent).toContain(contextTail(TOP));

    expect(screen.queryByTestId("combined-book-summary")).toBeNull();
  });

  it("J7d: bookCount 2 renders the verbatim combined-book summary", () => {
    render(
      <MobileScorecard
        candidate={TOP}
        {...BASE}
        bookCount={2}
        bookDebit={9637}
        bookTheta={84.5}
        bookVega={610}
      />,
    );
    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toBe(
      "+ 1 more → combined debit $9637 (max loss) · θ +84.5/d · vega +610",
    );
    expect(summary.className).toContain("text-amber");
  });

  it("J7e: one checklist row per active score rule, θ GATE sign-colored, gate-drops fine print", () => {
    render(<MobileScorecard candidate={TOP} {...BASE} />);

    for (const key of ["fwdEdge", "slope", "eventAdjustment", "gexFit", "beVsEm"]) {
      expect(screen.getByTestId(`checklist-${key}`)).toBeTruthy();
    }
    // gexFit contribution 100 → ✓ 100%; fwdEdge contribution 0 → ✗ 0%.
    expect(screen.getByTestId("checklist-gexFit").textContent).toContain("✓");
    expect(screen.getByTestId("checklist-gexFit").textContent).toContain("100%");

    const theta = screen.getByTestId("checklist-theta");
    expect(theta.textContent).toContain("✓");
    expect(theta.textContent).toContain(`+${TOP.theta.toFixed(1)}/d`);

    expect(screen.getByTestId("checklist-gate-drops").textContent).toBe(
      "2 illiquid quotes · 1 negative-θ pair dropped this run",
    );
  });

  it("J7e: the guard candidate (fwdIv null) shows the fwdEdge row as — n/a in text-dim", () => {
    render(<MobileScorecard candidate={GUARD} {...BASE} />);
    const fwd = screen.getByTestId("checklist-fwdEdge");
    expect(fwd.textContent).toContain("—");
    expect(fwd.textContent).toContain("n/a");
    expect(fwd.querySelector(".text-dim")).not.toBeNull();
  });

  it("J7e: engine ruleSet weights render as w{n} spans; CALIBRATING row appears when context is non-empty", () => {
    const withContext: PickerCandidate = {
      ...TOP,
      context: [{ id: "vrp", label: "VRP (front IV − RV20)", value: 0.031, note: "calibrating" }],
    };
    render(<MobileScorecard candidate={withContext} {...BASE} ruleSet={REGISTRY_RULESET} />);

    expect(screen.getByTestId("checklist-fwdEdge-weight").textContent).toBe("w35");
    expect(screen.getByTestId("checklist-slope-weight").textContent).toBe("w30");

    const calibrating = screen.getByTestId("checklist-experimental");
    expect(calibrating.textContent).toContain("CALIBRATING");
    expect(calibrating.textContent).toContain("VRP 0.031");
  });

  it("J7f: after-hours renders a SESSION row (AH — indicative, amber) first; absent under rth", () => {
    const { rerender } = render(
      <MobileScorecard candidate={TOP} {...BASE} marketSession="after-hours" />,
    );
    const session = screen.getByTestId("checklist-session");
    expect(session.textContent).toContain("SESSION");
    expect(session.textContent).toContain("AH — indicative");
    expect(session.querySelector(".text-amber")).not.toBeNull();
    // Renders first — before the first score row.
    const fwd = screen.getByTestId("checklist-fwdEdge");
    expect(session.compareDocumentPosition(fwd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<MobileScorecard candidate={TOP} {...BASE} marketSession="rth" />);
    expect(screen.queryByTestId("checklist-session")).toBeNull();
  });
});
