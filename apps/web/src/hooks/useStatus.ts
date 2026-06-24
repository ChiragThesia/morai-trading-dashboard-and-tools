import { useQuery } from "@tanstack/react-query";
import { statusResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — carries `.status` so the QueryClient retry predicate
// can short-circuit the default 3-retry backoff (Pitfall 7: 3-retry hang on 401).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useStatus — polls GET /api/status every 30s.
 *
 * - Uses `apiFetch` from rpc.ts which sends the Bearer token header.
 * - Parses the response body through `statusResponse.parse()` — no `as` cast (parse-don't-cast).
 * - Throws `UnauthorizedError` (status=401) on a 401 response so the retry predicate
 *   short-circuits and the 401 interceptor in the App can act immediately.
 * - The QueryClient default retry: 3 applies to all OTHER errors.
 */
export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: async () => {
      const res = await apiFetch("/api/status");

      // 401 → non-retryable (Pitfall 7: no 3× backoff hang on auth errors)
      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/status failed: ${res.status}`);
      }

      // Parse-don't-cast: statusResponse.parse() from @morai/contracts validates the shape.
      // If the server ever changes the shape, this will throw at runtime, not silently corrupt state.
      return statusResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    // Short-circuit the retry on 401 — auth errors will never succeed after 3 retries
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}
