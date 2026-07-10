import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * jsdom has no real layout engine — recharts' `ResponsiveContainer` measures its
 * parent via `getBoundingClientRect`/`ResizeObserver` and resolves to 0x0 under jsdom,
 * so charts render nothing under test (recharts#2268, #2166). Call this once at the
 * top of a chart test file, before importing the chart component under test, to
 * render children inside a fixed 800x400 box instead.
 *
 * ponytail: `vi.mock` here is nested inside a function (Vitest 4.1.8 still hoists and
 * executes it correctly, verified empirically) but Vitest warns this will become an
 * error in a future version. If that lands, replace the call site with a bare
 * `import "./recharts-test-utils"` side-effect import and move this vi.mock call to
 * this module's top level.
 */
export function mockResponsiveContainer(): void {
  vi.mock("recharts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("recharts")>();
    return {
      ...actual,
      ResponsiveContainer: ({ children }: { children: ReactNode }): ReactNode => (
        <div style={{ width: 800, height: 400 }}>{children}</div>
      ),
    };
  });
}
