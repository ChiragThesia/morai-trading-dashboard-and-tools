#!/usr/bin/env bash
# Re-syncs apps/web to the claude.ai/design project pinned in config.json.
# Runs the deterministic half: cfg.buildCmd, then the converter driver
# (build -> diff -> validate -> capture) which prints one verdict JSON.
#
# Two things this CANNOT do, because they need the DesignSync tool rather than
# a shell — Claude does them around this script:
#   1. fetch the project's _ds_sync.json into .design-sync/.cache/remote-sync.json
#      (this script picks it up automatically if it is already there)
#   2. upload the result
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .ds-sync ]; then
  echo "✗ .ds-sync/ is missing (gitignored — it does not survive a clone)."
  echo "  Ask Claude to run /design-sync, which re-stages the converter scripts,"
  echo "  or copy them from the design-sync skill's bundle dir and run:"
  echo "    (cd .ds-sync && npm i esbuild ts-morph @types/react playwright)"
  exit 1
fi

# buildCmd lives in config.json so it cannot drift from what the converter uses.
BUILD_CMD=$(node -p 'JSON.parse(require("fs").readFileSync(".design-sync/config.json","utf8")).buildCmd')
echo "▸ $BUILD_CMD"
( eval "$BUILD_CMD" )

REMOTE_ARGS=()
if [ -f .design-sync/.cache/remote-sync.json ]; then
  REMOTE_ARGS=(--remote .design-sync/.cache/remote-sync.json)
else
  echo "! no .design-sync/.cache/remote-sync.json — every component will be re-verified."
fi

# --entry points at a path that deliberately does not exist: apps/web has no
# library build, and a missing entry is what selects synth-entry mode. See NOTES.md.
node .ds-sync/resync.mjs \
  --config .design-sync/config.json \
  --node-modules apps/web/node_modules \
  --entry apps/web/dist/ds-lib.js \
  --out ./ds-bundle \
  "${REMOTE_ARGS[@]}"
