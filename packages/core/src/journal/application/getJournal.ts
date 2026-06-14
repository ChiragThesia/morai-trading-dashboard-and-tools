import type { ForReadingJournal } from "./ports.ts";

// Driver port — the get_journal use-case interface.
// Re-uses ForReadingJournal directly: the use-case is a thin forwarder.
export type ForRunningGetJournal = ForReadingJournal;

export type GetJournalDeps = {
  readonly readJournal: ForReadingJournal;
};

/**
 * makeGetJournalUseCase — factory returning the ForRunningGetJournal driver port.
 *
 * Thin forwarder: passes calendarId to ForReadingJournal and returns its Result.
 *   - ok(null)     → unknown calendarId (drives 404 at route layer)
 *   - ok([])       → known calendar with zero snapshots
 *   - ok([...rows]) → ordered snapshot series
 *   - err(StorageError) → propagated from the port
 *
 * No business logic here — just dependency injection of the driven port.
 * Architecture law (hexagonal-ddd.md): use-case factory; all DB access in adapters.
 */
export function makeGetJournalUseCase(deps: GetJournalDeps): ForRunningGetJournal {
  return (calendarId) => deps.readJournal(calendarId);
}
