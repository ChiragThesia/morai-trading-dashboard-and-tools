/**
 * usePayoffDateControl.ts — shared forward date-projection state for the payoff graph.
 *
 * The stateful glue Overview owned inline (OVW-05), extracted so Analyzer reuses it verbatim —
 * one source of truth for "how far forward is the T+0 curve projected". Wraps the pure
 * date-projection.ts helpers; `daysForward` is DERIVED from the input value on every render
 * (never stored) so it can never drift out of sync with what the picker shows.
 *
 * `today` and `maxDaysForward` are caller-owned: keep `today` stable (useMemo) and pass
 * `maxDaysForward` from computeProjectionBounds — a calendar can't be projected past front expiry.
 */
import { useCallback, useState } from "react";
import { resolveDaysForward, toDateInputValue } from "../lib/date-projection.ts";

export interface PayoffDateControl {
  readonly dateInputValue: string;
  /** Whole-day calendar offset of the picked date (0 = today) — DISPLAY semantics
   *  (date pill, dialogs). Never feed this to the scenario engine directly. */
  readonly daysForward: number;
  /** What the scenario engine prices: the picked date's CLOSE (TOS date-line parity,
   *  2026-07-20) = daysForward + 1, capped at front expiry. Pricing "today" at now left
   *  the near-flat calendar T+0 curve one theta-day high and pushed its breakevens
   *  ~40pts wide vs TOS (live: ours [7436,7602] vs TOS [7477,7577]; +1 → [7474,7578]). */
  readonly engineDaysForward: number;
  readonly setDate: (value: string) => void;
  readonly stepDate: (delta: number) => void;
  readonly resetDate: () => void;
}

export function usePayoffDateControl(today: Date, maxDaysForward: number): PayoffDateControl {
  const [dateInputValue, setDateInputValue] = useState<string>(() => toDateInputValue(today));

  // Derived, never stored: input string → clamped whole-day offset (0 on empty/malformed).
  const daysForward = resolveDaysForward(dateInputValue, today, maxDaysForward);
  const engineDaysForward = Math.min(daysForward + 1, Math.max(maxDaysForward, 0));

  const setDate = useCallback((value: string): void => {
    setDateInputValue(value);
  }, []);

  const stepDate = useCallback(
    (delta: number): void => {
      setDateInputValue((prev) => {
        const current = resolveDaysForward(prev, today, maxDaysForward);
        const next = Math.max(0, Math.min(current + delta, maxDaysForward));
        const nextDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + next);
        return toDateInputValue(nextDate);
      });
    },
    [today, maxDaysForward],
  );

  const resetDate = useCallback((): void => {
    setDateInputValue(toDateInputValue(today));
  }, [today]);

  return { dateInputValue, daysForward, engineDaysForward, setDate, stepDate, resetDate };
}
