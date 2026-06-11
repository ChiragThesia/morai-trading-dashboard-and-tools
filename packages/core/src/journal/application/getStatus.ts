import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPingingDb, ForReadingJobRuns, JobRunMap } from "./ports.ts";

// Core-internal payload type whose fields line up with the statusResponse contract.
// Core must NOT import @morai/contracts — adapters (plan 05) parse this through
// statusResponse.parse() at the boundary.
export type StatusPayload = {
  readonly db: "ok" | "down";
  readonly tokenFreshness: "none yet";
  // "none yet" when no job has run yet (first deploy / pgboss schema absent).
  // JobRunMap when at least one job has run (D-10).
  readonly lastJobRuns: "none yet" | JobRunMap;
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
  readonly readJobRuns: ForReadingJobRuns;
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

    // D-10: read per-job last-run status.
    // Fall back to "none yet" when:
    //   - result is an error (pgboss schema not yet created)
    //   - the map is empty (first deploy, no jobs have run yet — Pitfall 6)
    // Never throw on this path.
    let lastJobRuns: "none yet" | JobRunMap;
    try {
      const jobRunsResult = await deps.readJobRuns();
      if (!jobRunsResult.ok) {
        lastJobRuns = "none yet";
      } else {
        const map = jobRunsResult.value;
        lastJobRuns = Object.keys(map).length === 0 ? "none yet" : map;
      }
    } catch {
      lastJobRuns = "none yet";
    }

    const uptimeSeconds = (Date.now() - deps.startedAt.getTime()) / 1000;

    const payload: StatusPayload = {
      db: dbStatus,
      tokenFreshness: "none yet",
      lastJobRuns,
      version: deps.version,
      uptime: uptimeSeconds,
    };

    return ok(payload);
  };
}
