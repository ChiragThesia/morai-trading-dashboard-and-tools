---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "!node_modules/**"
---

# TypeScript Strictness

Policy carried forward from v1, where it was proven. There is no `tsconfig.base.json` or
`eslint.config.js` in this repo today — both were deleted with the application. When the rebuild
creates them they become the mechanical source of truth and this rule states only the intent.

## Requirements

MUST NOT — no exceptions:

- `any` — use proper types, `unknown` + narrowing, or generics.
- `as` type assertions — parse with Zod or write a type guard. (`as const` is fine.)
- `!` non-null assertions — use an `assertDefined()` helper or explicit branches.
- IIFEs in JSX — compute values in variables above the `return`.
- Floating promises — every promise awaited or explicitly `void`-ed with reason comment.
- Exceptions for control flow in domain code — use a `Result<T, E>` type.

MUST:

- **Parse, don't cast** — every external input (HTTP, env, vendor API, job payload)
  goes through Zod before use. Types flow from `z.infer`.
- **Return `Result<T, E>`** for fallible operations in core; adapters map errors to
  transport-appropriate shapes at the edge.
- **Prefer readonly** in domain types: `ReadonlyArray`, `readonly` fields.
- **Gate console** — only `console.warn` / `console.error`.

## Compiler Policy (to encode in tsconfig)

`strict: true` plus: `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`,
`exactOptionalPropertyTypes`, `useUnknownInCatchVariables`.

## Lint Policy (to encode in the linter config)

`no-explicit-any`, `consistent-type-assertions` (never), `no-non-null-assertion`,
`no-floating-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions`,
plus boundary rules per [architecture-boundaries.md](architecture-boundaries.md).

## Where to Look

- [docs/learnings/LAWS.md](../../docs/learnings/LAWS.md) - the type-safety and boundary-parsing laws, cited by number
- [salvage/platform-patterns.md](../../salvage/platform-patterns.md) - the contract type-link pattern: annotating one adapter function with the contract's response type turns a runtime 500 into a compile error at that line

The scar behind the `?? 0` prohibition: defaulting a vendor's optional field to zero fabricates a
number that is indistinguishable from a real one downstream. It reached production more than once.
