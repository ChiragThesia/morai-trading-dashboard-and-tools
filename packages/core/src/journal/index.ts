// Journal bounded context — public surface.
// Exports ports (driven) and use-case factories (driver ports) for the journal context.

export type {
  ForGettingOpenCalendars,
  ForPingingDb,
  StorageError,
  Calendar,
  FetchError,
  RawChain,
  RawQuote,
  ForFetchingChain,
  ObservationRow,
  ContractRow,
  ForPersistingObservations,
  ForUpsertingContracts,
  RateObservation,
  ForFetchingRate,
  ForPersistingRate,
  ForReadingRate,
  PendingObs,
  ForReadingPendingObs,
  ForWritingBsmResults,
} from "./application/ports.ts";
export type { ForGettingStatus, StatusPayload, StatusError } from "./application/getStatus.ts";
export { makeGetStatusUseCase } from "./application/getStatus.ts";
export { makeFetchChainUseCase } from "./application/fetchChain.ts";
export { makeFetchRateUseCase } from "./application/fetchRate.ts";
export { makeComputeBsmGreeksUseCase } from "./application/computeBsmGreeks.ts";
// Domain re-exports (Plan 02/03/06) — BSM engine and IV inversion
export { bsmPrice, bsmGreeks, bsmVega } from "./domain/bsm.ts";
export type { BsmGreeks } from "./domain/bsm.ts";
export { invertIv } from "./domain/iv-inversion.ts";
export type { IvError } from "./domain/iv-inversion.ts";
export { computeT, isThirdFriday } from "./domain/dte.ts";
