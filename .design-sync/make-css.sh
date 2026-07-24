#!/usr/bin/env bash
# Assembles the stylesheet design-sync ships as cfg.cssEntry.
#
# apps/web is an app, not a library: its only stylesheet is the Tailwind SOURCE
# (src/index.css, full of @import "tailwindcss" / @theme). Designs need the
# COMPILED output, so this takes vite's build artifact and adds the two things
# the app gets from index.html rather than from CSS:
#
#   1. the Google Fonts @import (index.html ships a <link>; must be the FIRST
#      rule in the file or the browser drops it)
#   2. the body surface, restated at `html body` specificity — the design-sync
#      preview harness injects `body{background:#fff}` AFTER the stylesheet
#      link, and a plain `body{}` rule loses to it. Morai is dark-only.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

{
  echo "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');"
  cat dist/assets/index-*.css
  cat <<'CSS'

/* design-sync — restated from src/index.css body{} at html-body specificity. */
html body {
  background: radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10, 14, 20, 0) 58%), #0a0e14;
  color: #d6dbe4;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
CSS
} > dist/ds-styles.css
