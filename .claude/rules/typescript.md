---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "!node_modules/**"
---

# TypeScript Strictness

Carried from the previous dashboard (proven) + global standards. Enforced by tsconfig +
ESLint so violations never reach review. Config files are the source of truth — see
`tsconfig.base.json` and `eslint.config.js` once scaffolded; this rule states the policy.

## Requirements

MUST NOT — no exceptions:

- `any` — use proper types, `unknown` + narrowing, or generics.
- `as` type assertions — parse with Zod or write a type guard. (`as const` is fine.)
- `!` non-null assertions — use `assertDefined()` from `packages/shared` or explicit branches.
- IIFEs in JSX — compute values in variables above the `return`.
- Floating promises — every promise awaited or explicitly `void`-ed with reason comment.
- Exceptions for control flow in core — use `Result<T, E>` from `packages/shared`.

MUST:

- **Parse, don't cast** — every external input (HTTP, env, vendor API, job payload)
  goes through Zod before use. Types flow from `z.infer`.
- **Return `Result<T, E>`** for fallible operations in core; adapters map errors to
  transport-appropriate shapes at the edge.
- **Prefer readonly** in domain types: `ReadonlyArray`, `readonly` fields.
- **Gate console** — only `console.warn` / `console.error`.

## Compiler Policy (encoded in tsconfig.base.json)

`strict: true` plus: `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`,
`exactOptionalPropertyTypes`, `useUnknownInCatchVariables`.

## Lint Policy (encoded in eslint.config.js)

`no-explicit-any`, `consistent-type-assertions` (never), `no-non-null-assertion`,
`no-floating-promises`, `switch-exhaustiveness-check`, `strict-boolean-expressions`,
plus boundary rules per [architecture-boundaries.md](architecture-boundaries.md).

## Where to Look

- [docs/architecture/api-design.md](../../docs/architecture/api-design.md) - Result→HTTP error mapping, parse-don't-cast at routes
- [docs/architecture/hexagonal-ddd.md](../../docs/architecture/hexagonal-ddd.md) - Port typing conventions
- `packages/shared/src/` - `Result`, `assertDefined` implementations (once scaffolded)
