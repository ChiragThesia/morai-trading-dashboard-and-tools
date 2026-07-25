/**
 * retryWithBackoff — retry a thunk that may only be failing *for now*.
 *
 * Written for boot I/O against the database. On 2026-07-23 Supabase was unreachable for
 * 81 minutes and both services died on their first unguarded `await` (the boot migration
 * and `boss.start()`), then restart-looped straight back into the same dead connection.
 *
 * The contract is deliberately narrow: this retries, it does not classify. Callers decide
 * what deserves retrying. Boot connection setup does; a job handler's business failure
 * does not — pg-boss already owns that retry.
 *
 * Exhausting the attempts rethrows the LAST error, so the caller reports the reason the
 * final attempt failed rather than a stale first cause.
 */

export type RetryOptions = {
  /** Total attempts including the first. `1` disables retrying. */
  readonly attempts: number;
  /** Delay before the second attempt; doubles each time after. */
  readonly baseDelayMs: number;
  /** Ceiling for the doubling, so a long outage settles into a steady poll. */
  readonly maxDelayMs?: number;
  /** Injected so tests assert the delay schedule without waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called once per FAILED attempt — this is what produces the operator log line. */
  readonly onRetry?: (attempt: number, error: unknown) => void;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs, onRetry } = options;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onRetry?.(attempt, error);

      // No sleep after the final attempt — the caller is about to see the throw.
      if (attempt < attempts) {
        const delay = Math.min(
          baseDelayMs * 2 ** (attempt - 1),
          maxDelayMs ?? Number.POSITIVE_INFINITY,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
