import type { ForListingCalendars } from "./ports.ts";

// Deps injected at the composition root.
export type ListCalendarsDeps = {
  readonly listCalendars: ForListingCalendars;
};

/**
 * makeListCalendarsUseCase — list calendars, optionally filtered by status.
 *
 * Thin use-case: no domain logic beyond forwarding the filter.
 * Ordering (openedAt desc) is enforced by the repository implementation.
 */
export function makeListCalendarsUseCase(
  deps: ListCalendarsDeps,
): ForListingCalendars {
  return (filter) => deps.listCalendars(filter);
}
