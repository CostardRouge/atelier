# Build & deployment

Read before touching `vite.config.ts`, the workflows in `.github/workflows/`, `public/luts/`, or anything about how the site is built and published.

## GitHub Pages, base path derived — never hardcoded (2026-08-20)

**Decision.** `vite.config.ts` computes `base` from `GITHUB_REPOSITORY` in CI (`owner/repo` → `/repo/`), falling back to `atelier` locally, with a `BASE_PATH` env override for a custom domain. **Why**: the base was hardcoded to the name the project was authored under, the repository was renamed, and every asset 404'd on the deployed site — a blank page. It then drifted a second time in the opposite direction, so the derived value is the only version that survives a rename. **How to apply**: never write a literal base path; if the site must serve from `/`, set `BASE_PATH=/`. Note the fallback string is still a hardcoded repo name — it only matters outside CI.

## The site serves from a custom domain, so `deploy.yml` pins `BASE_PATH=/` (2026-08-31)

**Decision.** The Build step of `.github/workflows/deploy.yml` sets `BASE_PATH: /`. **Why**: a custom domain serves the site at the ROOT, while the derived base would be `/atelier/` — so every asset was requested at `/atelier/assets/…` and 404'd. Same failure mode as the rename above, opposite cause: the derivation is right, the deployment moved. **How to apply**: the custom domain itself lives in the repository's Pages settings, **not** in a `public/CNAME` file — that file is only needed for the legacy branch-based deploy, and this repo publishes through `upload-pages-artifact` + `deploy-pages`, which keeps the setting across deploys. If the site ever returns to a `github.io/<repo>/` URL, remove the override rather than hardcoding anything.

## Deploy is push-to-`main`; CI gates everything else (2026-08-20)

**Decision.** `deploy.yml` builds and publishes to GitHub Pages on every push to `main` (tests run there too, and the deploy concurrency group is not cancel-in-progress so a deploy always finishes). `ci.yml` runs typecheck + lint + test + build on every push and pull request, cancelling superseded runs per branch. **Why**: before `ci.yml` existed, only the deploy workflow ran, so type and lint errors could land unnoticed on `main` — and landing on `main` means publishing. **How to apply**: run the same four commands locally before declaring a task finished; a red one on `main` ships a broken site.

## Every tool is its own chunk, cut at the registry (2026-09-22)

**Decision.** `src/app/tools.tsx` declares each tool's component with `React.lazy(() => import(…))`, `App.tsx` draws the wait in a `Suspense` inside the tool's `ErrorBoundary`, and `main.tsx` listens for Vite's `vite:preloadError` and reloads ONCE per session. **Why**: the ten static imports put the whole suite in one script — **1 907 kB minified, 606 kB gzip** — that the home page and every instrument downloaded and parsed before painting anything. **Measured after** (entry chunk alone): **511 kB / 172 kB gzip**; Trips 459 kB, Develop 157 kB, the Studio 100 kB, each fetched only on its route, and the shared modules two tools both reach hoisted by Rollup into common chunks (`save-*.js`, `finals-*.js`, `use-overlay-stage-*.js`). The seam was already there: no tool imports another and nothing in the shell imports a tool except the registry — `shared/` never importing `tools/` is what made this a one-file change.

**Two things the split forces, both handled.** (1) **A stale chunk after a deploy**: the site is republished on every push to `main` with hashed names, so a tab left open across a deploy asks for a chunk that no longer exists the first time it opens another tool. Vite's `vite:preloadError` is the hook and a reload the documented cure; it is guarded by a `sessionStorage` flag so a genuinely unreachable file shows the boundary's panel instead of reloading in a loop. (2) **mp4box was in the entry chunk** (176 kB) through `AssetLibraryContext` → `video-metadata.ts`, whose `probeContainer` is only ever called for the ACTIVE clip of a tool: it now `await import('mp4box')` on first use, and the parser is a chunk shared by the tools that also import it statically for the export.

**How to apply**: a new tool is still one registry entry — write it as `lazy(() => import(…))` like the others. A heavy dependency reached from the shell (anything `main.tsx` → `App.tsx` → `AssetSidebar` → … can see statically) belongs behind a dynamic import at the point of use, the way `maplibre-gl`, `libraw-wasm` and `@ffmpeg/ffmpeg` already are. To see what the entry chunk holds: `npx vite build --sourcemap`, then attribute the map's segments to sources (a 60-line script did it; no dependency was added for it). Smoke-tested from `vite preview` in headless Chromium: every route at 1280 and 390 px, no console error, no horizontal overflow, each route fetching only its own chunks.

## Node 20 and `npm ci` (2026-08-20)

**Fact.** Both workflows use `actions/setup-node@v4` with `node-version: 20`, `cache: npm`, and install with `npm ci`. **How to apply**: `package-lock.json` must stay in sync with `package.json` or `npm ci` fails the build; commit the lockfile with any dependency change, and do not introduce a second lockfile (pnpm/yarn/bun) — the cache key and `npm ci` both assume this one.

## Built-in LUTs are discovered at build time, not listed (2026-08-20)

**Decision.** A small Vite plugin in `vite.config.ts` scans `public/luts/` recursively at build/dev time and exposes the result as the `virtual:luts` module; folder names become picker groups, filenames become labels (first letter capitalised only, so deliberate casing like `Rec709`/`DLog` survives), hidden files and macOS sidecars are skipped. The dev server re-scans and full-reloads when a `.cube` is added or removed. **Why**: static hosting cannot list a directory at runtime, and a hand-maintained manifest goes stale the moment someone drops a file in. **How to apply**: adding a look = dropping a `.cube` into a sub-folder of `public/luts/`. No code edit. The starter looks under `classic/` are generated by `node scripts/gen-luts.mjs` (affine looks are exact at grid size 2 because trilinear interpolation reproduces any affine transform exactly; the contrast S-curve needs a larger grid).

## The city index is generated and COMMITTED, like the LUTs (2026-09-20)

**Decision.** `public/geo/cities.json` (135 233 places, 5.8 MB, 2.3 MB over the wire) is built by `node scripts/gen-gazetteer.mjs` and committed, the same shape as `gen-luts.mjs` and `gen-icons.mjs`: a generator in `scripts/`, its output in `public/`, both in the repo. It is what names a deduced Road Trip leg offline (`roadtrip.md`, «The itinerary is DEDUCED from one position per day»), fetched through `import.meta.env.BASE_URL` and **only when a leg needs naming** — never at boot. Sizes for scale: `public/models` is 17 MB and `public/luts` 37 MB.

**Regenerating it needs no dependency and no GeoNames access.** With a path it reads a `cities1000.txt` dump; with no argument it fetches the `cities-with-1000` package from the npm registry, which ships that dump verbatim, and unpacks it with a small tar reader in the script. Nothing is installed and `package.json` is untouched. That second path exists because **`download.geonames.org` is refused by the agent container's network policy** (403 at the CONNECT) while npm is allow-listed. **GeoNames is CC BY 4.0**: the attribution is written into the generated file and must not be stripped.

## The look picker's tiles are generated and COMMITTED, not baked at build (2026-09-20)

**Decision.** `scripts/gen-lut-thumbs.mjs` bakes every built-in look and every film stock onto the two references in `public/reference/` and writes `public/lut-thumbs/` (34 WebP tiles + `index.json`, **192 KB**), committed. It is run BY HAND after adding or removing a `.cube` under `public/luts/` or changing a stock's numbers — the fourth generator of exactly this shape, beside `gen-luts.mjs`, `gen-icons.mjs` and `gen-gazetteer.mjs`.

**Why not the Vite plugin the plan proposed** (`docs/lut-packs.md` §7 floated "a plugin, like `virtual:luts`"). Baking needs a JPEG **decoder** for the references and an image **encoder** for the tiles — `sharp`, a native module — and `gen-icons.mjs` already carries this repo's ruling on that: installed with `npm i --no-save`, deliberately not a project dependency, because *"CI would pay for a native install on every job"*. A plugin would also make every `vite build` **and every `npm run dev`** decode two JPEGs and bake ~34 lattices; `virtual:luts` is a cheap directory scan, this is real CPU. And the input changes about as often as the icons do. **Measured, walking all six rail families**: 28 `.cube` requests (37 MB) before, **0** after.

**How to apply.** Forgetting to re-run it is not a breakage: a look with no tile bakes live in the gallery exactly as it used to, and a missing `index.json` puts the whole picker back on the old path — verified by serving it a 404. Do re-run it in the same commit as the `.cube` you added, and **commit `public/lut-thumbs/`**. Note `lut-packs.md` §3 rule 3 ("nothing in `public/` or git") is about PURCHASED pack lattices and does not reach these: a built-in's cube is already committed and already shipped.

**A generator can import the app's own TypeScript** (`scripts/ts-imports.mjs`). Node strips types by itself since 22.18, so a `.ts` file loads; what it will not do is resolve the extensionless specifiers TypeScript is written with (`./interpolate`), which that helper adds in ~20 lines and no dependency. **Why it matters**: the tiles must come out of `bakeLutPreview`/`parseCube`/`filmCubeFor` themselves, not a second copy of the arithmetic in a script, or a tile stops meaning what it shows. Only DOM-free modules load — the same line `vitest.config.ts` draws — which is a feature. It needs **Node ≥ 22.18** and says so by name rather than failing on a syntax error; CI never runs it, so the version floor costs nothing there.

## The dev server WRITES two files: the house styles (2026-09-15)

**Decision.** `houseStylePlugin` in `vite.config.ts` (`apply: 'serve'`) answers `POST`/`DELETE /__atelier/house-style/<trip|project>` by writing/removing a FIXED file per key of its `HOUSE_STYLES` table (`src/shared/roadtrip/house-style.json`, `src/shared/projects/house-style.json`) — the request names a key, never a path; an unknown key is a 404 — and refuses a foreign `Origin` (403; a cross-origin JSON POST is preflighted and the preflight gets a 405), a non-JSON body and a body whose `kind` is not that target's. A third house style is one table row plus its module. The route sits outside `base` because a middleware added directly in `configureServer` runs before Vite's own. The UI is gated by `import.meta.env.DEV` on BOTH the section list and the render, so `vite build` folds it away — **verified by grepping `dist/` for `__atelier`**; redo that grep after touching the panel. **Why**: a browser cannot write into the repo, and the deployed site is static. **How to apply**: the file is read through `import.meta.glob` (`house-style-bundle.ts`) so its absence is a valid state, not a failing import.

**Trap — a self-accepting module that must stay live across several HMR updates.** Copying the new value into the old instance from the `accept(cb)` callback works ONCE: Vite clears the old instance's callbacks when the new one registers, so the second update lands in an instance nobody imports and the app keeps the stale value (seen: a reset after a save left the old style in memory). Keep the value in a holder stored in `import.meta.hot.data` and let every instance write into it — `shared/lib/held-across-updates.ts` does exactly that. The literal `import.meta.hot.accept()` must stay in the loader itself: Vite finds a self-accepting module by reading that call in its source, so hiding it in a helper would turn every save into a full reload.

## ffmpeg.wasm and the dev server (2026-08-20)

**Fact.** `optimizeDeps.exclude` lists `@ffmpeg/ffmpeg` so dev pre-bundling cannot rewrite its module-worker URL, and `worker.format: 'es'` makes the dev and production worker formats match. **How to apply**: leave both in place when touching the Vite config; removing either breaks the transcode path in exactly one of the two modes, which is the hardest kind of bug to notice.

## Build type-checks (2026-08-20)

**Fact.** `npm run build` is `tsc -b && vite build`, and `tsconfig.app.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. **How to apply**: an unused import or parameter is a **build** failure, not a lint warning. ESLint (`eslint.config.js`, flat config, `typescript-eslint` recommended) ignores `dist`.

## Unattended agent runs live in Actions, not in a scheduler (2026-09-19)

**Decision.** `.github/workflows/memory-audit.yml` runs the weekly memory-vs-code
audit from GitHub Actions. **Why**: the alternative — a scheduled Claude session
fired from outside — was built, measured and abandoned. A fired session cannot
reach `api.github.com` for this owner's repositories at all: `curl`, `gh api` and
a `gh` CLI it installed itself are refused identically, so it is a proxy-level
block on repository access, not a missing client, and no `add_repo` tool exists
inside such a session to lift it. A workflow has the runner's own
`GITHUB_TOKEN` and the problem disappears. **How to apply**: anything unattended
that must read or write this repository belongs in a workflow here; the portfolio
-wide record of that finding, and the six routine prompts it produced, are in
`second-brain`'s `CLAUDE-OPS.md` and `claude-ops/routines/`.

**Fact — the agent reads this repository's memory like a local session does.**
`actions/checkout` puts the tree on the runner and `claude-code-action` runs the
Claude Code CLI inside it, so `CLAUDE.md`, its `@MEMORY.md` import and
`docs/memory/` all apply. Without the checkout step it has nothing to audit.

**Fact — one secret, `CLAUDE_CODE_OAUTH_TOKEN`, generated by `claude setup-token`.**
It bills the maintainer's Claude subscription rather than API usage, which also
means a workflow run spends the SAME weekly quota as an interactive session:
moving work into Actions buys access, never capacity. No GitHub token is created
for it — the action authenticates as the Claude GitHub App when `github_token`
is left unset, and that is also what makes CI run on commits it pushes (a push
made with the default `GITHUB_TOKEN` triggers no workflow).

**Trap — a scheduled workflow only fires from the default branch**, so this file
does nothing until it is merged, and `workflow_dispatch` only appears in the UI
once it is there. Test it from the Actions tab after the merge, never before.

**Trap — in automation mode the agent starts with no tools.** A `prompt` input
without `--allowedTools` in `claude_args` yields an agent that can neither read
a file nor call `gh`. Grant exactly what the prompt needs, with argument
patterns rather than a bare `Bash`, and keep `--max-turns` and
`timeout-minutes` set: the expensive failure here is a runaway agent spending
subscription quota, not the Actions minutes (this repository is public, so its
minutes are free).

**Trap — `--allowedTools` is a bad fence for a shell, and it silently eats the
deliverable (2026-09-19).** The first audit run reported
`"subtype": "success", "is_error": false` with `permission_denials_count: 7`
and opened no issue at all: a long issue body reaches for a heredoc, and
`$(cat <<'EOF' …)` is command substitution, which a `Bash(gh issue create:*)`
prefix pattern refuses. **How to apply**: the `permissions:` block is the real
boundary — a bare `Bash` under `contents: read` + `issues: write` can do
nothing else — so grant tools broadly there and narrow the TOKEN instead. And
never let a report depend on one tool call: write it to a file, upload it with
`actions/upload-artifact` under `if: always()`, and pass it to `gh` with
`--body-file`.

**Trap — `--max-turns` fails the job even on success.** That run ended at 42
turns against a cap of 40 and the action raised
`Claude reported a successful result after 42 turns`, turning a finished audit
into a red job. Auditing this repository's memory is ~40 turns of reading, so
the cap is 100 and `timeout-minutes` is the real stop.

**Measured — one audit run costs about $3.79 of model usage** (3m07s of Claude,
Sonnet, ~42 turns; a Haiku side model appears in `modelUsage` and is normal).
On a subscription that is quota, not an invoice, but it is the figure to
multiply before putting this workflow on every repository.
