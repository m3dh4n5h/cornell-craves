# design-sync notes (Cornell Craves)

Repo-specific gotchas for future syncs. Read this before re-running.

## What this repo is

- **An app, not a component library.** `package.json` is `private` with no `main`/`module`/`exports`, and `dist/` is an app build (page chunks), not a library dist. The sync works off a **barrel entry**, `src/design-system.ts`, which re-exports exactly the components that belong to the design system. **Adding a component there is what publishes it.**
- The converter resolves the package from `node_modules/<pkg>` unless `cfg.entry` is set. Without the barrel it crashes with `ENOENT … node_modules/cornell-craves/package.json`. `cfg.entry` also makes the walk-up land on the repo root, which is what makes everything else resolve.

## The build chain (`cfg.buildCmd`)

`npm run build && npx tsc -p .design-sync/tsconfig.types.json && node .design-sync/prep-css.mjs`

Three steps, each load-bearing:

1. **`npm run build`** produces `dist/assets/index-*.css` (compiled Tailwind v4) and the font assets.
2. **`tsc -p .design-sync/tsconfig.types.json`** emits declarations to `.design-sync/types/`, and `package.json` `"types"` points at `.design-sync/types/design-system.d.ts`. **This is not optional.** The app is `noEmit`, so without this step the converter finds no `.d.ts` and every component's props interface emits as `[key: string]: unknown` — the design agent then has no API to code against. With it, props resolve fully (variants, unions, JSDoc).
3. **`prep-css.mjs`** copies the compiled CSS to `.design-sync/compiled.css` and **strips its `@font-face` rules**. Those rules reference absolute app-server URLs (`/assets/…`, `/fonts/…`) that cannot resolve inside a design bundle, so they ship dangling and every design falls back to a system font. The brand faces are re-declared in `.design-sync/fonts.css` (wired via `cfg.extraFonts`) against paths the converter can actually copy: `public/fonts/` for Cabinet Grotesk, `@fontsource/epilogue` for Epilogue. Latin subset only, deliberately.

## Known render warns (expected — not new)

- **`[FONT_MISSING]` "Avenir Next", "Cascadia Mono"** — accepted. These are *system fallbacks* inside `--font-display` and `--font-mono`, not brand faces. The actual brand faces (Cabinet Grotesk, Epilogue) do ship and are verified rendering.
- **`[RENDER_SKIPPED]`** on a no-change re-sync is expected (driver scoping), not a regression.

## Component-specific

- **Toaster** — `toast` must be imported from the barrel, never from `sonner` directly. A direct `sonner` import creates a second store instance the bundled `Toaster` never listens to, and the toast silently never renders (cost one full debug cycle). `src/design-system.ts` re-exports `toast` for exactly this reason. Toaster also carries `cfg.overrides.Toaster = {cardMode:"single", primaryStory:"Success"}` because its `position: fixed` host escapes a multi-cell grid.
- **Combobox** — its distinguishing state (open dropdown) only appears on focus, so the preview focuses the input on mount.
- **GroupInviteLink** — builds its URL from the host page origin, so preview cards show the preview server's origin. Correct behavior, looks odd in a card. Not a defect.
- **DeadlineTimer** — previews use `Date.now()` offsets so the countdown always reads realistically. The compiled preview contains the *expression*, not a baked value, so render hashes stay deterministic.

## Deliberately excluded

`cfg.componentSrcMap` pins exactly 20 components. Left out because they need app context and would render broken (a broken card here renders broken in every design built from it):

- `ListingCard` — react-router `<Link>`
- `ReviewCard` — Supabase client
- `BottomNav` — router + `useAuth` + `useClub`
- `QRScanner` — camera API
- page chrome generally

To add any of these later, wire `cfg.provider` for the context it needs and add it to the barrel.

## Styling constraint worth knowing

The shipped CSS is **JIT-compiled from the app's own source**, so it contains only the utilities the app actually uses — not all of Tailwind. `font-body`, `bg-white`, `z-toast`, `z-sheet` are defined as tokens but have **no utility class**. `.design-sync/conventions.md` documents the verified vocabulary and tells the design agent to fall back to `var(--token)` (all tokens are on `:root`) for anything outside it.

`cfg.guidelinesGlob` is `[]` on purpose: the only file under `docs/` is a Postgres row-level-security reference, which would only mislead a design agent.

## Re-sync risks (what can silently go stale)

- **`cfg.extraFonts` / `prep-css.mjs`** assume `dist/assets/index-*.css` exists and that Epilogue lives at `node_modules/@fontsource/epilogue/files/epilogue-latin-{400,500,600,700}-normal.woff2`. If the font dependency changes or subsets are added, fonts silently regress to system fallbacks — check `ds-bundle/fonts/` has 8 woff2 after a build, and watch for `[FONT_DANGLING]`.
- **`package.json` `"types"`** points into gitignored `.design-sync/types/`. On a fresh clone that path doesn't exist until `buildCmd` runs. Always run `buildCmd` before the converter, or props regress to empty.
- **`.design-sync/conventions.md` enumerates real class names.** If the app stops using a utility, Tailwind stops emitting it and the header starts naming something that no longer resolves. Re-run the validation pass (grep each backticked class against `ds-bundle/_ds_bundle.css`) on every re-sync.
- **Verified with `--render-sample` default (full).** Playwright was installed with `npm i --no-save playwright@1.61.1`; its browser is at `~/Library/Caches/ms-playwright/chromium_headless_shell-1228`. A different playwright version will fail with `Executable doesn't exist`.
- **PGlite/Playwright are `--no-save` installs.** Running `npm ci` removes them; reinstall before the render check or the DB test suite.
