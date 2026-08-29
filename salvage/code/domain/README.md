# domain/ — salvaged pure algorithms

Four files, copied byte-identical from `packages/core/src/journal/domain/` before deletion.

| File | Why it is here |
|---|---|
| `iv-inversion.ts` | Newton-Raphson IV solve with a bisection fallback. `VEGA_THRESHOLD = 1e-8` is the trigger; vega collapses toward zero for deep ITM/OTM and short DTE, and the fallback is what keeps the solve alive there. |
| `fill-pairing.ts` | Four disambiguation rules bought with a five-round bug chain that displayed a +$395 trade as −$319,850. See `../../oracle-fixtures.md` for the 13 ground-truth calendars any reimplementation must pass. |
| `calendar-event.ts` | Pure types, zero imports. `fill-pairing.ts` depends on it. Carries decided conventions that are not obvious from the type names: the `netAmount` sign rule (D-08), the ROLL split semantics (D-03 / WR-A1), and when `realizedPnl` is populated (D-09). |
| `bsm.ts` | **A dead re-export shim**, 5 lines, left behind by commit `1baceaa`. It exists here only so `iv-inversion.ts`'s import resolves. Do not port it — inline the import to the real kernel in `../quant/` instead. |

`fill-pairing.ts` and `iv-inversion.ts` also import `@morai/shared`, which is salvaged at `../shared/`.
