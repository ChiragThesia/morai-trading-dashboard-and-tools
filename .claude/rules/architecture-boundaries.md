---
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "!**/*.test.ts"
---

# Architecture Boundaries

Hexagonal architecture: dependencies point inward, frameworks live in adapters.

## Requirements

Every source file MUST:

1. **Respect the dependency law.** Imports flow `apps → adapters → core → shared` and
   `web → contracts → shared`. Never the reverse. No exceptions.
2. **Keep the hexagon pure.** `packages/core` imports ONLY `packages/shared`. Never:
   hono, drizzle-orm, pg-boss, vendor SDKs, `process.env`, node I/O builtins.
3. **Keep adapters thin.** Routes, MCP tools, and job handlers contain zero business
   logic. Pattern is always: Zod-parse input → call use-case → map Result → respond.
4. **Confine Drizzle** to `packages/adapters/postgres/`. No SQL or ORM types in core
   or routes.
5. **Use fine-grained function-type ports** named `ForVerbingNoun`. Use-cases are
   factories: `makeXxx(deps)` returning the driver port.
6. **Read `process.env` once**, in the composition root (`apps/*/src/main.ts`),
   Zod-parsed. Typed config flows inward.
7. **Cross bounded contexts through application ports** — never import another
   context's `domain/`.
8. **Ship the in-memory twin.** Every driven port change updates its implementation in
   `packages/adapters/memory/` in the same PR.
9. **Keep adapter surfaces in sync.** New use-case ⇒ HTTP route + MCP tool in the same
   PR, unless explicitly scoped otherwise.

MUST NOT:

- Add `eslint-disable` for a boundary rule. If the rule blocks you, the design is
  wrong — fix the design or update the architecture docs first with rationale.
- Touch `packages/core` to perform a technology swap. If a swap requires it, the port
  abstraction failed — fix the port and document why.

## Swap Discipline

Replacing a technology (broker, queue, DB, host):

1. Update `docs/architecture/stack-decisions.md` FIRST (decision, why, swap).
2. Write the new adapter implementing the existing ports.
3. Change wiring in the composition root only.

## Where to Look

- [docs/architecture/hexagonal-ddd.md](../../docs/architecture/hexagonal-ddd.md) - Layers, port naming with examples, bounded contexts, per-context directory shape
- [docs/architecture/monorepo-layout.md](../../docs/architecture/monorepo-layout.md) - Workspace dependency graph, composition roots
- [docs/architecture/stack-decisions.md](../../docs/architecture/stack-decisions.md) - Decision table, swap costs, revisit triggers
- ESLint boundary configuration in `eslint.config.js` - mechanical enforcement (source of truth once scaffolded)
