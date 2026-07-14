/**
 * WhyPanel.test.tsx — TDD RED for the picker's "Why this calendar" panel (ANLZ-03, D-01b).
 *
 * Covers the UI-SPEC "Why-panel" contract: the Fwd IV/Slope/Net θ/θ:vega stat grid (incl. the
 * guard-case `—` render), the forward-edge 3-way branch (front-rich / forward-tailwind / guard
 * sentence), the event-premium 2-way branch, and the closing GEX-fit sentence. Net θ must never
 * render negative (T-18-10 mitigation).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import { WhyPanel } from "./WhyPanel.tsx";

const CANDIDATES = pickerSnapshotFixture.candidates;
const GEX = pickerSnapshotFixture.gex;

function findCandidate(id: string): PickerCandidate {
  const found = CANDIDATES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`fixture candidate not found: ${id}`);
  return found;
}

/** Top-ranked real candidate: strike 7500 (== absGammaStrike), fwdEdge < 0, frontEvents non-empty. */
const NORMAL = findCandidate("7500-260723-260814");
/** Put-wall-strike real candidate: strike 7400 (== putWall). */
const PUT_WALL_CANDIDATE = findCandidate("7400-260723-260814");
/** The constructed guard candidate: fwdIv null, fwdIvGuard "inverted", slope negative. */
const GUARD = findCandidate("7450-guard-inverted");

/** Synthetic front-rich candidate (fwdEdge > 0) — no fixture candidate exercises this branch,
 * so this test constructs one via spread + override (Claude's Discretion, component-test norm). */
const FRONT_RICH: PickerCandidate = {
  ...NORMAL,
  id: "synthetic-front-rich",
  fwdIv: 0.1,
  fwdEdge: 0.05,
};

/** Synthetic clean (no-event) candidate — no fixture candidate has an empty frontEvents list. */
const CLEAN: PickerCandidate = {
  ...NORMAL,
  id: "synthetic-clean",
  frontEvents: [],
  backEvents: [],
};

describe("WhyPanel — stat grid (ANLZ-03)", () => {
  afterEach(cleanup);

  it("renders Fwd IV as a percentage with the 'vs front' sub-caption for a normal candidate", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    expect(screen.getByTestId("whypanel-stat-fwdiv-value").textContent).toBe("15.3%");
    expect(screen.getByTestId("whypanel-stat-fwdiv-subcaption").textContent).toBe("vs front 12.5%");
  });

  it("guard case (fwdIv null): Fwd IV renders '—', sub-caption unchanged (front IV always known)", () => {
    render(<WhyPanel candidate={GUARD} gex={GEX} />);
    expect(screen.getByTestId("whypanel-stat-fwdiv-value").textContent).toBe("—");
    expect(screen.getByTestId("whypanel-stat-fwdiv-subcaption").textContent).toBe("vs front 15.5%");
  });

  it("renders Slope in violet when positive", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    const el = screen.getByTestId("whypanel-stat-slope-value");
    expect(el.textContent).toBe("+25.4v/yr");
    expect(el.className).toContain("text-violet");
  });

  it("renders Slope in down/red when negative (guard candidate)", () => {
    render(<WhyPanel candidate={GUARD} gex={GEX} />);
    const el = screen.getByTestId("whypanel-stat-slope-value");
    expect(el.textContent).toBe("−76.0v/yr");
    expect(el.className).toContain("text-down");
  });

  it("Net θ always renders positive (never NaN, never negative) for a normal candidate", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    const el = screen.getByTestId("whypanel-stat-nettheta-value");
    expect(el.textContent).toBe("+45.9/d");
    expect(el.className).toContain("text-up");
  });

  it("Net θ still renders positive for the guard candidate (theta stays a normal finite value)", () => {
    render(<WhyPanel candidate={GUARD} gex={GEX} />);
    const el = screen.getByTestId("whypanel-stat-nettheta-value");
    expect(el.textContent).toBe("+138.1/d");
    expect(el.className).toContain("text-up");
    expect(el.textContent).not.toContain("−");
    expect(el.textContent).not.toContain("NaN");
  });

  it("renders θ:vega as the theta/vega ratio to 3 decimals", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    expect(screen.getByTestId("whypanel-stat-thetavega-value").textContent).toBe(
      (NORMAL.theta / NORMAL.vega).toFixed(3),
    );
  });

  it("renders θ:vega as the no-value fallback when vega is 0 (never 'Infinity'/'NaN') — WR-05", () => {
    // pickerCandidate.vega is z.number() — 0 is valid. The panel's own contract promises a
    // guard-safe value, never a fabricated number, so division by zero must render '—'.
    const zeroVega: PickerCandidate = { ...NORMAL, id: "synthetic-zero-vega", theta: 45.9, vega: 0 };
    render(<WhyPanel candidate={zeroVega} gex={GEX} />);
    const value = screen.getByTestId("whypanel-stat-thetavega-value").textContent ?? "";
    expect(value).toBe("—");
    expect(value).not.toContain("Infinity");
    expect(value).not.toContain("NaN");
  });
});

describe("WhyPanel — forward-edge sentence (3-way branch)", () => {
  afterEach(cleanup);

  it("uses front-rich wording when fwdEdge > 0", () => {
    render(<WhyPanel candidate={FRONT_RICH} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-forward-edge-sentence").textContent ?? "";
    expect(sentence).toContain("RICH");
    expect(sentence).toContain("10.0%"); // fwd IV
  });

  it("uses forward-tailwind wording when fwdEdge <= 0 (fwdIv not null) — condensed copy", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-forward-edge-sentence").textContent ?? "";
    expect(sentence).toContain("no richness edge");
    expect(sentence).toContain("slope + carry case");
  });

  it("uses the dedicated locked guard sentence when fwdIv is null (verbatim, T-18-10; condensed rev 2026-07-14)", () => {
    render(<WhyPanel candidate={GUARD} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-forward-edge-sentence").textContent ?? "";
    expect(sentence).toBe(
      "Fwd IV undefined (inverted term structure) — ranked on slope/GEX/event only.",
    );
  });
});

describe("WhyPanel — event-premium sentence (2-way branch)", () => {
  afterEach(cleanup);

  it("warns and names the events when frontEvents.length > 0", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-event-sentence").textContent ?? "";
    expect(sentence).toContain("NFP");
    expect(sentence).toContain("CPI");
    expect(sentence).toContain("event premium");
  });

  it("states the structural/non-event wording when frontEvents is empty", () => {
    render(<WhyPanel candidate={CLEAN} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-event-sentence").textContent ?? "";
    expect(sentence).toContain("structural edge");
    expect(sentence).toContain("No event inside the front leg");
  });
});

describe("WhyPanel — GEX-fit closing sentence (static fixture context)", () => {
  afterEach(cleanup);

  it("flags the absolute-gamma-strike candidate as a pin magnet", () => {
    render(<WhyPanel candidate={NORMAL} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-gex-sentence").textContent ?? "";
    expect(sentence).toContain("pin magnet");
  });

  it("flags the put-wall-strike candidate as support", () => {
    render(<WhyPanel candidate={PUT_WALL_CANDIDATE} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-gex-sentence").textContent ?? "";
    expect(sentence).toContain("put wall");
  });

  it("reports a plain distance for a strike matching neither wall (guard candidate, strike 7450)", () => {
    render(<WhyPanel candidate={GUARD} gex={GEX} />);
    const sentence = screen.getByTestId("whypanel-gex-sentence").textContent ?? "";
    expect(sentence).toContain("50pts from abs-");
  });
});

describe("gex sentence — near-term (45d) level set preferred", () => {
  afterEach(() => {
    cleanup();
  });

  it("speaks the 45d dealer range / wall pin when gex.nearTerm is present", () => {
    const first = pickerSnapshotFixture.candidates[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // Strike the candidate exactly on the near-term put wall → pin sentence.
    const gexWithNearTerm = {
      ...GEX,
      nearTerm: { callWall: 7550, putWall: first.frontLeg.strike, flip: 7486 },
    };
    render(<WhyPanel candidate={first} gex={gexWithNearTerm} />);
    const sentence = screen.getByTestId("whypanel-gex-sentence").textContent ?? "";
    expect(sentence).toContain("45d put wall");
  });

  it("falls back to the legacy abs-γ reference when nearTerm is null", () => {
    const first = pickerSnapshotFixture.candidates[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    render(<WhyPanel candidate={first} gex={{ ...GEX, nearTerm: null }} />);
    const sentence = screen.getByTestId("whypanel-gex-sentence").textContent ?? "";
    expect(sentence).toMatch(/abs-γ strike|put wall|absolute-gamma/);
  });
});
