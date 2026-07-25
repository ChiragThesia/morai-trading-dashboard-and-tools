/**
 * Fails the build if a retired pre-token utility name reappears in src/.
 *
 *   bun run tokens:lint
 *
 * Why this exists: Tailwind silently emits nothing for a class it does not know.
 * A stray `text-dim` does not error, it just renders with no colour — invisible
 * until someone sees black-on-black in prod. The names below were deleted when
 * the semantic vocabulary landed; this is what keeps them deleted.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Retired name -> the semantic name that replaced it. */
const RETIRED = {
  bg: 'surface-base',
  panel: 'surface-raised',
  panel2: 'surface-sunken',
  raise: 'surface-overlay',
  line: 'line-subtle',
  line2: 'line-strong',
  txt: 'fg-primary',
  dim: 'fg-tertiary',
  up: 'value-positive',
  down: 'value-negative',
  downd: 'value-negative-surface',
  violet: 'accent-primary',
  violetd: 'accent-primary-surface',
  amber: 'accent-warning',
  blue: 'accent-info',
  cyan: 'accent-highlight',
};

// Same shape as the migration codemod: anchor on a utility prefix, longest name
// first, and refuse to match when either side continues into a word or hyphen —
// otherwise `eslint-disable-next-line` and `gamma-flip-line` are false positives.
const NAMES = Object.keys(RETIRED).sort((a, b) => b.length - a.length).join('|');
const PREFIXES = 'bg|text|border|ring|fill|stroke|from|to|via|divide|outline';
const RE = new RegExp(`(?<![\\w-])(${PREFIXES})-(${NAMES})(?![\\w-])`, 'g');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

const findings = [];
for (const file of walk(SRC)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      findings.push(`  ${relative(SRC, file)}:${i + 1}  ${m[0]} -> ${m[1]}-${RETIRED[m[2]]}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`✗ ${findings.length} retired token name(s) — use the semantic name:\n`);
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`✓ no retired token names (${Object.keys(RETIRED).length} guarded)`);
