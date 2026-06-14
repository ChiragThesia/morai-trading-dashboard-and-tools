import { err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForRegisteringCalendar,
  Calendar,
  StorageError,
} from "./ports.ts";

// Domain error for input validation at the use-case layer (not a storage failure).
export type ValidationError = {
  readonly kind: "validation-error";
  readonly message: string;
};

// Deps injected at the composition root.
export type RegisterCalendarDeps = {
  readonly persistCalendar: ForRegisteringCalendar;
  readonly now: () => Date;
};

// Driver port — the function callers use (HTTP route, MCP tool).
export type ForRunningRegisterCalendar = (input: {
  readonly underlying: string;
  readonly strike: number;
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
  readonly qty: number;
  readonly openNetDebit: number;
  readonly openedAt?: Date;
  readonly notes?: string;
}) => Promise<Result<Calendar, StorageError | ValidationError>>;

/**
 * makeRegisterCalendarUseCase — register a new calendar spread.
 *
 * Domain rule: backExpiry must be strictly after frontExpiry.
 * ISO date strings compare lexicographically: "2026-03-21" > "2026-02-21".
 * openedAt defaults to deps.now() when omitted.
 */
export function makeRegisterCalendarUseCase(
  deps: RegisterCalendarDeps,
): ForRunningRegisterCalendar {
  return async (input) => {
    // Domain rule: back leg must expire after front leg (same-month not allowed).
    if (input.backExpiry <= input.frontExpiry) {
      return err<ValidationError>({
        kind: "validation-error",
        message: "backExpiry must be after frontExpiry",
      });
    }
    // exactOptionalPropertyTypes: omit notes entirely when undefined rather than
    // passing undefined as a value (ForRegisteringCalendar.notes is optional: string)
    const payload: Parameters<ForRegisteringCalendar>[0] = {
      underlying: input.underlying,
      strike: input.strike,
      optionType: input.optionType,
      frontExpiry: input.frontExpiry,
      backExpiry: input.backExpiry,
      qty: input.qty,
      openNetDebit: input.openNetDebit,
      openedAt: input.openedAt ?? deps.now(),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    return deps.persistCalendar(payload);
  };
}
