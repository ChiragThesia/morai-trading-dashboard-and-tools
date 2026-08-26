#!/usr/bin/env bash
#
# Tier 1 cleanup — regenerable and ignored output only.
#
# Every path below was verified on 2026-08-26 to have ZERO git-tracked files inside it.
# Nothing here is prose, source, or configuration. Everything is rebuilt by a command
# that exists on this machine.
#
# Reclaims ~795 MiB. Repo goes from 880 MiB to roughly 85 MiB.
#
# Tiers 2 and 3 are already done (git removals, untracking, moves). This is the last step.
#
# Run:  bash cleanup-tier1.sh
#
set -u

cd /Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools || exit 1

echo "Before: $(du -sh . | cut -f1)"
echo

# ----------------------------------------------------------------------------
# 1. The last worktree remnants — 5.7 MiB
#
#    The 11 registered worktrees were already removed with `git worktree remove`
#    on 2026-08-25. What is left is 4 orphan directories:
#      - agent-a10abbc64b69262e5   0 bytes, empty skeleton, no .git
#      - agent-ad23c63bf56efce5a   0 bytes, empty skeleton, no .git
#      - agent-aae27803b9e3b5346   2.9 MiB, unregistered, 0 commits ahead of main
#      - agent-af3fc5c2b2ea1dc10   2.8 MiB, unregistered, 0 commits ahead of main
#
#    Their two branches were deleted after confirming 0 unique commits. All 13
#    original branch tips remain in morai-all-refs.bundle.
# ----------------------------------------------------------------------------
rm -rf .claude/worktrees

# ----------------------------------------------------------------------------
# 2. node_modules — ~665 MiB. Restore with: bun install
# ----------------------------------------------------------------------------
rm -rf node_modules
rm -rf apps/web/node_modules apps/server/node_modules apps/worker/node_modules
rm -rf packages/core/node_modules packages/adapters/node_modules \
       packages/contracts/node_modules packages/shared/node_modules \
       packages/quant/node_modules
rm -rf .ds-sync/node_modules

# ----------------------------------------------------------------------------
# 3. Python — 95 MiB venv + bytecode + pytest cache
#    Restore with: cd apps/sidecar && python3 -m venv .venv && pip install -r requirements.txt
# ----------------------------------------------------------------------------
rm -rf apps/sidecar/.venv
find apps/sidecar -type d -name __pycache__ -not -path "*/.venv/*" -print0 | xargs -0 rm -rf
rm -rf apps/sidecar/.pytest_cache

# ----------------------------------------------------------------------------
# 4. TypeScript declaration output — 2.5 MiB, all emitDeclarationOnly.
#    Restore with: bun run typecheck  (or tsc --build)
# ----------------------------------------------------------------------------
rm -rf packages/adapters/dist packages/contracts/dist packages/core/dist \
       packages/quant/dist packages/shared/dist apps/server/dist apps/worker/dist

# ----------------------------------------------------------------------------
# 5. Vite build output — 1.3 MiB. Restore with: bun run build
# ----------------------------------------------------------------------------
rm -rf apps/web/dist

# ----------------------------------------------------------------------------
# 6. graphify-out — 9.2 MiB.
#    graph.json and graph.html here are byte-identical (md5-verified) to the
#    copies in .planning/graphs/, which stay on disk. This is a duplicate.
# ----------------------------------------------------------------------------
rm -rf graphify-out

# ----------------------------------------------------------------------------
# 7. Empty iCloud collision directories.
#    Each was confirmed to contain 0 files on 2026-08-26.
#    "ds-bundle/components 2" is deliberately NOT here — it waits on Tier 4 Q1.
# ----------------------------------------------------------------------------
rm -rf "packages/adapters/src/schwab/auth 2" \
       "packages/adapters/src/schwab/market 2" \
       "packages/adapters/src/schwab/trader 2" \
       "packages/adapters/src/test/fixtures 2" \
       "packages/core/src/analytics/application 2" \
       "packages/core/src/analytics/domain 2" \
       "packages/core/src/brokerage/application 2" \
       "packages/core/src/brokerage/domain 2" \
       "plans/morai-status 2"

# ----------------------------------------------------------------------------
# 8. codegraph index — 33 MiB. LAST, because this takes the codegraph MCP
#    server offline until it re-indexes. Restore with: codegraph index
# ----------------------------------------------------------------------------
rm -rf .codegraph

echo
echo "After:  $(du -sh . | cut -f1)"
echo
echo "Sanity checks:"
echo -n "  tracked files intact: "; git ls-files | wc -l | tr -d ' '
echo -n "  git status clean-ish: "; git status --porcelain | wc -l | tr -d ' '; echo "    (expect ~35 staged/modified from Tiers 2-3)"
echo
echo "To restore the dev environment:  bun install"
