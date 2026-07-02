# Over-engineering cleanup (ponytail-audit 2026-06-22)

Scope: dead code + redundant deps only. Architecture (ports/adapters/contract-tests/
Result/memory-doubles) is mandated by CLAUDE.md — out of scope, not touched.
Not blocking go-live. Net: -152 src lines, -2 root deps, -42 junk files.

- [ ] **delete** `makeMemorySchwabTrader` in-memory twin — 150 lines, zero consumers
  (no test, no contract test, no app; only its own barrel re-export). Delete file +
  remove 2 barrel lines.
  - `packages/adapters/src/memory/schwab-trader.ts` (whole file)
  - `packages/adapters/src/index.ts:106-107`
- [ ] **yagni** root `package.json` `dependencies` { oauth-callback, open } — only
  `apps/auth` uses them, and it declares them itself. Drop the whole root `dependencies`
  block.
  - `package.json:26-29`
- [ ] **delete** 42 untracked `* 2.*` copy-junk files in gitignored `dist/` (macOS
  duplicates; pollute find/rg). Cosmetic.
  - `find . -name '* 2.*' -path '*/dist/*' -delete`

Verify after: `bun run typecheck && bun run test && bun run lint`.

Clean (no findings): shared/, all other make* factories have callers, deps lean,
__fixtures__ are deliberate eslint probes, getOrders fully wired.
