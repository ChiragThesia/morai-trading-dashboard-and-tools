import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPingingDb } from "./ports.ts";

// Core-internal payload type whose fields line up with the statusResponse contract.
// Core must NOT import @morai/contracts — adapters (plan 05) parse this through
// statusResponse.parse() at the boundary.
export type StatusPayload = {
  readonly db: "ok" | "down";
  readonly tokenFreshness: "none yet";
  readonly lastJobRuns: "none yet";
  readonly version: string;
  readonly uptime: number;
};

// use-case never fails — it absorbs DB errors and represents them as db:"down"
export type StatusError = never;

// Driver port — the get_status use-case interface (ForVerbingNoun convention)
export type ForGettingStatus = () => Promise<Result<StatusPayload, StatusError>>;

// Factory — makeXxx(deps) → driver port (hexagonal-ddd.md factory convention)
export function makeGetStatusUseCase(deps: {
  readonly pingDb: ForPingingDb;
  readonly version: string;
  readonly startedAt: Date;
}): ForGettingStatus {
  return async () => {
    // T-01-06: map DB errors (Result.err OR thrown exception) to db:"down" — never throws
    let dbStatus: "ok" | "down";
    try {
      const pingResult = await deps.pingDb();
      dbStatus = pingResult.ok ? "ok" : "down";
    } catch {
      dbStatus = "down";
    }

    const uptimeSeconds = (Date.now() - deps.startedAt.getTime()) / 1000;

    const payload: StatusPayload = {
      db: dbStatus,
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: deps.version,
      uptime: uptimeSeconds,
    };

    return ok(payload);
  };
}
