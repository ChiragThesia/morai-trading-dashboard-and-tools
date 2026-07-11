/**
 * ChipRail — the shared native scroll-snap chip rail (Phase 35, RESEARCH Pattern 2 / D-07).
 *
 * Below `lg:` a row of chips scrolls horizontally with per-chip snap and a right-edge peek
 * (`pr-6`, deliberately less than one chip so the next chip visibly peeks). At `lg:` and up
 * the `lg:` triplet reverts the container to today's exact `flex flex-wrap` behavior — a
 * guaranteed revert, not "probably never wraps." Each call site adds `snap-start shrink-0`
 * to its own children; this component owns only the container.
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
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex snap-x snap-mandatory gap-2 overflow-x-auto pr-6 pb-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "lg:flex-wrap lg:overflow-visible lg:snap-none lg:pr-0 lg:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
