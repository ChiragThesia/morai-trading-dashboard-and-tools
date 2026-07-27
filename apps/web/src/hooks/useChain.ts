import { useQuery } from "@tanstack/react-query";
import { chainResponse } from "../lib/chain-contract.ts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useGex/useStatus pattern (no 3× backoff hang).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useChain — polls GET /api/chain every 30s.
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header).
 * - Parses the body through `chainResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable).
 *
 * ASSUMPTION (Unit 11 ← Unit 04): the route is `GET /api/chain` and takes no
 * query parameters — the whole visible chain comes back and the client picks its
 * own front/back expiries. If Unit 04 shipped required params, only this path
 * string changes.
 */
export function useChain() {
  return useQuery({
    queryKey: ["chain"],
    queryFn: async () => {
      const res = await apiFetch("/api/chain");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/chain failed: ${res.status}`);
      }

      return chainResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}
