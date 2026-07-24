# design-sync notes — @morai/web

Repo-specific gotchas for future syncs. Read this before re-running.

## Why the config looks unusual

- **`apps/web` is an app, not a library.** There is no `dist/` library entry, so the
  converter runs in **synth-entry mode** (it builds one entry from every `.tsx` under
  `srcDir`). The way we force that is `--entry apps/web/dist/ds-lib.js` — a path that
  **deliberately does not exist**. Two things depend on it: the walk-up from its
  dirname resolves `PKG_DIR` to `apps/web`, and `resolveDistEntry` returning null is
  what selects synth mode. The `[NO_DIST] --entry … doesn't exist` line in the build
  log is therefore **expected, not an error**. Do not "fix" it by pointing `--entry`
  at `src/main.tsx` — that is the app bootstrap and exports nothing.
- **`.d.ts` come from a side build.** `buildCmd` runs `tsc --emitDeclarationOnly` into
  `apps/web/types/`, which `findTypesRoot` picks up. Without it every `<Name>Props`
  would be empty. The repo has ~8 pre-existing type errors, so that `tsc` is wrapped in
  `|| true` — it still emits. Do not treat those errors as caused by this sync.
- **`cssEntry` is assembled by `.design-sync/make-css.sh`**, not shipped by the repo.
  `src/index.css` is Tailwind *source*; designs need the compiled build. The script
  also adds two things the app gets from `index.html` rather than from CSS: the Google
  Fonts `@import` (Space Grotesk + JetBrains Mono) and the body surface restated at
  `html body` specificity — the preview harness injects `body{background:#fff}` after
  the stylesheet link, and a plain `body{}` rule loses to it. Morai is dark-only.
- **`extraEntries` merges `@tanstack/react-query` and `recharts` onto `window.Morai`.**
  This is load-bearing: the data-fetching cards seed a real `QueryClient`, and
  `ChartContainer` only recognises recharts children built from **its own** instance.
  Importing `recharts` directly in a preview renders an empty chart. `recharts` and the
  DS both export `Tooltip`; the main package wins (verified — the DS Tooltip is intact),
  and the build prints `[EXPORT_COLLISION]` about it. Expected.
- **`libOverrides: source-kit.mjs`** removes `ui` from `GENERIC_DIR` so the shadcn atom
  layer becomes its own group instead of collapsing into `general`.

## Known render warns (expected — not new)

- `[RENDER_THIN] … rendered height is 0px` on the whole **Dialog** family (`Dialog`,
  `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`,
  `DialogTitle`, `DialogTrigger`). The popup is `position: fixed`, so the measured root
  is 0px while the dialog paints correctly. Confirmed on the screenshots. Benign.
- `[EXPORT_COLLISION] recharts exports … Tooltip` — see above. Benign.
- `[NO_DIST]` ×2 — see above. Benign.

## Preview-authoring gotchas found the hard way

- **Layout glue in previews must be inline styles, not new Tailwind classes.** The
  shipped stylesheet is the app's *purged* build; a utility the app never uses is not
  in it. (`bg-upd`, `bg-violetd` and `text-faint` are examples that do not exist.)
- **`AuthExpiredBanner` is `position: fixed; bottom: 0`** and escapes any card. Its
  preview wraps it in a `transform: translateZ(0)` container so `fixed` resolves
  against that box instead of the viewport.
- **`GuardTag` reads recharts' `useXAxisScale`/`useYAxisScale`/`usePlotArea`** and
  returns `null` outside a chart — its preview is the full `TermStructureChart`
  composition, which is its only true render.
- **`LiveStatusBadge.lastTickAt` is a `Date`**, not an ISO string.
- **`Shell`** mounts screens whose hooks call `useQuery` — it needs a
  `QueryClientProvider` or it renders empty.
- Card modes are set in `cfg.overrides`: `column` for wide charts/tables, `single` for
  anything that portals or uses fixed positioning.

## Repo findings worth fixing in the app (not sync problems)

- `ui/tabs.tsx` styles its stacking with Tailwind `data-horizontal:` variants, but
  base-ui emits `data-orientation="horizontal"` — so `[data-horizontal]` never matches
  and the Tabs root never gets `flex-col`. Panels therefore sit *beside* the tab list
  instead of under it. The app only ever uses `Tabs` as a list-only segmented control,
  so it has not been noticed.
- Dead shadcn scaffolding, exported but unused by any screen: `CardHeader`,
  `Separator`, `Skeleton`, `Slider`, `Toggle`, `ToggleGroup`, `Textarea`. Their
  previews are composed from the source + `.d.ts` rather than ported from real usage.

## Re-sync risks — what can go stale

- **Fixtures are inlined into `.design-sync/previews/*.tsx`.** They were copied from
  the component test files (`CandidateCard.test.tsx`, `RegimeBoard.test.tsx`,
  `PositionCard.test.tsx`, `NewsCard.test.tsx`, `CotCard.test.tsx`). If a contract in
  `@morai/contracts` changes shape, those previews still compile (the fields are plain
  objects) but may render a degraded/empty state. Re-check them after any contract change.
- **`componentSrcMap` enumerates all 78 discovered exports** (70 synced, 8 excluded:
  `ComingSoon`, `ErrorBoundary`, `ChartStyle`, `ShellWithRouter`, `DialogOverlay`,
  `DialogPortal`, `ChartTooltip`, `ChartLegend`). A **new component will not appear
  until it is added there** — synth mode discovers it, but the map is the source of
  truth for grouping. Re-run the export scan if the component count looks short.
- **`dtsPropsFor` hand-writes 18 prop bodies** whose real types are inline object
  literals the extractor cannot reach, or `PickerCandidate`-shaped values it flattens
  to `unknown`. These will silently drift if the component's props change. Diff them
  against source on any sync that touches those files.
- **The Google Fonts `@import` is a network dependency.** `[FONT_REMOTE]` is expected;
  if the design agent ever renders offline, both brand faces fall back.
- **Build assumes** bun 1.3.x, node 26, vite 8, playwright chromium (installed fresh —
  nothing was cached on this machine).
