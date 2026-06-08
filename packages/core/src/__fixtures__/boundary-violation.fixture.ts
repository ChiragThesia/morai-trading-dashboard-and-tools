// FIXTURE — intentionally violates hexagon boundary law.
// Used ONLY via: bunx eslint --no-ignore packages/core/src/__fixtures__/boundary-violation.fixture.ts
// Must trip: boundaries/element-types (monorepo violation) + no-restricted-imports (vendor violation)
// This file is excluded from normal lint/typecheck runs via eslint ignores + tsconfig exclude.

// Violation 1: vendor import forbidden in core (no-restricted-imports)
import type { Hono } from "hono";

// Violation 2: element-type import forbidden in core (boundaries/dependencies: core allow=[shared] only)
// Use a relative path so the boundaries plugin can classify the dependency
// without needing to resolve the @morai/* workspace package name.
// Path: packages/core/src/__fixtures__/ → 3 dirs up → packages/ → adapters/src/index.ts
import type {} from "../../../adapters/src/index.ts";

// Suppress unused-variable noise — the violations above are what matters.
export type { Hono };
