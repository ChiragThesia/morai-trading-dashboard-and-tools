// Shared kernel — cross-cutting primitives.
// Real implementations land in plan 02 (FND-04).

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export function assertDefined<T>(
  val: T | undefined | null,
  msg: string,
): asserts val is T {
  if (val === undefined || val === null) {
    throw new Error(`assertDefined: ${msg}`);
  }
}
