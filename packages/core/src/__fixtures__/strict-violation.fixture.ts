// FIXTURE — intentionally violates strict-TypeScript lint rules.
// Used ONLY via: bunx eslint --no-ignore packages/core/src/__fixtures__/strict-violation.fixture.ts
// Must trip: no-explicit-any + consistent-type-assertions (never) + no-non-null-assertion
// This file is excluded from normal lint/typecheck runs via eslint ignores + tsconfig exclude.

// Violation 1: no-explicit-any
export function withAny(x: any): any {
  return x;
}

// Violation 2: consistent-type-assertions (assertionStyle: never)
export function withAssertion(x: unknown): string {
  return x as string;
}

// Violation 3: no-non-null-assertion
export function withNonNull(x: string | null): string {
  return x!;
}
