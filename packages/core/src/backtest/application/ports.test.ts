/**
 * ports.test.ts (Phase 27, Plan 06, Task 3) — the BT-05 no-write-path structural guard.
 *
 * Proves the harness's hard boundary as an executable test, not just a doc comment: nothing
 * anywhere in packages/core/src/backtest/ can write a rule weight or a rule registry, and the
 * ONLY write capability is the append-only backtest_runs port (ForPersistingBacktestRun).
 *
 * Mirrors packages/core/src/exits/application/computeExitAdvice.test.ts's EXIT-10
 * never-execute guard (a static import.meta.glob source scan — the same
 * refuted-criteria-registry-guard style rules.test.ts already established for this codebase).
 * node:fs is architecture-boundaries-forbidden in packages/core, including test files (no
 * carve-out) — import.meta.glob is Vite's own static-import mechanism (vitest runs on Vite),
 * inlining file contents at collection time with no node I/O builtin involved.
 */

import { describe, it, expect } from "vitest";

// Minimal local ambient shape for Vite's `import.meta.glob`, narrower than pulling in the
// full `vite/client` triple-slash reference (unresolvable from packages/core's isolated
// tsconfig/typeRoots, and would drag in unrelated DOM lib globals). Mirrors
// computeExitAdvice.test.ts's EXIT-10 guard verbatim.
declare global {
  interface ImportMeta {
    glob: (
      pattern: string | ReadonlyArray<string>,
      options: { readonly query: string; readonly import: string; readonly eager: true },
    ) => Record<string, unknown>;
  }
}

function scanBacktestSourceTree(): ReadonlyArray<readonly [string, string]> {
  const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const files = Object.entries(modules).map(([path, content]): readonly [string, string] => [path, String(content)]);
  expect(files.length).toBeGreaterThan(0); // sanity: the scan actually found source files
  return files;
}

describe("BT-05 — no-write-path structural guard", () => {
  it("no ForWriting*Rules / ForPersisting*RuleWeights-shaped port is declared OR imported anywhere in the backtest tree", () => {
    const files = scanBacktestSourceTree();
    // The write-rule-weights port shape BT-05 forbids: a ForWriting<...>Rules or
    // ForPersisting<...>RuleWeights name, whether declared here or imported from elsewhere.
    // Scoped to actual declaration/import lines (never doc-comment prose warning ABOUT the
    // guard, e.g. ports.ts's own header names this exact token while explaining why it must
    // stay absent — EXIT-10's precedent, generalized past "import lines only").
    const forbidden = /\bFor(?:Writing\w*Rules\b|Persisting\w*RuleWeights\b)/;
    const declarationOrImportLine = /^\s*(export\s+type\b|export\s+interface\b|import\b)/;
    for (const [path, content] of files) {
      const offendingLines = content
        .split("\n")
        .filter((line) => declarationOrImportLine.test(line) && forbidden.test(line));
      expect(offendingLines, `in ${path}`).toEqual([]);
    }
  });

  it("no backtest source imports rules.ts or exit-rules.ts directly (only the read-only @morai/core barrel)", () => {
    const files = scanBacktestSourceTree();
    const importLine = /^\s*import\b/;
    for (const [path, content] of files) {
      const offendingImportLines = content
        .split("\n")
        .filter((line) => importLine.test(line) && (line.includes("rules.ts") || line.includes("exit-rules.ts")));
      expect(offendingImportLines, `in ${path}`).toEqual([]);
    }
  });

  it("ports.ts declares no update/delete counterpart to ForPersistingBacktestRun (append-only, re-affirms 27-01 from the port side)", () => {
    const files = scanBacktestSourceTree();
    const portsFile = files.find(([path]) => path.endsWith("/ports.ts"));
    expect(portsFile).toBeDefined();
    if (portsFile === undefined) return;
    const [, content] = portsFile;
    expect(content).toContain("ForPersistingBacktestRun");
    expect(content).not.toMatch(/ForUpdatingBacktestRun|ForDeletingBacktestRun/);
  });
});
