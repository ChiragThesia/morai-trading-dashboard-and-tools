/**
 * Forward-vol identity (JRNL-01, D-02/D-07) — never-NaN inverted-structure guard.
 *
 * Duplicated from `packages/core/src/picker/domain/fwd-iv.ts` (architecture-boundaries.md rule 7
 * forbids importing another bounded context's domain/ directly; this formula is five lines of
 * dependency-free pure math, so duplication is the surgical choice for this phase — see
 * 22-RESEARCH.md "Alternatives Considered" for the cross-package-refactor alternative). Given
 * a snapshot's front/back term-structure point (DTE + IV), computes the forward vol implied
 * between them — D-02's "the real edge, NOT the front-minus-back spread."
 *
 * Guard (22-CONTEXT.md D-07; must_haves truths): the radicand is negative only when the term
 * structure is inverted (front IV rich relative to back IV for their respective DTEs). A
 * radicand of exactly zero is a valid degenerate "ok" result (forwardVol = 0), not an inverted
 * one — the guard only rejects radicand < 0. Unlike the picker copy (which takes pre-parsed
 * numbers), journal's raw SnapshotRow fields are Drizzle-numeric strings (possibly the literal
 * "NaN"), so this wrapper additionally guards non-finite input IV and dteBack === dteFront
 * (division by zero) as the same non-computable "inverted" case.
 *
 * Pure domain: no I/O.
 */

/** Result of computeForwardVol — literal-tagged union (never a bare NaN). */
export type ForwardVolResult =
  | { readonly forwardVol: number; readonly guard: "ok" }
  | { readonly forwardVol: null; readonly guard: "inverted" };

/**
 * Compute the forward vol between a snapshot's front and back term-structure point.
 *
 * @param row.dteFront - Front leg DTE (integer calendar days)
 * @param row.dteBack  - Back leg DTE (integer calendar days), normally > dteFront
 * @param row.frontIv  - Front leg IV, Drizzle-numeric string (decimal), may be the literal "NaN"
 * @param row.backIv   - Back leg IV, Drizzle-numeric string (decimal), may be the literal "NaN"
 * @returns { forwardVol, guard: "ok" } when computable and radicand >= 0, else
 *          { forwardVol: null, guard: "inverted" }
 */
export function computeForwardVol(row: {
  readonly dteFront: number;
  readonly dteBack: number;
  readonly frontIv: string;
  readonly backIv: string;
}): ForwardVolResult {
  const tf = row.dteFront;
  const tb = row.dteBack;
  const ivf = parseFloat(row.frontIv);
  const ivb = parseFloat(row.backIv);

  if (!Number.isFinite(ivf) || !Number.isFinite(ivb) || tb === tf) {
    return { forwardVol: null, guard: "inverted" };
  }

  const rad = (tb * ivb * ivb - tf * ivf * ivf) / (tb - tf);
  if (rad < 0) {
    return { forwardVol: null, guard: "inverted" };
  }
  return { forwardVol: Math.sqrt(rad), guard: "ok" };
}
