import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingChain, RawChain, FetchError } from "@morai/core";

/**
 * makeMemorySidecarChainAdapter — in-memory twin of the sidecar chain adapter.
 *
 * Implements ForFetchingChain using a plain Map keyed by root ("SPX" | "SPXW").
 * Exposes `seed(root, chain)` for test setup.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8). The sidecar adapter implements
 * the same ForFetchingChain port as the CBOE adapter — this twin mirrors that shape.
 */
export type MemorySidecarChainAdapter = {
  readonly fetchChain: ForFetchingChain;
  readonly seed: (root: "SPX" | "SPXW", chain: RawChain) => Promise<void>;
};

export function makeMemorySidecarChainAdapter(): MemorySidecarChainAdapter {
  // Backing store: root → RawChain
  const store = new Map<string, RawChain>();

  const fetchChain: ForFetchingChain = async (
    root: "SPX" | "SPXW",
  ): Promise<Result<RawChain, FetchError>> => {
    const chain = store.get(root);
    if (chain === undefined) {
      return err<FetchError>({
        kind: "fetch-error",
        message: `Root not seeded: ${root}`,
      });
    }
    return ok(chain);
  };

  const seed = async (root: "SPX" | "SPXW", chain: RawChain): Promise<void> => {
    store.set(root, chain);
  };

  return { fetchChain, seed };
}
