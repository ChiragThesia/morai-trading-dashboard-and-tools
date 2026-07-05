# Deferred Items — Phase 20

Pre-existing issues found during execution, out of scope for the current plan (Scope
Boundary — only auto-fix issues directly caused by the current task's changes).

## From 20-03 (WATCH-01 client wiring)

Full-repo `tsc --noEmit` on `apps/web` surfaces pre-existing type errors in files NOT
touched by 20-03, present before this plan's changes:

- `src/components/ErrorBoundary.test.tsx(70,37)` / `(71,18)` — implicit `any` params.
- `src/components/ErrorBoundary.tsx(29,3)` / `(33,3)` — missing `override` modifier.
- `src/components/system/Button.tsx(97,48)` — `exactOptionalPropertyTypes` mismatch in
  `buttonClass()`'s call to itself via `ButtonClassOptions`.
- `src/hooks/useMacro.test.ts(60,33)` / `(61,33)` — index-signature property access
  (`noPropertyAccessFromIndexSignature`).
- `src/screens/JournalContainer.test.tsx(94,5)` — `Promise<T | undefined>` not
  assignable to `Promise<T>`.

None of these are in `useLiveStream.ts`, `LiveStatusBadge.tsx`, `Overview.tsx`, or
`Overview.test.tsx` (the files this plan touches) — confirmed via targeted grep on the
`tsc` output and `git status` showing zero pending changes to any of the affected files.
Not fixed here; flagging for a future cleanup pass.
