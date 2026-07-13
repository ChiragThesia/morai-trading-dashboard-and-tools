// makeStartReauth — thin passthrough use-case wrapping ForStartingReauth (Pattern 4: even a
// passthrough capability gets a core use-case, mirroring makeEnqueueJobUseCase).

import type { Result } from "@morai/shared";
import type { ForStartingReauth, ReauthApp, ReauthError } from "./ports.ts";

export type StartReauthDeps = {
  readonly startReauth: ForStartingReauth;
};

export function makeStartReauth(
  deps: StartReauthDeps,
): (app: ReauthApp) => Promise<Result<{ readonly authUrl: string }, ReauthError>> {
  return (app: ReauthApp) => deps.startReauth(app);
}
