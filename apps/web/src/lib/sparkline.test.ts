import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sparklinePath } from "./sparkline.ts";

describe("sparklinePath", () => {
  it("returns an empty string for an empty series", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
  });

  it("draws a single point through the vertical middle", () => {
    expect(sparklinePath([5], 100, 20)).toBe("M0.0 10.0");
  });

  it("maps a rising series to a falling y (screen y is inverted)", () => {
    // [0,10] over width 10 / height 20: first point at the bottom (y=20), last at the top (y=0).
    expect(sparklinePath([0, 10], 10, 20)).toBe("M0.0 20.0 L10.0 0.0");
  });

  it("draws a flat line through the middle when all values are equal", () => {
    expect(sparklinePath([3, 3, 3], 10, 20)).toBe("M0.0 10.0 L5.0 10.0 L10.0 10.0");
  });

  it("keeps every emitted point within the box (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), {
          minLength: 2,
          maxLength: 200,
        }),
        (vals) => {
          const w = 120;
          const h = 28;
          const coords = sparklinePath(vals, w, h).match(/-?\d+\.\d+/g) ?? [];
          for (let i = 0; i < coords.length; i += 2) {
            const x = Number(coords[i]);
            const y = Number(coords[i + 1]);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(w + 0.05);
            expect(y).toBeGreaterThanOrEqual(-0.05);
            expect(y).toBeLessThanOrEqual(h + 0.05);
          }
        },
      ),
    );
  });
});
