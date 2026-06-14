import type { ForClosingCalendar } from "./ports.ts";

// Deps injected at the composition root.
export type CloseCalendarDeps = {
  readonly closeCalendar: ForClosingCalendar;
};

/**
 * makeCloseCalendarUseCase — close an open calendar spread.
 *
 * Thin use-case: forwards (id, closeNetCredit) to the repo port.
 * not-found and already-closed errors originate in the repo and pass through unchanged.
 */
export function makeCloseCalendarUseCase(
  deps: CloseCalendarDeps,
): ForClosingCalendar {
  return (id, closeNetCredit) => deps.closeCalendar(id, closeNetCredit);
}
