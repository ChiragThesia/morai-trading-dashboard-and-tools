/**
 * ChipRail — the shared native scroll-snap chip rail (Phase 35, RESEARCH Pattern 2 / D-07).
 *
 * In a narrow container a row of chips scrolls horizontally with per-chip snap and a
 * right-edge peek (`pr-6`, deliberately less than one chip so the next chip visibly peeks).
 * Once the container is at least `32rem` wide the `@lg:` triplet reverts it to plain
 * `flex flex-wrap` — a guaranteed revert, not "probably never wraps." Each call site adds
 * `snap-start shrink-0` to its own children; this component owns only the container.
 *
 * The threshold is a CONTAINER query, not a viewport one: what decides whether chips can
 * wrap is how much room this rail has, not how big the screen is. A rail in a narrow
 * desktop sidebar scrolls (it could never have fitted wrapped chips), and a rail in a wide
 * landscape-phone panel wraps. That is why this component renders its own `@container`
 * wrapper — an element cannot query itself.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function ChipRail({
  children,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className="@container">
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          "flex snap-x snap-mandatory gap-2 overflow-x-auto pr-6 pb-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "@lg:flex-wrap @lg:overflow-visible @lg:snap-none @lg:pr-0 @lg:pb-0",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
