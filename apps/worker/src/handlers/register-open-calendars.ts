/**
 * register-open-calendars handler — on-demand auto-registration job (JRNL-02).
 *
 * Fetches the current open Schwab position book, pairs it into calendar spreads, and
 * registers any spread not already in the calendars table (see
 * packages/core/.../registerOpenCalendars.ts for the full pairing/dedup/openedAt rationale).
 *
 * Gate:
 *   - NO RTH gate — on-demand job, runs anytime when triggered
 *   - Payload: {} — no calendarId (mirrors wipe-derived-fills' account-wide payload; this
 *     job operates over the whole open position book, not a single calendar)
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRunningRegisterOpenCalendars } from "@morai/core";

export const registerOpenCalendarsPayload = z.object({}).passthrough();

export type RegisterOpenCalendarsHandlerDeps = {
  readonly registerOpenCalendarsUseCase: ForRunningRegisterOpenCalendars;
  readonly now: () => Date;
};

export function makeRegisterOpenCalendarsHandler(
  deps: RegisterOpenCalendarsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — on-demand job, runs anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = registerOpenCalendarsPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(
        `register-open-calendars: invalid payload: ${payloadResult.error.message}`,
      );
    }

    const result = await deps.registerOpenCalendarsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}
