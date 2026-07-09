/**
 * bootstrap-ci — seeded bootstrap confidence interval (BT-04). RED stub — see
 * bootstrap-ci.test.ts for the behavior contract.
 */

export type BootstrapCiResult = {
  readonly low: number;
  readonly high: number;
  readonly n: number;
};

export function bootstrapCi(
  _samples: ReadonlyArray<number>,
  _seed: number,
  _iterations = 2000,
  _confidence = 0.9,
): BootstrapCiResult {
  throw new Error("not implemented");
}
