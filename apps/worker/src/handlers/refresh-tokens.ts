/**
 * refresh-tokens handler — refreshes both Schwab apps at 04:00 ET daily (JOB-02).
 *
 * SIGNATURE ONLY — handler body throws "not implemented".
 * Plan 05-05 provides the implementation.
 *
 * Gate:
 *   - NO RTH gate — runs at 04:00 ET outside market hours by design (D-13, Pitfall 5)
 *   - NO holiday gate — token refresh runs every day regardless of market calendar
 */

import type { Job } from "pg-boss";
import type { RefreshTokensResult } from "@morai/core";
import type { Result } from "@morai/shared";

export type RefreshTokensHandlerDeps = {
  readonly refreshTokensUseCase: () => Promise<Result<RefreshTokensResult, never>>;
  readonly now: () => Date;
};

export function makeRefreshTokensHandler(
  deps: RefreshTokensHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — runs at 04:00 ET outside market hours by design (D-13, Pitfall 5)

    throw new Error("not implemented");
  };
}
