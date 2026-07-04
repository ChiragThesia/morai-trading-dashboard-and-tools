import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ChainQuoteForPicker, ForReadingChainForPicker, StorageError } from "@morai/core";

/**
 * makeMemoryPickerChainRepo — in-memory twin of the Postgres picker-chain adapter.
 *
 * Read-only port (no write path to cross-check) — simply returns a supplied
 * ChainQuoteForPicker[] seed, mirroring the Postgres read shape (latest cohort, puts only).
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryPickerChainRepo = {
  readonly readChainForPicker: ForReadingChainForPicker;
};

export function makeMemoryPickerChainRepo(
  seed: ReadonlyArray<ChainQuoteForPicker> = [],
): MemoryPickerChainRepo {
  const readChainForPicker: ForReadingChainForPicker = async (): Promise<
    Result<ReadonlyArray<ChainQuoteForPicker>, StorageError>
  > => {
    return ok(seed);
  };

  return { readChainForPicker };
}
