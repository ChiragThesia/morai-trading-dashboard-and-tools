import { QueryClient } from "@tanstack/react-query";

// QueryClient singleton — shared across all components via QueryClientProvider.
// RESEARCH Pattern 4: retry: 3, exponential retryDelay capped at 30s,
// refetchOnWindowFocus: true, staleTime: 20_000ms.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
      refetchOnWindowFocus: true,
      staleTime: 20_000,
    },
  },
});
