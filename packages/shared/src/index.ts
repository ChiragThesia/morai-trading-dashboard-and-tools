// Shared kernel — cross-cutting primitives for @morai/shared.
// Imported by core, contracts, and adapters everywhere downstream.

export type { Ok, Err, Result } from "./result.ts";
export { ok, err, isOk, isErr } from "./result.ts";

export { assertDefined } from "./assert.ts";

export type { OccSymbol, OccSymbolParsed, OccError } from "./occ-symbol.ts";
export { parseOccSymbol, formatOccSymbol } from "./occ-symbol.ts";

export { percentileRank } from "./percentile-rank.ts";
export { isWithinRth } from "./rth-window.ts";
export { isNyseHoliday } from "./nyse-holidays.ts";
