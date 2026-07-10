import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { mockResponsiveContainer } from "../test/recharts-test-utils";

mockResponsiveContainer();

import { ComposedChart, Area, Bar, Line, ResponsiveContainer } from "recharts";

/**
 * Assumption A1 characterization spike (RESEARCH.md Pitfall 4 / Decision D-16).
 *
 * RESEARCH assumed recharts 3.x controls ComposedChart sibling z-order by strict JSX
 * source order (reading the 3.0 migration guide's "z-index is determined based upon
 * render order" literally). Empirically, that is not the whole mechanism in 3.9.2:
 * every series component (Area/Bar/Line/...) carries a fixed default `zIndex` prop
 * (Area=100, Bar=300, Line=400 — see each component's .d.ts `readonly zIndex`), and
 * recharts renders the SVG as fixed `<g class="recharts-zIndex-layer_<n>">` bands
 * sorted by that value, ACROSS component types. Bare JSX position alone does not
 * decide cross-type order — the (default or explicit) `zIndex` value does.
 *
 * Verdict: A1, taken literally as "bare JSX order alone controls z-order," is FALSE.
 * The real, reliable mechanism recharts 3.9.2 exposes:
 *   1. Cross-type order follows each component's zIndex (Area=100 < Bar=300 < Line=400
 *      by default) regardless of JSX position (test 1).
 *   2. WITHIN a shared zIndex band (same type, or an explicit matching zIndex value),
 *      JSX source order DOES control relative stacking (test 2) — so A1 holds locally,
 *      just not globally across different component types.
 *   3. Arbitrary custom `zIndex` overrides (values outside the standard preset bands)
 *      were observed to silently fail to render the element at all in this spike —
 *      unconfirmed root cause, flagged for plan 33-06 to re-verify before relying on
 *      non-default zIndex values for the 9-layer PayoffChart stack.
 *
 * Plan 33-06 must design the 9-layer z-order around each layer's Recharts component
 * TYPE (which pins its default zIndex band) plus JSX order for same-type layers,
 * rather than assuming raw JSX position alone governs the full stack.
 */

const DATA = [
  { x: 0, a: 1, b: 2, l: 3 },
  { x: 1, a: 2, b: 3, l: 4 },
  { x: 2, a: 3, b: 1, l: 2 },
];

describe("zorder spike: ComposedChart sibling stacking (Assumption A1)", () => {
  it("bare JSX order does NOT control cross-type stacking — default per-type zIndex bands win instead", () => {
    // JSX order: Bar, Area, Line. If A1 (bare JSX order) held globally, DOM order
    // would match JSX order. It does not — default zIndex bands (Area=100, Bar=300,
    // Line=400) win, producing Area -> Bar -> Line regardless of JSX position.
    const { container } = render(
      <ResponsiveContainer width={800} height={400}>
        <ComposedChart data={DATA} width={800} height={400}>
          <Bar dataKey="b" className="mark-bar" isAnimationActive={false} />
          <Area dataKey="a" className="mark-area" isAnimationActive={false} />
          <Line dataKey="l" className="mark-line" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );

    const bar = container.querySelector(".mark-bar");
    const area = container.querySelector(".mark-area");
    const line = container.querySelector(".mark-line");
    expect(bar).not.toBeNull();
    expect(area).not.toBeNull();
    expect(line).not.toBeNull();
    if (bar === null || area === null || line === null) {
      throw new Error("marks not found — recharts DOM structure changed");
    }

    // DOCUMENT_POSITION_FOLLOWING means "the argument comes after the receiver".
    expect(area.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("JSX order DOES control relative stacking within a shared zIndex band (same component type)", () => {
    // Three Area siblings share the same default zIndex (100). JSX order here is
    // deliberately non-alphabetical (a3, a1, a2) to prove it's JSX position, not
    // dataKey or declaration order elsewhere, that determines DOM order.
    const { container } = render(
      <ResponsiveContainer width={800} height={400}>
        <ComposedChart data={DATA} width={800} height={400}>
          <Area dataKey="l" className="area-third" isAnimationActive={false} />
          <Area dataKey="a" className="area-first" isAnimationActive={false} />
          <Area dataKey="b" className="area-second" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );

    const first = container.querySelector(".area-third");
    const second = container.querySelector(".area-first");
    const third = container.querySelector(".area-second");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    if (first === null || second === null || third === null) {
      throw new Error("marks not found — recharts DOM structure changed");
    }

    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
